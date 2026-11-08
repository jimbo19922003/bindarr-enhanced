'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { openConnection, createSalesRepository, schema } = require('./salesRepository');
const { createOpeningBasisRepository } = require('./openingBasisRepository');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(),'opening-sale-')), path = join(dir,'test.db');
  await writeFile(path,''); t.after(() => rm(dir,{recursive:true,force:true}));
  const connect = () => openConnection(path), db = await connect();
  await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2);
  CREATE TABLE collection(id INTEGER PRIMARY KEY,user_id INTEGER,card_id TEXT,quantity INTEGER,list_type TEXT);
  CREATE TABLE sealed_opening(id INTEGER PRIMARY KEY,user_id INTEGER,cost_cents INTEGER,currency TEXT,quantity INTEGER,opened_at TEXT,entry_complete INTEGER,lot_id INTEGER,product_id INTEGER,notes TEXT);
  CREATE TABLE sealed_pull(id INTEGER PRIMARY KEY,user_id INTEGER,opening_id INTEGER,card_id TEXT,collection_id INTEGER,filed_ids TEXT,quantity INTEGER,opened_unit_cents INTEGER,opened_line_cents INTEGER,current_line_cents INTEGER);
  INSERT INTO collection VALUES(10,1,'chase',1,'collection'),(20,1,'single',1,'collection');
  INSERT INTO sealed_opening VALUES(1,1,1000,'USD',1,'2026-11-08',1,1,1,'');
  INSERT INTO sealed_pull VALUES(1,1,1,'chase',10,'10',1,9000,9000,9000),(2,1,1,NULL,NULL,'',1,1000,1000,1000);`);
  await db.close(); return { connect, sales:createSalesRepository({connect}), basis:createOpeningBasisRepository({connect}) };
}
test('opening to lot to sale uses frozen basis and retries return identical sale IDs', async t => {
  const {connect,sales,basis} = await fixture(t); await basis.finalize(1,1);
  const lot = await sales.createOpeningLot(1,10);
  assert.equal(lot.source,'opening'); assert.equal(lot.original_basis_cents,900);
  assert.equal((await sales.createOpeningLot(1,10)).id,lot.id);
  const input = {lotId:lot.id,requestKey:'opening-sale-1',soldOn:'2026-11-08',quantity:1,proceedsCents:10000,feesCents:1000};
  const sale = await sales.recordSale(1,input);
  assert.equal(sale.realizedGainCents,8100);
  assert.deepEqual(await sales.recordSale(1,input),sale);
  assert.equal((await sales.createOpeningLot(1,10)).id,lot.id);
  const db = await connect();
  try { assert.equal((await db.get('SELECT cost_cents FROM opening_basis_copy WHERE collection_id=10')).cost_cents,900); } finally { await db.close(); }
});
test('frozen copies cannot get direct or unknown lots; owner checks still apply', async t => {
  const {sales,basis} = await fixture(t); await basis.finalize(1,1);
  await assert.rejects(sales.createOpeningLot(2,10),{status:404});
  await assert.rejects(sales.createLot(1,{collectionId:10}),{status:409});
  await assert.rejects(sales.createLot(1,{collectionId:10,source:'direct',basisCents:1}),{status:409});
});
test('unfinalized opening cannot create an opening acquisition lot', async t => {
  const {sales} = await fixture(t);
  await assert.rejects(sales.createOpeningLot(1,10),{status:409});
});
test('v1 accounting upgrade preserves lot and sale IDs and foreign keys', async t => {
  const {connect,sales,basis} = await fixture(t);
  const old = schema.replace("source IN ('direct','unknown','opening')","source IN ('direct','unknown')").replace("source IN ('direct','opening') AND","source = 'direct' AND");
  let db = await connect();
  await db.exec(old);
  await db.run("INSERT INTO card_acquisition_lot(id,user_id,collection_id,source,original_quantity,remaining_quantity,original_basis_cents,remaining_basis_cents,currency) VALUES(7,1,20,'direct',1,0,100,0,'USD')");
  await db.run("INSERT INTO card_sale_record(id,user_id,lot_id,request_key,request_json,result_json,sold_on,quantity,proceeds_cents,fees_cents,sold_basis_cents,realized_gain_cents,currency,card_id) VALUES(11,1,7,'legacy-sale','{}','{}','2026-11-07',1,200,0,100,100,'USD','single')");
  await db.close();
  await basis.finalize(1,1); await sales.createOpeningLot(1,10);
  db = await connect();
  try {
    assert.equal((await db.get('SELECT realized_gain_cents FROM card_sale_record WHERE id=11')).realized_gain_cents,100);
    assert.equal((await db.get('SELECT original_basis_cents FROM card_acquisition_lot WHERE id=7')).original_basis_cents,100);
    assert.deepEqual(await db.all('PRAGMA foreign_key_check'),[]);
  } finally { await db.close(); }
});
