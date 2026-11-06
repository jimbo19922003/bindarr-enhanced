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
const pokewallet = require('../src/pokewalletApi');
const sealedRoutes = require('../src/routes/sealed');

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures/pokewallet/search-mewtwo.json'),
  'utf8'
));
const etb = fixture.results.find(row => row.card_info && row.card_info.product_type === 'sealed');

const calls = { groups: 0, products: [], searches: [] };
let mode = 'results';
let quotePrice = 89.99;

const extra = [
  {
    id: 'pk_cccccccccccccccccccccccccccccccc',
    card_info: {
      name: 'Surging Sparks Booster Box',
      set_name: 'Surging Sparks',
      set_code: 'SV08',
      product_type: 'sealed',
    },
    tcgplayer: {
      url: 'https://www.tcgplayer.com/product/12',
      prices: [{ sub_type_name: 'Normal', market_price: 0, mid_price: 110 }],
    },
  },
  {
    id: 'pk_dddddddddddddddddddddddddddddddd',
    card_info: { name: 'Surging Sparks Code Card', product_type: 'sealed' },
    tcgplayer: {
      url: 'https://www.tcgplayer.com/product/14',
      prices: [{ sub_type_name: 'Normal', market_price: 1 }],
    },
  },
];

function searchBody() {
  return { results: [...fixture.results, ...extra] };
}

catalog.resetForTests();
catalog.setClient({
  getGroups: async (categoryId) => {
    calls.groups += 1;
    return categoryId === 3
      ? [{ groupId: 24325, name: 'SV08: Surging Sparks', abbreviation: 'SV08', categoryId: 3 }]
      : [];
  },
  getProducts: async (categoryId, groupId) => {
    calls.products.push([categoryId, groupId]);
    return [];
  },
  getPrices: async () => [],
  get: async () => { throw new Error('no stamp'); },
});
catalog.setPokewallet({
  search: async (query) => {
    calls.searches.push(query);
    if (mode === 'key_missing') {
      const err = new Error('key_missing');
      err.code = 'key_missing';
      throw err;
    }
    if (mode === 'rate_limited') {
      const err = new Error('rate_limited');
      err.code = 'rate_limited';
      throw err;
    }
    return { body: searchBody() };
  },
  load: async (id) => {
    const copy = JSON.parse(JSON.stringify(etb));
    assert.strictEqual(id, copy.id);
    copy.tcgplayer.prices[0].market_price = quotePrice;
    return { body: copy };
  },
});

