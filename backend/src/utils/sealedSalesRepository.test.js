'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {mkdtemp,writeFile,rm}=require('node:fs/promises');const {join}=require('node:path');const {tmpdir}=require('node:os');
const {openConnection}=require('./salesRepository');const {createSealedSalesRepository}=require('./sealedSalesRepository');
const {allocateOpening}=require('./openingAccounting');const {createSalesWorkflow}=require('./salesWorkflow');
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'sealed-sales-')),path=join(dir,'test.db');await writeFile(path,'');t.after(()=>rm(dir,{recursive:true,force:true}));
  const connect=()=>openConnection(path),db=await connect();
  await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);
  CREATE TABLE sealed_product(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,archived_at TEXT);
  CREATE TABLE sealed_lot(id INTEGER PRIMARY KEY,user_id INTEGER,product_id INTEGER,quantity INTEGER,remaining_quantity INTEGER,total_cost_cents INTEGER,remaining_cost_cents INTEGER,currency TEXT,archived_at TEXT,updated_at TEXT);
  INSERT INTO sealed_product VALUES(1,1,'Booster box',NULL);
  INSERT INTO sealed_lot VALUES(10,1,1,3,3,100,100,'USD',NULL,NULL);`);
  await db.close();return {connect,repo:createSealedSalesRepository({connect})};
}
const input={lotId:10,requestKey:'sealed-sale-1',soldOn:'2026-11-08',quantity:1,proceedsCents:100,feesCents:10,currency:'USD'};
test('partial sealed sale preserves original cost and allocates remaining cost',async t=>{
  const {connect,repo}=await fixture(t);const result=await repo.recordSale(1,input);
  assert.equal(result.soldBasisCents,33);assert.equal(result.realizedGainCents,57);
  assert.deepEqual(await repo.recordSale(1,input),result);
  const db=await connect();try {const lot=await db.get('SELECT * FROM sealed_lot WHERE id=10');assert.equal(lot.remaining_quantity,2);assert.equal(lot.remaining_cost_cents,67);assert.equal(lot.total_cost_cents,100);}finally{await db.close();}
});
test('opening and sales together conserve the complete sealed lot cost',async t=>{
  const {connect,repo}=await fixture(t);await repo.recordSale(1,input);
  let db=await connect();let lot=await db.get('SELECT * FROM sealed_lot WHERE id=10');
  const opened=allocateOpening({remainingQuantity:lot.remaining_quantity,remainingCostCents:lot.remaining_cost_cents,quantity:1});
  await db.run('UPDATE sealed_lot SET remaining_quantity=?,remaining_cost_cents=? WHERE id=10',[opened.remainingQuantity,opened.remainingCostCents]);await db.close();
  const last=await repo.recordSale(1,{...input,requestKey:'sealed-sale-2'});assert.equal(last.soldBasisCents,34);assert.equal(33+opened.costCents+last.soldBasisCents,100);
  await assert.rejects(repo.recordSale(1,{...input,requestKey:'sealed-sale-3'}),{status:409});
});
test('ownership, currency, archived lots and conflicting retries are enforced',async t=>{
  const {connect,repo}=await fixture(t);
  await assert.rejects(repo.recordSale(2,input),{status:404});
  await assert.rejects(repo.recordSale(1,{...input,currency:'EUR'}),{status:400});
  await repo.recordSale(1,input);await assert.rejects(repo.recordSale(1,{...input,proceedsCents:200}),{status:409});
  const db=await connect();await db.run("UPDATE sealed_lot SET archived_at='2026-11-08' WHERE id=10");await db.close();
  await assert.rejects(repo.recordSale(1,{...input,requestKey:'sealed-sale-2'}),{status:404});
});
test('failed inventory update rolls back its sale history insert',async t=>{
  const {connect,repo}=await fixture(t);let db=await connect();
  await db.exec("CREATE TRIGGER block_inventory BEFORE UPDATE ON sealed_lot BEGIN SELECT RAISE(ABORT,'forced failure');END;");await db.close();
  await assert.rejects(repo.recordSale(1,input));db=await connect();
  try {assert.equal((await db.get('SELECT remaining_quantity FROM sealed_lot WHERE id=10')).remaining_quantity,3);assert.equal(await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sealed_sale_record'"),undefined);}finally{await db.close();}
});
test('native-currency sealed history stays owner scoped',async t=>{
  const {connect,repo}=await fixture(t);const db=await connect();await db.run("UPDATE sealed_lot SET currency='EUR' WHERE id=10");await db.close();
  const sale=await repo.recordSale(1,{...input,currency:'EUR'});assert.equal(sale.currency,'EUR');
  assert.equal((await repo.listSales(1))[0].currency,'EUR');assert.deepEqual(await repo.listSales(2),[]);
});
test('shared workflow dispatches card and sealed sales without mixing currency',async()=>{
  const calls=[];const workflow=createSalesWorkflow({cards:{recordSale:async(user,sale)=>{calls.push(['card',user,sale.lotId]);return {saleId:1};}},sealed:{recordSale:async(user,sale)=>{calls.push(['sealed',user,sale.lotId]);return {saleId:2};}}});
  assert.equal((await workflow.recordSale(1,{kind:'card',lotId:7,currency:'USD'})).kind,'card');
  assert.equal((await workflow.recordSale(1,{kind:'sealed',lotId:10,currency:'EUR'})).kind,'sealed');
  await assert.rejects(workflow.recordSale(1,{kind:'card',currency:'EUR'}),{status:400});
  await assert.rejects(workflow.recordSale(1,{kind:'other'}),{status:400});assert.deepEqual(calls,[['card',1,7],['sealed',1,10]]);
});
