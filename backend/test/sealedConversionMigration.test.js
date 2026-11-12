// Databases created by early staged-conversion builds have sealed_product_conversion
// and sealed_pack_lot without the allocation columns. CREATE TABLE IF NOT EXISTS
// leaves those tables alone, so startup has to add the columns or every portfolio
// accounting and performance query fails on c.allocation_status.
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');

const tmpDb = path.join(os.tmpdir(), `bindarr-sealedconversionmigration-${process.pid}.db`);
process.env.DB_PATH = tmpDb;

const db = require('../src/db');

async function cleanup() {
  await new Promise(resolve => { try { db.dbConnection.close(() => resolve()); } catch { resolve(); } });
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDb + suffix); } catch { /* already gone */ }
  }
}

async function main() {
  await db.run(`CREATE TABLE sealed_product_conversion (
    opening_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
    source_cost_cents INTEGER NOT NULL CHECK(source_cost_cents >= 0),
    request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, UNIQUE(user_id, request_id))`);
  await db.run(`CREATE TABLE sealed_pack_lot (lot_id INTEGER PRIMARY KEY, opening_id INTEGER NOT NULL)`);
  await db.run(`INSERT INTO sealed_product_conversion (opening_id, user_id, source_cost_cents, request_id, payload_hash) VALUES (1, 1, 500, 'r', 'h')`);

  await db.initDb();
  await db.initDb();

  const conversionCols = (await db.all('PRAGMA table_info(sealed_product_conversion)')).map(c => c.name);
  assert.deepStrictEqual(conversionCols.filter(name => name.startsWith('allocation_')), ['allocation_status', 'allocation_json']);
  const packCols = (await db.all('PRAGMA table_info(sealed_pack_lot)')).map(c => c.name);
  assert.ok(packCols.includes('market_unit_cents') && packCols.includes('allocated_cost_cents'));
  assert.strictEqual((await db.get('SELECT allocation_status FROM sealed_product_conversion WHERE opening_id = 1')).allocation_status, 'pending',
    'existing conversions stay pending until finalized');
  console.log('PASS: legacy sealed conversion tables gain allocation columns once');
}

main().then(cleanup, async error => { console.error(error); await cleanup(); process.exit(1); });
