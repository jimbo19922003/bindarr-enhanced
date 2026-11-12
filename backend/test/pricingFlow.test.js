'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

test('search, add preview, collection and rip use the same persisted finish quote and opening snapshot', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pricing-flow-'));
  process.env.DB_PATH = path.join(root, 'test.db');
  process.env.DEFAULT_ADMIN_PASSWORD = 'pricing-test-password';
  const db = require('../src/db');
  await db.initDb();
  const user = await db.get("SELECT id FROM users WHERE username = 'admin'");
  await db.run('UPDATE app_settings SET pokemon_local_catalog_enabled = 1 WHERE id = 1');
  const id = 'tcgdex-en-base1-4';
  await db.run(`INSERT INTO card_cache (id, name, set_id, set_name, number, game, language, price_trend, price_currency, price_source)
    VALUES (?, 'Charizard', 'base1', 'Base Set', '4', 'pokemon', 'English', 999, 'EUR', 'tcgdex')`, [id]);
  const searchApi = require('../src/utils/searchApi');
  const previousSearch = searchApi.searchApiFor;
  searchApi.searchApiFor = async () => ({ localOnly: true, searchCards: async () => ({ cards: [
    { ...await db.get('SELECT * FROM card_cache WHERE id = ?', [id]), price_trend: 999 },
  ], total: 1 }) });
  const pricingModule = require('../src/pokemonPrices');
  const previousPrices = pricingModule.getPokemonPrices;
  let apiCalls = 0;
  const asOf = new Date(Date.now() - 3600000).toISOString();
  const { recordPrice, recordFinishPrices } = require('../src/utils/priceHelpers');
  const prices = pricingModule.createPokemonPrices({
    database: db, recordPrice, recordFinishPrices, refreshDays: async () => 1,
    carddex: { json: async () => { apiCalls++; throw new Error('fresh mirror must not spend API calls'); } },
    pokewallet: { priceFallback: async () => { apiCalls++; throw new Error('must not run'); } },
    tcgcsv: { quoteForCard: async () => ({ price_trend: 42, price_normal: 20, price_holofoil: 42,
      price_reverse_holofoil: 30, price_1st_edition: null, productId: 123, source: 'tcgcsv', asOf }) },
  });
  pricingModule.getPokemonPrices = () => prices;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api', require('../src/routes/collection'));
  app.use('/api', require('../src/routes/sealed'));
  app.use('/api', require('../src/routes/sealedOpenings'));
  const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  t.after(async () => {
    searchApi.searchApiFor = previousSearch;
    pricingModule.getPokemonPrices = previousPrices;
    await new Promise(resolve => server.close(resolve));
    await new Promise((resolve, reject) => db.dbConnection.close(error => error ? reject(error) : resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });
  const call = async (method, url, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.ok(response.ok, `${method} ${url}: ${JSON.stringify(result)}`);
    return result;
  };
  const search = await call('GET', '/search?game=pokemon&name=Charizard');
  assert.equal(search[0].price_holofoil, 42);
  assert.equal(search[0].price_source, 'tcgcsv');
  const preview = await call('GET', `/cards/${id}/price-quote`);
  assert.equal(preview.price_as_of, asOf);
  await call('POST', '/collection', { card_id: id, quantity: 1, printing: 'Reverse Holofoil', language: 'English' });
  const copies = await call('GET', '/collection');
  assert.equal(copies[0].price_trend, 30);
  assert.equal(copies[0].price_as_of, asOf);
  const product = await call('POST', '/sealed/products', { name: 'Test pack', product_type: 'booster_pack', language: 'English' });
  const lot = await call('POST', `/sealed/products/${product.product.id}/lots`, { quantity: 1, total_cost: '5.00', currency: 'USD' });
  const opened = await call('POST', `/sealed/lots/${lot.product.lots[0].id}/openings`, {
    entry_complete: true, pulls: [{ card_id: id, quantity: 1, printing: 'Reverse Holofoil' }],
  });
  assert.equal(opened.opening.pulls[0].current_value, '30.00');
  assert.equal(opened.opening.pulls[0].value_at_opening, '30.00');
  await db.run('UPDATE card_cache SET price_reverse_holofoil = 35 WHERE id = ?', [id]);
  const reread = await call('GET', `/sealed/openings/${opened.opening.id}`);
  assert.equal(reread.opening.pulls[0].value_at_opening, '30.00', 'later quotes must not rewrite the opening snapshot');
  assert.equal(apiCalls, 0);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM price_history WHERE card_id = ?', [id])).n, 1);
});
