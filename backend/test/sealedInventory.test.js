'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');

const dbPath = path.join(os.tmpdir(), `bindarr-sealed-${process.pid}.db`);
process.env.DB_PATH = dbPath;
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';

const db = require('../src/db');
const sealed = require('../src/utils/sealedInventory');
const sealedRoutes = require('../src/routes/sealed');
const statsRoutes = require('../src/routes/stats');

function send(port, method, urlPath, userId, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers: {
        'x-test-user': String(userId),
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        try { parsed = JSON.parse(text); } catch { /* csv */ }
        resolve({ status: res.statusCode, body: parsed, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  assert.strictEqual(sealed.moneyToCents('19.99', 'Total cost'), 1999);
  assert.strictEqual(sealed.moneyToCents(19.99, 'Total cost'), 1999);
  assert.strictEqual(sealed.moneyToCents('0', 'Market price'), 0);
  assert.throws(() => sealed.moneyToCents('1.005', 'Total cost'), TypeError);
  assert.strictEqual(sealed.remainingCostCents({ quantity: 2, totalCostCents: 9000, remainingQuantity: 1 }), 4500);
  assert.strictEqual(sealed.remainingCostCents({ quantity: 3, totalCostCents: 100, remainingQuantity: 2 }), 67);
  assert.strictEqual(sealed.remainingCostCents({ quantity: 3, totalCostCents: 100, remainingQuantity: 0 }), 0);
  assert.strictEqual(sealed.remainingCostCents({ quantity: 3, totalCostCents: 100, remainingQuantity: 3 }), 100);

  const priced = sealed.summarizeHoldings([
    { remainingQuantity: 1, remainingCostCents: 4500, currency: 'USD', marketPriceCents: 3801, marketCurrency: 'USD' },
    { remainingQuantity: 1, remainingCostCents: 6000, currency: 'USD', marketPriceCents: 3801, marketCurrency: 'USD' },
    { remainingQuantity: 2, remainingCostCents: 1000, currency: 'EUR', marketPriceCents: null, marketCurrency: null },
    { remainingQuantity: 1, remainingCostCents: 0, currency: 'USD', marketPriceCents: 0, marketCurrency: 'USD' },
  ]);
  assert.strictEqual(priced.remainingUnits, 5);
  assert.strictEqual(priced.unpricedUnits, 2);
  assert.strictEqual(priced.marketValue, 76.02);
  assert.strictEqual(priced.cost, 115);
  assert.strictEqual(priced.valuationComplete, false);
  assert.deepStrictEqual(priced.currencies, ['EUR', 'USD']);

  await db.initDb();
  const admin = await db.get(`SELECT id FROM users WHERE username = 'admin'`);
  const member = await db.run(
    `INSERT INTO users (username, password_hash, role, share_token, api_key) VALUES ('member', 'x', 'member', 'member-sealed', 'member-sealed-key')`
  );
  await db.run(
    `INSERT INTO card_cache (id, name, game, price_trend, price_currency, price_source) VALUES ('tcgdex-en-sealed-test', 'Pikachu', 'pokemon', 10, 'USD', 'tcgdex')`
  );
  await db.run(
    `INSERT INTO collection (user_id, card_id, quantity, purchase_price, game, list_type) VALUES (?, 'tcgdex-en-sealed-test', 1, 4, 'pokemon', 'collection')`,
    [admin.id]
  );
  const before = await db.get(`SELECT COUNT(*) AS n FROM collection`);
  await db.initDb();
  const after = await db.get(`SELECT COUNT(*) AS n FROM collection`);
  assert.strictEqual(after.n, before.n);
  const tables = await db.all(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('sealed_product', 'sealed_lot') ORDER BY name`
  );
  assert.deepStrictEqual(tables.map(row => row.name), ['sealed_lot', 'sealed_product']);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: Number(req.headers['x-test-user']) };
    next();
  });
  app.use('/api', sealedRoutes);
  app.use('/api', statsRoutes);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const created = await send(port, 'POST', '/api/sealed/products', admin.id, {
    name: 'Prismatic Evolutions ETB',
    product_type: 'etb',
    language: 'English',
    set_name: 'Prismatic Evolutions',
    market_price: '38.01',
    market_currency: 'USD',
    lot: { quantity: 1, total_cost: '45.00', currency: 'USD', purchased_at: '2026-11-01', notes: 'first' },
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.product.market_price, '38.01');
  assert.strictEqual(created.body.product.lots.length, 1);
  assert.strictEqual(created.body.product.lots[0].total_cost_cents, 4500);
  assert.strictEqual(created.body.product.lots[0].remaining_cost_cents, 4500);
  const productId = created.body.product.id;

  const second = await send(port, 'POST', `/api/sealed/products/${productId}/lots`, admin.id, {
    quantity: 1, total_cost: '60.00', currency: 'USD', purchased_at: '2026-11-02',
  });
  assert.strictEqual(second.status, 201);
  assert.strictEqual(second.body.product.lots.length, 2);
  assert.deepStrictEqual(second.body.product.lots.map(lot => lot.total_cost_cents).sort(), [4500, 6000]);

  const box = await send(port, 'POST', '/api/sealed/products', admin.id, {
    name: 'Booster box',
    product_type: 'booster_box',
    market_price: '',
    lot: { quantity: 2, total_cost: '90.00', currency: 'USD' },
  });
  assert.strictEqual(box.status, 201);
  assert.strictEqual(box.body.product.market_price, null);
  const opened = await send(port, 'PUT', `/api/sealed/lots/${box.body.product.lots[0].id}`, admin.id, {
    remaining_quantity: 1,
  });
  assert.strictEqual(opened.status, 200);
  const openedLot = opened.body.product.lots.find(lot => lot.id === box.body.product.lots[0].id);
  assert.strictEqual(openedLot.remaining_quantity, 1);
  assert.strictEqual(openedLot.remaining_cost_cents, 4500);
  assert.strictEqual(openedLot.total_cost_cents, 9000);

  const hidden = await send(port, 'GET', '/api/sealed/products', member.lastID);
  assert.strictEqual(hidden.status, 200);
  assert.strictEqual(hidden.body.products.length, 0);
  const stolen = await send(port, 'PUT', `/api/sealed/products/${productId}`, member.lastID, { name: 'Nope' });
  assert.strictEqual(stolen.status, 404);

  const location = await db.run(`INSERT INTO locations (name, type, user_id) VALUES ('Closet', 'Box', ?)`, [admin.id]);
  const wrongPlace = await send(port, 'POST', `/api/sealed/products/${productId}/lots`, member.lastID, {
    quantity: 1, total_cost: '1.00', currency: 'USD', location_id: location.lastID,
  });
  assert.strictEqual(wrongPlace.status, 404);
  const memberLocation = await db.run(`INSERT INTO locations (name, type, user_id) VALUES ('Member closet', 'Box', ?)`, [member.lastID]);
  const crossLocation = await send(port, 'POST', `/api/sealed/products/${productId}/lots`, admin.id, {
    quantity: 1, total_cost: '1.00', currency: 'USD', location_id: memberLocation.lastID,
  });
  assert.strictEqual(crossLocation.status, 400);

  const badImage = await send(port, 'POST', '/api/sealed/products', admin.id, {
    name: 'Bad', product_type: 'tin', image_url: 'javascript:alert(1)',
    lot: { quantity: 1, total_cost: '1', currency: 'USD' },
  });
  assert.strictEqual(badImage.status, 400);

  const worth = await send(port, 'GET', '/api/stats/networth', admin.id);
  assert.strictEqual(worth.status, 200);
  // Card market 10 plus two ETB quotes of 38.01. The unpriced box adds nothing.
  // Card cost 4 plus ETB lots 45 and 60 plus half of the 90 box (45 still sealed).
  assert.strictEqual(worth.body.totalValue, 86.02);
  assert.strictEqual(worth.body.totalSpent, 154);
  assert.strictEqual(worth.body.sealed.unpricedUnits, 1);
  assert.strictEqual(worth.body.sealed.remainingUnits, 3);
  assert.strictEqual(worth.body.totalCards, 1);

  const stats = await send(port, 'GET', '/api/stats?game=mtg', admin.id);
  assert.strictEqual(stats.status, 200);
  assert.strictEqual(stats.body.summary.sealed.remainingUnits, 0);

  const archived = await send(port, 'POST', `/api/sealed/products/${productId}/archive`, admin.id);
  assert.strictEqual(archived.status, 200);
  const afterArchive = await send(port, 'GET', '/api/stats/networth', admin.id);
  // ETB quotes leave the portfolio. The unpriced box remains, still unpriced.
  assert.strictEqual(afterArchive.body.sealed.remainingUnits, 1);
  assert.strictEqual(afterArchive.body.totalValue, 10);

  const csv = [
    'name,product_type,language,set_name,quantity,total_cost,currency,market_price,market_currency',
    'Prismatic Evolutions ETB,etb,English,Prismatic Evolutions,1,52.00,USD,40.00,USD',
    'Prismatic Evolutions ETB,etb,English,Prismatic Evolutions,1,48.00,USD,,',
  ].join('\n');
  const imported = await send(port, 'POST', '/api/sealed/import', member.lastID, { csv });
  assert.strictEqual(imported.status, 201, JSON.stringify(imported.body));
  assert.strictEqual(imported.body.products, 1);
  assert.strictEqual(imported.body.lots, 2);
  const memberList = await send(port, 'GET', '/api/sealed/products', member.lastID);
  assert.strictEqual(memberList.body.products.length, 1);
  assert.strictEqual(memberList.body.products[0].lots.length, 2);
  assert.strictEqual(memberList.body.products[0].market_price, '40.00');
  const adminStill = await send(port, 'GET', '/api/sealed/products?archived=1', admin.id);
  assert.ok(!JSON.stringify(adminStill.body).includes('"total_cost":"52.00"'));

  const exported = await send(port, 'GET', '/api/sealed/export', member.lastID);
  assert.strictEqual(exported.status, 200);
  assert.ok(exported.text.includes('52.00'));
  assert.ok(!exported.text.includes('45.00'));

  await new Promise(resolve => server.close(resolve));
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* already gone */ }
  }
  console.log('sealedInventory.test.js: all assertions passed');
}

main().catch((err) => {
  console.error(err);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* already gone */ }
  }
  process.exit(1);
});
