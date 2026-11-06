'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');

const dbPath = path.join(os.tmpdir(), `bindarr-sealed-catalog-${process.pid}.db`);
process.env.DB_PATH = dbPath;
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';

const db = require('../src/db');
const catalog = require('../src/utils/sealedCatalog');
const sealedRoutes = require('../src/routes/sealed');

const calls = { groups: 0, products: [] };
let etbPrice = 49.95;

const groups = {
  3: [
    { groupId: 24325, name: 'SV08: Surging Sparks', abbreviation: 'SV08', categoryId: 3 },
    { groupId: 3170, name: 'SWSH12: Silver Tempest', abbreviation: 'SWSH12', categoryId: 3 },
  ],
  85: [],
};

function sampleProducts() {
  return [
    { productId: 10, name: 'Pikachu', imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/10_200w.jpg', extendedData: [{ name: 'Number', value: '001/191' }] },
    { productId: 11, name: 'Surging Sparks Elite Trainer Box', imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/11_200w.jpg', extendedData: [] },
    { productId: 12, name: 'Surging Sparks Booster Box', imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/12_200w.jpg', extendedData: [] },
    { productId: 13, name: 'Surging Sparks Sleeved Booster Pack', imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/13_200w.jpg', extendedData: [] },
    { productId: 14, name: 'Surging Sparks Code Card', imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/14_200w.jpg', extendedData: [] },
    { productId: 15, name: 'Surging Sparks Mini Tin', imageUrl: 'javascript:alert(1)', extendedData: [] },
  ];
}

function samplePrices() {
  return [
    { productId: 11, subTypeName: 'Normal', marketPrice: etbPrice, midPrice: 55 },
    { productId: 12, subTypeName: 'Normal', marketPrice: 0, midPrice: 110 },
    { productId: 13, subTypeName: 'Normal', marketPrice: 4.5, midPrice: 5 },
    { productId: 15, subTypeName: 'Normal', marketPrice: 19.99, midPrice: 22 },
  ];
}

catalog.resetForTests();
catalog.setClient({
  getGroups: async (categoryId) => {
    calls.groups += 1;
    return groups[categoryId] || [];
  },
  getProducts: async (categoryId, groupId) => {
    calls.products.push([categoryId, groupId]);
    return groupId === 24325 ? sampleProducts() : [];
  },
  getPrices: async () => samplePrices(),
  get: async () => { throw new Error('no stamp'); },
});

function send(port, method, urlPath, userId, body, role) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers: {
        'x-test-user': String(userId),
        'x-test-role': role || 'admin',
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        try { parsed = JSON.parse(text); } catch { /* leave text */ }
        resolve({ status: res.statusCode, body: parsed, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  assert.strictEqual(catalog.sealedKind({ name: 'Pikachu', extendedData: [{ name: 'Number', value: '4' }] }), null);
  assert.strictEqual(catalog.sealedKind({ name: 'Surging Sparks Code Card', extendedData: [] }), null);
  assert.strictEqual(catalog.sealedKind({ name: 'Surging Sparks Elite Trainer Box' }), 'etb');
  assert.strictEqual(catalog.sealedKind({ name: 'Surging Sparks Booster Box' }), 'booster_box');
  assert.strictEqual(catalog.sealedKind({ name: 'Surging Sparks Sleeved Booster Pack' }), 'booster_pack');
  assert.strictEqual(catalog.marketCents(samplePrices(), 12), null);
  assert.strictEqual(catalog.marketCents(samplePrices(), 11), 4995);

  await db.initDb();
  const before = await db.run(
    `INSERT INTO sealed_catalog (
       provider, provider_product_id, category_id, group_id, name, product_type, language, set_name, fetched_at
     ) VALUES ('tcgcsv', 'keep', 3, 1, 'Keep Me', 'other', 'English', 'Keep', '2020-01-01T00:00:00.000Z')`
  );
  assert.ok(before.lastID == null || before.changes === 1);
  await db.initDb();
  const kept = await db.get(`SELECT name FROM sealed_catalog WHERE provider_product_id = 'keep'`);
  assert.strictEqual(kept.name, 'Keep Me');
  await db.run(`DELETE FROM sealed_catalog`);

  const bare = await catalog.search('elite trainer box');
  assert.strictEqual(bare.results.length, 0);
  assert.strictEqual(bare.needsSet, true);
  assert.deepStrictEqual(calls.products, []);

  const found = await catalog.search('Surging Sparks Elite Trainer Box');
  assert.deepStrictEqual(calls.products, [[3, 24325]]);
  assert.strictEqual(found.results.length, 1);
  assert.strictEqual(found.results[0].name, 'Surging Sparks Elite Trainer Box');
  assert.strictEqual(found.results[0].product_type, 'etb');
  assert.strictEqual(found.results[0].market_price, '49.95');
  assert.strictEqual(found.results[0].market_currency, 'USD');
  assert.strictEqual(found.results[0].image_url, 'https://tcgplayer-cdn.tcgplayer.com/product/11_200w.jpg');
  assert.strictEqual(found.results[0].set_name, 'Surging Sparks');
  assert.ok(!found.results.some(row => row.name === 'Pikachu' || row.name.includes('Code Card')));

  const again = await catalog.search('Surging Sparks Elite Trainer Box');
  assert.strictEqual(again.fetchedGroups, 0);
  assert.deepStrictEqual(calls.products, [[3, 24325]]);
  assert.strictEqual(calls.groups, 2);

  const box = await catalog.search('Surging Sparks Booster Box');
  assert.strictEqual(box.results.length, 1);
  assert.strictEqual(box.results[0].product_type, 'booster_box');
  assert.strictEqual(box.results[0].market_price, null);

  const tin = await catalog.search('Surging Sparks Mini Tin');
  assert.strictEqual(tin.results[0].product_type, 'tin');
  assert.strictEqual(tin.results[0].image_url, '');

  const named = await catalog.search('elite trainer box');
  assert.strictEqual(named.results.length, 1);
  assert.strictEqual(named.results[0].provider_product_id, '11');

  await db.run(`DELETE FROM sealed_catalog`);
  await db.run(`UPDATE sealed_catalog_group SET products_fetched_at = NULL`);
  calls.products.length = 0;
  const firstTin = await catalog.search('Surging Sparks Mini Tin');
  assert.deepStrictEqual(calls.products, [[3, 24325]]);
  assert.strictEqual(firstTin.results[0].product_type, 'tin');
  assert.strictEqual(firstTin.results[0].market_price, '19.99');

  const admin = await db.get(`SELECT id FROM users WHERE username = 'admin'`);
  const member = await db.run(
    `INSERT INTO users (username, password_hash, role, share_token, api_key) VALUES ('member', 'x', 'member', 'member-catalog', 'member-catalog-key')`
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: Number(req.headers['x-test-user']), role: req.headers['x-test-role'] || 'admin' };
    next();
  });
  app.use('/api', sealedRoutes);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const pick = found.results[0];
  const created = await send(port, 'POST', '/api/sealed/products', admin.id, {
    ...pick,
    lot: { quantity: 1, total_cost: '45.00', currency: 'USD', purchased_at: '2026-11-01' },
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.product.market_source, 'tcgcsv');
  assert.strictEqual(created.body.product.market_price, '49.95');
  assert.strictEqual(created.body.product.image_url, pick.image_url);
  assert.strictEqual(created.body.product.lots.length, 1);

  const second = await send(port, 'POST', '/api/sealed/products', admin.id, {
    ...pick,
    lot: { quantity: 1, total_cost: '60.00', currency: 'USD' },
  });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.existed, true);
  assert.strictEqual(second.body.product.lots.length, 2);
  assert.deepStrictEqual(second.body.product.lots.map(lot => lot.total_cost).sort(), ['45.00', '60.00']);

  etbPrice = 55;
  await db.run(`UPDATE sealed_catalog_group SET products_fetched_at = '2020-01-01T00:00:00.000Z' WHERE group_id = 24325`);
  const quoted = await send(port, 'POST', `/api/sealed/products/${created.body.product.id}/quote`, admin.id);
  assert.strictEqual(quoted.status, 200, JSON.stringify(quoted.body));
  assert.strictEqual(quoted.body.product.market_price, '55.00');
  assert.strictEqual(quoted.body.product.market_source, 'tcgcsv');
  assert.ok(calls.products.length >= 2);

  const denied = await send(port, 'POST', '/api/sealed/catalog/sync', member.lastID, null, 'member');
  assert.strictEqual(denied.status, 403);

  const started = await send(port, 'POST', '/api/sealed/catalog/sync', admin.id);
  assert.strictEqual(started.status, 202);
  assert.strictEqual(started.body.running, true);
  let state = started.body;
  for (let i = 0; i < 20 && state.running; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
    state = (await send(port, 'GET', '/api/sealed/catalog/status', admin.id)).body;
  }
  assert.strictEqual(state.running, false);
  assert.strictEqual(state.phase, 'done');

  await new Promise(resolve => server.close(resolve));
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* already gone */ }
  }
  console.log('sealedCatalog.test.js: all assertions passed');
}

main().catch((err) => {
  console.error(err);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* already gone */ }
  }
  process.exit(1);
});
