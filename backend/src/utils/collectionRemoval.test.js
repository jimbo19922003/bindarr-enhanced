'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {openConnection,schema}=require('./salesRepository');
const removal=require('./collectionRemoval');
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'collection-removal-')),file=path.join(directory,'db.sqlite');await fs.writeFile(file,'');const db=await openConnection(file);
 t.after(async()=>{await db.close();await fs.rm(directory,{recursive:true,force:true});});
 await db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);CREATE TABLE collection(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),card_id TEXT,quantity INTEGER,list_type TEXT,purchase_price REAL,notes TEXT);CREATE TABLE sealed_pull(user_id INTEGER,collection_id INTEGER,filed_ids TEXT);CREATE TABLE opening_basis_copy(collection_id INTEGER);CREATE TABLE decks(id INTEGER PRIMARY KEY,user_id INTEGER,checked_out INTEGER);CREATE TABLE deck_cards(deck_id INTEGER,card_id TEXT,quantity INTEGER);");
 await db.exec(schema);
 await db.run("INSERT INTO collection VALUES(10,1,'card',1,'collection',0,'original note')");
 await db.run("INSERT INTO card_acquisition_lot(user_id,collection_id,source,original_quantity,remaining_quantity,original_basis_cents,remaining_basis_cents,currency) VALUES(1,10,'direct',1,1,0,0,'USD')");
 await db.run("CREATE TRIGGER sales_protect_card_delete BEFORE DELETE ON collection WHEN EXISTS(SELECT 1 FROM card_acquisition_lot WHERE collection_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Acquisition history protects this copy from deletion'); END");
 await removal.prepare(db);return db;
}
test('old databases upgrade and a confirmed free card deletes atomically with an immutable audit',async t=>{
 const db=await fixture(t);await removal.prepare(db);await db.run('DELETE FROM collection WHERE id=10 AND user_id=1');
 assert.equal(await db.get('SELECT id FROM collection WHERE id=10'),undefined);assert.equal(await db.get('SELECT id FROM card_acquisition_lot WHERE collection_id=10'),undefined);
 const audit=await db.get('SELECT * FROM collection_removal_audit');assert.equal(JSON.parse(audit.entry_json).notes,'original note');assert.equal(JSON.parse(audit.acquisition_json).original_basis_cents,0);
 await assert.rejects(db.run('DELETE FROM collection_removal_audit'),/append-only/);await assert.rejects(db.run("UPDATE collection_removal_audit SET reason='changed'"),/append-only/);assert.deepEqual(await db.all('PRAGMA foreign_key_check'),[]);
});
test('paid unsold acquisitions are archived in full before removal',async t=>{const db=await fixture(t);await db.run('UPDATE collection SET purchase_price=12.34 WHERE id=10');await db.run('UPDATE card_acquisition_lot SET original_basis_cents=1234,remaining_basis_cents=1234 WHERE collection_id=10');await db.run('DELETE FROM collection WHERE id=10');assert.equal(JSON.parse((await db.get('SELECT acquisition_json FROM collection_removal_audit')).acquisition_json).original_basis_cents,1234);});
test('unknown basis remains null in the removal audit',async t=>{const db=await fixture(t);await db.run("UPDATE card_acquisition_lot SET source='unknown',original_basis_cents=NULL,remaining_basis_cents=NULL WHERE collection_id=10");await db.run('DELETE FROM collection WHERE id=10');assert.equal(JSON.parse((await db.get('SELECT acquisition_json FROM collection_removal_audit')).acquisition_json).original_basis_cents,null);});
test('sale history blocks deletion even if the inventory appears restored',async t=>{
 const db=await fixture(t),lot=await db.get('SELECT id FROM card_acquisition_lot WHERE collection_id=10');
 await db.run("INSERT INTO card_sale_record(user_id,lot_id,request_key,request_json,result_json,sold_on,quantity,proceeds_cents,fees_cents,sold_basis_cents,realized_gain_cents,currency,card_id) VALUES(1,?,'test-sale','{}','{}','2026-11-08',1,100,0,0,100,'USD','card')",[lot.id]);
 await assert.rejects(db.run('DELETE FROM collection WHERE id=10'),/sale history/);assert.ok(await db.get('SELECT id FROM collection WHERE id=10'));assert.ok(await db.get('SELECT id FROM card_acquisition_lot WHERE collection_id=10'));assert.equal((await db.get('SELECT COUNT(*) n FROM collection_removal_audit')).n,0);
});
test('opening links and finalized allocations cannot be erased by ordinary deletion',async t=>{const db=await fixture(t);await db.run("INSERT INTO sealed_pull VALUES(1,NULL,'9, 10,11')");await assert.rejects(db.run('DELETE FROM collection WHERE id=10'),/sealed opening/);await db.run('DELETE FROM sealed_pull');await db.run('INSERT INTO opening_basis_copy VALUES(10)');await assert.rejects(db.run('DELETE FROM collection WHERE id=10'),/finalized opening/);});
test('checked-out decks protect their card requirements',async t=>{const db=await fixture(t);await db.run('INSERT INTO decks VALUES(1,1,1)');await db.run("INSERT INTO deck_cards VALUES(1,'card',1)");await assert.rejects(db.run('DELETE FROM collection WHERE id=10'),/checked-out deck/);});
test('a failed outer transaction restores the entry, acquisition and audit together',async t=>{const db=await fixture(t);await db.run('BEGIN IMMEDIATE');await db.run('DELETE FROM collection WHERE id=10');await db.run('ROLLBACK');assert.ok(await db.get('SELECT id FROM collection WHERE id=10'));assert.ok(await db.get('SELECT id FROM card_acquisition_lot WHERE collection_id=10'));assert.equal((await db.get('SELECT COUNT(*) n FROM collection_removal_audit')).n,0);});
test('mismatched ownership or changed remaining balances fail closed',async t=>{const db=await fixture(t);await db.run('UPDATE card_acquisition_lot SET user_id=2 WHERE collection_id=10');await assert.rejects(db.run('DELETE FROM collection WHERE id=10'),/accounting correction/);});
test('custom deletion protections are never silently replaced',async t=>{const db=await fixture(t);await db.run('DROP TRIGGER sales_protect_card_delete');await db.run("CREATE TRIGGER sales_protect_card_delete BEFORE DELETE ON collection BEGIN SELECT RAISE(ABORT,'custom'); END");await assert.rejects(removal.prepare(db),/Unreviewed/);});
