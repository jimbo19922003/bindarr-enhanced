'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {mkdtemp,writeFile,rm}=require('node:fs/promises');const {join}=require('node:path');const {tmpdir}=require('node:os');
const {openConnection,createSalesRepository}=require('./salesRepository');
const {createSealedSalesRepository}=require('./sealedSalesRepository');
const {hasSealedSales,validateSealedLotEdit}=require('./salesInventoryProtection');
const {allocateOpening}=require('./openingAccounting');
async function fixture(t) {
 const dir=await mkdtemp(join(tmpdir(),'sale-guards-')),file=join(dir,'test.db');await writeFile(file,'');t.after(()=>rm(dir,{recursive:true,force:true}));
 const connect=()=>openConnection(file),db=await connect();
 await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);
 CREATE TABLE collection(id INTEGER PRIMARY KEY,user_id INTEGER,card_id TEXT,quantity INTEGER,list_type TEXT,purchase_price REAL,notes TEXT);
 CREATE TABLE sealed_pull(user_id INTEGER,collection_id INTEGER,filed_ids TEXT);
 CREATE TABLE sealed_product(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,archived_at TEXT);
 CREATE TABLE sealed_lot(id INTEGER PRIMARY KEY,user_id INTEGER,product_id INTEGER,quantity INTEGER,remaining_quantity INTEGER,total_cost_cents INTEGER,remaining_cost_cents INTEGER,currency TEXT,purchased_at TEXT,archived_at TEXT,updated_at TEXT,notes TEXT);
 INSERT INTO collection VALUES(10,1,'card',1,'collection',1,'');
 INSERT INTO sealed_product VALUES(1,1,'Box',NULL);
 INSERT INTO sealed_lot VALUES(10,1,1,3,3,100,100,'USD','2026-11-01',NULL,NULL,'');`);await db.close();
 return {connect,cards:createSalesRepository({connect}),sealed:createSealedSalesRepository({connect})};
}
const sale={lotId:10,requestKey:'guard-sale-1',soldOn:'2026-11-08',quantity:1,proceedsCents:100,feesCents:0,currency:'USD'};
test('card metadata remains editable while acquisition identity is protected',async t=>{
 const {connect,cards}=await fixture(t);await cards.createLot(1,{collectionId:10,source:'direct',basisCents:100});
 const db=await connect();try{
 await assert.rejects(db.run('UPDATE collection SET quantity=2 WHERE id=10'));
 await assert.rejects(db.run("UPDATE collection SET card_id='different' WHERE id=10"));
 await assert.rejects(db.run('UPDATE collection SET purchase_price=2 WHERE id=10'));
 await db.run("UPDATE collection SET notes='moved storage' WHERE id=10");
 }finally{await db.close();}
});
test('normal card sale succeeds but sold copies cannot return through an ordinary edit',async t=>{
 const {connect,cards}=await fixture(t);const lot=await cards.createLot(1,{collectionId:10,source:'direct',basisCents:100});
 const result=await cards.recordSale(1,{...sale,lotId:lot.id});assert.equal(result.remainingQuantity,0);
 const db=await connect();try{await assert.rejects(db.run("UPDATE collection SET list_type='collection' WHERE id=10"));await assert.rejects(db.run('DELETE FROM card_sale_record'));}finally{await db.close();}
});
test('sealed sales prevent restocking and acquisition changes but allow remaining units to open',async t=>{
 const {connect,sealed}=await fixture(t);await sealed.recordSale(1,sale);const db=await connect();try{
 assert.equal(await hasSealedSales(db,10,1),true);
 await assert.rejects(db.run('UPDATE sealed_lot SET remaining_quantity=3,remaining_cost_cents=100 WHERE id=10'));
 await assert.rejects(db.run('UPDATE sealed_lot SET total_cost_cents=200 WHERE id=10'));
 await db.run("UPDATE sealed_lot SET notes='new shelf' WHERE id=10");
 const current=await db.get('SELECT * FROM sealed_lot WHERE id=10');const opening=allocateOpening({remainingQuantity:current.remaining_quantity,remainingCostCents:current.remaining_cost_cents,quantity:1});
 await db.run('UPDATE sealed_lot SET remaining_quantity=?,remaining_cost_cents=? WHERE id=10',[opening.remainingQuantity,opening.remainingCostCents]);
 assert.equal((await db.get('SELECT remaining_quantity FROM sealed_lot WHERE id=10')).remaining_quantity,1);
 }finally{await db.close();}
});
test('existing sealed edit validation accepts metadata-only changes and rejects financial changes',()=>{
 const existing={quantity:3,remaining_quantity:2,total_cost_cents:100,currency:'USD',purchased_at:'2026-11-01'};
 const money=value=>Math.round(Number(value)*100);
 assert.doesNotThrow(()=>validateSealedLotEdit(existing,{notes:'shelf'},money));
 assert.doesNotThrow(()=>validateSealedLotEdit(existing,{quantity:3,remaining_quantity:2,total_cost:'1.00',currency:'USD'},money));
 assert.throws(()=>validateSealedLotEdit(existing,{remaining_quantity:3},money));
 assert.throws(()=>validateSealedLotEdit(existing,{total_cost:'2.00'},money));
});
