'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createSalesRepository, openConnection } = require('./salesRepository');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bindarr-sales-')), path = join(dir, 'test.db');
  await writeFile(path, '');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const connect = () => openConnection(path), db = await connect();
  await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2);
    CREATE TABLE collection(id INTEGER PRIMARY KEY, user_id INTEGER, card_id TEXT, quantity INTEGER, list_type TEXT);
    CREATE TABLE sealed_pull(user_id INTEGER, collection_id INTEGER, filed_ids TEXT);
    INSERT INTO collection VALUES(10,1,'card-a',3,'collection'),(20,2,'card-b',1,'collection');`);
  await db.close(); return { connect, repo: createSalesRepository({ connect }) };
}
test('sale persists basis and inventory together; cross-owner writes are rejected', async t => {
  const { repo, connect } = await fixture(t);
  await assert.rejects(repo.createLot(2, { collectionId: 10 }), { status: 404 });
  const lot = await repo.createLot(1, { collectionId: 10, source: 'direct', basisCents: 100 });
  await assert.rejects(repo.recordSale(2, { lotId: lot.id, requestKey: 'request-a', soldOn: '2026-11-08', quantity: 1, proceedsCents: 100 }), { status: 404 });
  const result = await repo.recordSale(1, { lotId: lot.id, requestKey: 'request-a', soldOn: '2026-11-08', quantity: 1, proceedsCents: 100, feesCents: 10 });
  assert.equal(result.realizedGainCents, 57);
  const db = await connect();
  try {
    assert.equal((await db.get('SELECT quantity FROM collection WHERE id=10')).quantity, 2);
    assert.equal((await db.get('SELECT remaining_basis_cents FROM card_acquisition_lot')).remaining_basis_cents, 67);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM card_sale_record')).n, 1);
  } finally { await db.close(); }
});
test('duplicate requests cannot sell twice; conflicting retries fail', async t => {
  const { repo, connect } = await fixture(t);
  const lot = await repo.createLot(1, { collectionId: 10 });
  const sale = { lotId: lot.id, requestKey: 'request-b', soldOn: '2026-11-08', quantity: 3, proceedsCents: 100 };
  assert.equal((await repo.recordSale(1, sale)).realizedGainCents, null);
  assert.equal((await repo.recordSale(1, sale)).realizedGainCents, null);
  await assert.rejects(repo.recordSale(1, { ...sale, proceedsCents: 200 }), { status: 409 });
  const db = await connect();
  try {
    assert.equal((await db.get('SELECT list_type FROM collection WHERE id=10')).list_type, 'sold');
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM card_sale_record')).n, 1);
  } finally { await db.close(); }
});
test('a failed sale insert rolls back both inventory and lot changes', async t => {
  const { repo, connect } = await fixture(t);
  const lot = await repo.createLot(1, { collectionId: 10, source: 'direct', basisCents: 100 });
  let db = await connect();
  await db.exec("CREATE TRIGGER fail_sale BEFORE INSERT ON card_sale_record BEGIN SELECT RAISE(ABORT, 'forced failure'); END;"); await db.close();
  await assert.rejects(repo.recordSale(1, { lotId: lot.id, requestKey: 'request-c', soldOn: '2026-11-08', quantity: 1, proceedsCents: 100 }));
  db = await connect();
  try {
    assert.equal((await db.get('SELECT quantity FROM collection WHERE id=10')).quantity, 3);
    assert.equal((await db.get('SELECT remaining_basis_cents FROM card_acquisition_lot')).remaining_basis_cents, 100);
  } finally { await db.close(); }
});
test('known opening copies cannot become direct-purchase lots', async t => {
  const { repo, connect } = await fixture(t);
  const db = await connect(); await db.run("INSERT INTO sealed_pull VALUES(1, NULL, '10,11')"); await db.close();
  await assert.rejects(repo.createLot(1, { collectionId: 10, source: 'direct', basisCents: 100 }), { status: 409 });
});
