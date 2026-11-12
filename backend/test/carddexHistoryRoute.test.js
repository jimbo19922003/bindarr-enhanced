'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const file = path.join(os.tmpdir(), `bindarr-carddex-history-${process.pid}.db`);
process.env.DB_PATH = file;
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
const db = require('../src/db');
const prices = require('../src/pokemonPrices');

async function main() {
  await db.initDb();
  await db.run(`INSERT INTO card_cache (id, name, set_id, set_name, number, game, language, price_trend, price_currency, price_source)
    VALUES ('tcgdex-en-base1-4', 'Charizard', 'base1', 'Base Set', '4', 'pokemon', 'English', 12, 'EUR', 'carddex-cardmarket')`);
  await db.run(`INSERT INTO collection (user_id, card_id, quantity, game)
    VALUES (1, 'tcgdex-en-base1-4', 1, 'pokemon')`);
  await db.run(`CREATE TABLE carddex_price_attempt (card_id TEXT PRIMARY KEY, quote_at TEXT)`);
  await db.run(`INSERT INTO carddex_price_attempt VALUES ('tcgdex-en-base1-4', '2026-11-09T07:00:00Z')`);
  let calls = 0, cachedCalls = 0;
  prices.getPokemonPrices = () => ({ initialize: async () => {}, cachedHistory: async () => {
    cachedCalls++;
    return [];
  }, history: async () => {
    calls++;
    return { status: 'fresh', points: [{ price: 11, recorded_at: new Date(Date.now() - 86400000).toISOString() }] };
  } });
  const app = express();
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-test-user']) }; next(); });
  app.use('/api', require('../src/routes/stats'));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/cards/tcgdex-en-base1-4/price-history?range=30d`;
    const owned = await fetch(url, { headers: { 'x-test-user': '1' } });
    assert.equal(owned.status, 200);
    const result = await owned.json();
    assert.equal(result.carddexHistoryStatus, 'fresh');
    assert.equal(result.quoteAt, null, 'legacy attempt metadata must not invent a source timestamp');
    assert.equal(result.carddexCount, 1);
    assert.ok(result.data.some(point => point.source === 'carddex' && point.price === 11));
    const asOf = new Date(Date.now() - 3600000).toISOString();
    await db.run('UPDATE card_cache SET price_as_of = ? WHERE id = ?', [asOf, 'tcgdex-en-base1-4']);
    const dated = await (await fetch(url, { headers: { 'x-test-user': '1' } })).json();
    assert.equal(dated.quoteAt, asOf);
    assert.ok(dated.data.some(point => point.source === 'current' && point.recorded_at === asOf));
    const other = await fetch(url, { headers: { 'x-test-user': '2' } });
    assert.equal(other.status, 200);
    assert.equal((await other.json()).carddexHistoryStatus, 'cached');
    assert.equal(calls, 2, 'history must only be fetched for an owned or decked card');
    assert.equal(cachedCalls, 1, 'unowned cards may read cached history without fetching');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().then(() => {
  for (const suffix of ['', '-wal', '-shm']) try { fs.unlinkSync(file + suffix); } catch { /* absent */ }
  console.log('carddexHistoryRoute.test.js: all assertions passed');
  process.exit(0);
}).catch(error => { console.error(error); process.exit(1); });