function samplePrices() {
  return [
    { productId: 11, subTypeName: 'Normal', marketPrice: 49.95, midPrice: 55 },
    { productId: 12, subTypeName: 'Normal', marketPrice: 0, midPrice: 110 },
  ];
}

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
  assert.strictEqual(catalog.marketCents(samplePrices(), 12), null);
  assert.strictEqual(catalog.marketCents(samplePrices(), 11), 4995);

  await db.initDb();
  await db.run(
    `INSERT INTO sealed_catalog (
       provider, provider_product_id, category_id, group_id, name, product_type, language, set_name, fetched_at
     ) VALUES ('tcgcsv', 'keep', 3, 1, 'Keep Me', 'other', 'English', 'Keep', '2020-01-01T00:00:00.000Z')`
  );
  await db.initDb();
  const kept = await db.get(`SELECT name FROM sealed_catalog WHERE provider_product_id = 'keep'`);
  assert.strictEqual(kept.name, 'Keep Me');

  await assert.rejects(() => catalog.search('a'), err => err.status === 400);

  const found = await catalog.search('mewtwo 30th');
  assert.deepStrictEqual(calls.searches, ['mewtwo 30th']);
  assert.strictEqual(calls.groups, 0);
  assert.deepStrictEqual(calls.products, []);
  const names = found.results.map(row => row.name);
  assert.ok(names.includes('Mewtwo Elite Trainer Box'));
  assert.ok(names.includes('Surging Sparks Booster Box'));
  assert.ok(!names.includes('Mewtwo'));
  assert.ok(!names.some(name => name.includes('Code Card')));

  const box = found.results.find(row => row.name === 'Mewtwo Elite Trainer Box');
  assert.strictEqual(box.product_type, 'etb');
  assert.strictEqual(box.provider, 'pokewallet');
  assert.strictEqual(box.provider_product_id, 'pk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.strictEqual(box.market_price, '89.99');
  assert.strictEqual(box.market_currency, 'USD');
  assert.strictEqual(box.market_source, 'pokewallet');
  assert.strictEqual(box.set_id, '30th');
  assert.strictEqual(box.set_name, 'Celebrations: Classic Collection');
  assert.strictEqual(box.image_url, 'https://tcgplayer-cdn.tcgplayer.com/product/999999_200w.jpg');

  const unpriced = found.results.find(row => row.name === 'Surging Sparks Booster Box');
  assert.strictEqual(unpriced.product_type, 'booster_box');
  assert.strictEqual(unpriced.market_price, null);
  assert.strictEqual(unpriced.market_source, '');

  mode = 'key_missing';
  await assert.rejects(
    () => catalog.search('mewtwo'),
    err => err.status === 400 && /PokéWallet API key/.test(err.message)
  );
  // The real client, with no key saved, must stop before any network call.
  catalog.setPokewallet({ search: (query) => pokewallet.searchCatalog(query) });
  await assert.rejects(
    () => catalog.search('elite trainer box'),
    err => err.status === 400 && /PokéWallet API key/.test(err.message)
  );
  catalog.setPokewallet({
    search: async (query) => {
      calls.searches.push(query);
      if (mode === 'key_missing') {
        const err = new Error('key_missing');
        err.code = 'key_missing';
        throw err;
      }
      if (mode === 'rate_limited') {
        const err = new Error('rate_limited');
        err.code = 'rate_limited';
        throw err;
      }
      return { body: searchBody() };
    },
    load: async (id) => {
      const copy = JSON.parse(JSON.stringify(etb));
      assert.strictEqual(id, copy.id);
      copy.tcgplayer.prices[0].market_price = quotePrice;
      return { body: copy };
    },
  });
  mode = 'rate_limited';
  await assert.rejects(() => catalog.search('mewtwo'), err => err.status === 429);
  mode = 'results';

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

  mode = 'key_missing';
  const missing = await send(port, 'GET', '/api/sealed/catalog?q=mewtwo', admin.id);
  assert.strictEqual(missing.status, 400, JSON.stringify(missing.body));
  assert.match(missing.body.error, /PokéWallet API key/);
  mode = 'results';

  const created = await send(port, 'POST', '/api/sealed/products', admin.id, {
    ...box,
    lot: { quantity: 1, total_cost: '45.00', currency: 'USD', purchased_at: '2026-11-01' },
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  assert.strictEqual(created.body.product.market_source, 'pokewallet');
  assert.strictEqual(created.body.product.market_price, '89.99');
  assert.strictEqual(created.body.product.image_url, box.image_url);
  assert.strictEqual(created.body.product.lots.length, 1);

  const second = await send(port, 'POST', '/api/sealed/products', admin.id, {
    ...box,
    lot: { quantity: 1, total_cost: '60.00', currency: 'USD' },
  });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.existed, true);
  assert.strictEqual(second.body.product.lots.length, 2);
  assert.deepStrictEqual(second.body.product.lots.map(lot => lot.total_cost).sort(), ['45.00', '60.00']);

  quotePrice = 55;
  const quoted = await send(port, 'POST', `/api/sealed/products/${created.body.product.id}/quote`, admin.id);
  assert.strictEqual(quoted.status, 200, JSON.stringify(quoted.body));
  assert.strictEqual(quoted.body.product.market_price, '55.00');
  assert.strictEqual(quoted.body.product.market_source, 'pokewallet');
  assert.strictEqual(calls.groups, 0);

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
