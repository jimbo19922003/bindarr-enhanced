'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { openConnection } = require('./salesRepository');
const { createOpeningBasisRepository } = require('./openingBasisRepository');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'opening-basis-')), file = join(dir, 'test.db');
  await writeFile(file, ''); t.after(() => rm(dir, { recursive: true, force: true }));
  const connect = () => openConnection(file), db = await connect();
  await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2);
  CREATE TABLE collection(id INTEGER PRIMARY KEY,user_id INTEGER,card_id TEXT,quantity INTEGER,list_type TEXT);
  CREATE TABLE sealed_opening(id INTEGER PRIMARY KEY,user_id INTEGER,cost_cents INTEGER,currency TEXT,quantity INTEGER,opened_at TEXT,entry_complete INTEGER,lot_id INTEGER,product_id INTEGER,notes TEXT);
  CREATE TABLE sealed_pull(id INTEGER PRIMARY KEY,user_id INTEGER,opening_id INTEGER,card_id TEXT,collection_id INTEGER,filed_ids TEXT,quantity INTEGER,opened_unit_cents INTEGER,opened_line_cents INTEGER,current_line_cents INTEGER);
  INSERT INTO collection VALUES(10,1,'chase',1,'collection');
  INSERT INTO sealed_opening VALUES(1,1,1000,'USD',1,'2026-11-08',1,1,1,'');
  INSERT INTO sealed_pull VALUES(1,1,1,'chase',10,'10',1,9000,9000,9000),(2,1,1,NULL,NULL,'',1,1000,1000,1000);`);
  await db.close(); return { connect, repo: createOpeningBasisRepository({ connect }) };
}
test('finalization persists copy basis and retains unlinked bulk basis', async t => {
  const { connect, repo } = await fixture(t);
  const result = await repo.finalize(1,1);
  assert.equal(result.status, 'finalized');
  assert.equal(result.lines.reduce((n,line) => n + line.costCents,0),1000);
  assert.equal(result.lines.find(line => line.pullId===1).copies[0].costCents,900);
  assert.equal(result.lines.find(line => line.pullId===2).unlinkedBasisCents,100);
  assert.deepEqual(await repo.finalize(1,1),result);
  const db = await connect();
  try { assert.equal((await db.get('SELECT cost_cents FROM opening_basis_copy WHERE collection_id=10')).cost_cents,900); } finally { await db.close(); }
});
test('finalized provenance rejects edits/deletions but current market quotes may change', async t => {
  const { connect, repo } = await fixture(t); await repo.finalize(1,1);
  const db = await connect();
  try {
    await assert.rejects(db.run('UPDATE sealed_pull SET quantity=2 WHERE id=1'));
    await assert.rejects(db.run('DELETE FROM sealed_pull WHERE id=1'));
    await assert.rejects(db.run('UPDATE sealed_opening SET cost_cents=2000 WHERE id=1'));
    await assert.rejects(db.run('DELETE FROM sealed_opening WHERE id=1'));
    await assert.rejects(db.run('DELETE FROM collection WHERE id=10'));
    await db.run('UPDATE sealed_pull SET current_line_cents=20000 WHERE id=1');
    await db.run("UPDATE sealed_opening SET notes='updated note' WHERE id=1");
  } finally { await db.close(); }
  assert.equal((await repo.finalize(1,1)).lines.find(line => line.pullId===1).costCents,900);
});
test('incomplete or unpriced contents do not create finalized snapshots', async t => {
  const { connect, repo } = await fixture(t); let db = await connect();
  await db.run('UPDATE sealed_opening SET entry_complete=0'); await db.close();
  assert.equal((await repo.finalize(1,1)).status,'pending');
  db = await connect(); await db.run('UPDATE sealed_opening SET entry_complete=1'); await db.run('UPDATE sealed_pull SET opened_line_cents=NULL WHERE id=2'); await db.close();
  assert.equal((await repo.finalize(1,1)).status,'pending');
  db = await connect();
  try { assert.equal((await db.get('SELECT COUNT(*) AS n FROM opening_basis_snapshot')).n,0); } finally { await db.close(); }
});
test('cross-owner finalization and changed filed copies are rejected', async t => {
  const { connect, repo } = await fixture(t);
  await assert.rejects(repo.finalize(2,1),{status:404});
  const db = await connect(); await db.run("UPDATE collection SET list_type='sold' WHERE id=10"); await db.close();
  await assert.rejects(repo.finalize(1,1),{status:409});
});
