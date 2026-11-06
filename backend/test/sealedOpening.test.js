'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');

const dbPath = path.join(os.tmpdir(), `bindarr-opening-${process.pid}.db`);
process.env.DB_PATH = dbPath;
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';

const db = require('../src/db');
const sealedRoutes = require('../src/routes/sealed');
const openingRoutes = require('../src/routes/sealedOpenings');
const { pickCatalogSet } = require('../src/utils/sealedOpening');

assert.deepStrictEqual(pickCatalogSet({
  code: '30C',
  name: '30th Celebration',
  cached: [{ set_id: '30th', set_name: '30th Celebration' }],
  sets: [{ id: 'cel25', name: 'Celebrations' }],
}), { set_id: '30th', set_name: '30th Celebration' });
assert.deepStrictEqual(pickCatalogSet({
  code: '30C',
  name: '30th Celebration',
  cached: [],
  sets: [{ id: '30th', name: '30th Celebration' }],
}), { set_id: '30th', set_name: '30th Celebration' });
assert.strictEqual(pickCatalogSet({
  code: '30C',
  name: '30th Celebration',
  cached: [
    { set_id: '30th', set_name: '30th Celebration' },
    { set_id: 'cel25', set_name: '30th Celebration' },
  ],
  sets: [],
}).set_id, '');

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
        try { parsed = JSON.parse(text); } catch { /* empty */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  await db.initDb();
  const admin = await db.get(`SELECT id FROM users WHERE username = 'admin'`);
  const member = await db.run(
    `INSERT INTO users (username, password_hash, role, share_token, api_key) VALUES ('opener', 'x', 'member', 'opener-share', 'opener-key')`
  );
  await db.run(
    `INSERT INTO card_cache (id, name, set_id, set_name, number, image_url, game, language, supertype, price_trend, price_currency, price_source)
     VALUES ('tcgdex-en-open-hit', 'Mewtwo ex', '30th', '30th Celebration', '151', 'https://example.com/mewtwo.jpg', 'pokemon', 'English', 'Pokémon', 12.5, 'USD', 'tcgdex')`
  );
  await db.run(
    `INSERT INTO card_cache (id, name, game, language, supertype, price_trend, price_currency, price_source)
     VALUES ('tcgdex-jp-open', 'Mewtwo', 'pokemon', 'English', 'Pokémon', 9, 'EUR', 'tcgdex')`
  );
  const copy = await db.run(
    `INSERT INTO collection (user_id, card_id, quantity, purchase_price, game, list_type)
     VALUES (?, 'tcgdex-en-open-hit', 1, 4, 'pokemon', 'collection')`,
    [admin.id]
  );

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: Number(req.headers['x-test-user']) };
    next();
  });
  app.use('/api', sealedRoutes);
  app.use('/api', openingRoutes);
  app.use('/api', require('../src/routes/stats'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const created = await send(port, 'POST', '/api/sealed/products', admin.id, {
    name: '30th Celebration ETB',
    product_type: 'etb',
    set_name: '30th Celebration',
    lot: { quantity: 2, total_cost: '110.00', currency: 'USD' },
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  const productId = created.body.product.id;
  const lotId = created.body.product.lots[0].id;

  await db.run(`UPDATE app_settings SET pokemon_provider = 'pokemontcg' WHERE id = 1`);
  const resolved = await send(port, 'GET', '/api/sealed/card-set?code=30C&name=30th%20Celebration', admin.id);
  assert.strictEqual(resolved.status, 200, JSON.stringify(resolved.body));
  assert.strictEqual(resolved.body.set_id, '30th');

  const opened = await send(port, 'POST', `/api/sealed/lots/${lotId}/openings`, admin.id, {
    opened_at: '2026-11-06',
    notes: 'box 1',
    pulls: [
      { name: 'Hits', quantity: 2, current_value: '15.00', value_at_opening: '14.00' },
      { name: 'Code card', quantity: 1 },
      { name: 'Commons', quantity: 3, current_value: '0' },
    ],
  });
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.body));
  const opening = opened.body.opening;
  assert.strictEqual(opening.cost, '55.00');
  assert.strictEqual(opening.currency, 'USD');
  assert.strictEqual(opening.quantity, 1);
  assert.strictEqual(opening.entry_complete, false);
  assert.strictEqual(opening.analytics.recorded_quantity, 6);
  assert.strictEqual(opening.analytics.known_value, '30.00');
  assert.strictEqual(opening.analytics.unpriced_quantity, 1);
  assert.strictEqual(opening.analytics.valuation_complete, false);
  assert.strictEqual(opening.analytics.entry_complete, false);
  assert.strictEqual(opening.analytics.value_difference, '-25.00');
  assert.strictEqual(opening.analytics.value_difference_kind, 'estimated_unrealized');
  assert.ok(Math.abs(opening.analytics.cost_recovery_percent - 54.54545454545454) < 1e-10);
  const performance = await send(port, 'GET', '/api/stats', admin.id);
  assert.strictEqual(performance.status, 200, JSON.stringify(performance.body && performance.body.error));
  // The $4 card plus the $110 lot. Opening one $55 unit does not reduce it.
  assert.strictEqual(performance.body.summary.totalSpent, 114);
  assert.strictEqual(performance.body.summary.sealed.cost, 55);
  const hobby = performance.body.openingPerformance.reports.find(item => item.currency === 'USD');
  assert.strictEqual(hobby.overall.cost, 55);
  assert.strictEqual(hobby.overall.knownValue, 30);
  assert.strictEqual(hobby.overall.difference, -25);
  assert.strictEqual(hobby.overall.openedValue, 28);
  assert.strictEqual(hobby.overall.sinceOpen, 2);
  assert.strictEqual(hobby.sets[0].name, '30th Celebration');
  assert.strictEqual(hobby.productTypes[0].name, 'etb');

  assert.strictEqual(opening.analytics.opened_value, '28.00');
  assert.strictEqual(opening.analytics.missing_snapshot_quantity, 1);
  assert.strictEqual(opening.pulls.find(pull => pull.name === 'Commons').value_at_opening, '0.00');
  assert.ok(!JSON.stringify(opening.pulls).includes('cost_cents'));

  const stock = await send(port, 'GET', `/api/sealed/products/${productId}`, admin.id);
  assert.strictEqual(stock.body.product.lots[0].remaining_quantity, 1);
  assert.strictEqual(stock.body.product.lots[0].remaining_cost, '55.00');

  const owned = await db.get(`SELECT purchase_price FROM collection WHERE id = ?`, [copy.lastID]);
  assert.strictEqual(owned.purchase_price, 4);

  const linked = await send(port, 'POST', `/api/sealed/openings/${opening.id}/pulls`, admin.id, {
    collection_id: copy.lastID,
    quantity: 1,
  });
  assert.strictEqual(linked.status, 201, JSON.stringify(linked.body));
  const hit = linked.body.opening.pulls.find(pull => pull.card_id === 'tcgdex-en-open-hit');
  assert.strictEqual(hit.name, 'Mewtwo ex');
  assert.strictEqual(hit.current_value, '12.50');
  assert.strictEqual(hit.value_at_opening, '12.50');
  assert.strictEqual(hit.collection_id, copy.lastID);
  const still = await db.get(`SELECT purchase_price, quantity FROM collection WHERE id = ?`, [copy.lastID]);
  assert.strictEqual(still.purchase_price, 4);
  assert.strictEqual(still.quantity, 1);

  const foreignPrice = await send(port, 'POST', `/api/sealed/openings/${opening.id}/pulls`, admin.id, {
    card_id: 'tcgdex-jp-open',
    quantity: 1,
  });
  assert.strictEqual(foreignPrice.status, 201, JSON.stringify(foreignPrice.body));
  const skipped = foreignPrice.body.opening.pulls.find(pull => pull.card_id === 'tcgdex-jp-open');
  assert.strictEqual(skipped.current_value, null);
  assert.strictEqual(skipped.line_value, null);
  assert.ok(skipped.collection_id);
  const filedForeign = await db.get(
    `SELECT purchase_price FROM collection WHERE id = ? AND user_id = ?`,
    [skipped.collection_id, admin.id]
  );
  assert.strictEqual(filedForeign.purchase_price, 0);

  const filed = await send(port, 'POST', `/api/sealed/openings/${opening.id}/pulls`, admin.id, {
    card_id: 'tcgdex-en-open-hit',
    quantity: 1,
  });
  assert.strictEqual(filed.status, 201, JSON.stringify(filed.body));
  const fresh = filed.body.opening.pulls.find(pull => pull.card_id === 'tcgdex-en-open-hit' && pull.collection_id !== copy.lastID);
  assert.strictEqual(fresh.current_value, '12.50');
  assert.strictEqual(fresh.value_at_opening, '12.50');
  const copies = await db.get(
    `SELECT COUNT(*) AS n FROM collection WHERE user_id = ? AND card_id = ?`,
    [admin.id, 'tcgdex-en-open-hit']
  );
  assert.strictEqual(copies.n, 2);

  const mixed = await send(port, 'POST', `/api/sealed/openings/${opening.id}/pulls`, admin.id, {
    name: 'Euro hit',
    quantity: 1,
    current_value: '5.00',
    currency: 'EUR',
  });
  assert.strictEqual(mixed.status, 400);

  const bulk = await send(port, 'POST', `/api/sealed/openings/${opening.id}/pulls`, admin.id, {
    name: 'Other cards',
    quantity: 10,
    line_value: '8.00',
  });
  assert.strictEqual(bulk.status, 201, JSON.stringify(bulk.body));
  assert.strictEqual(bulk.body.opening.analytics.known_value, '63.00');
  assert.strictEqual(bulk.body.opening.analytics.recorded_quantity, 19);

  const both = await send(port, 'POST', `/api/sealed/openings/${opening.id}/pulls`, admin.id, {
    name: 'Both',
    quantity: 1,
    current_value: '1.00',
    line_value: '1.00',
  });
  assert.strictEqual(both.status, 400);

  const marked = await send(port, 'PUT', `/api/sealed/openings/${opening.id}`, admin.id, { entry_complete: true });
  assert.strictEqual(marked.status, 200);
  assert.strictEqual(marked.body.opening.entry_complete, true);
  assert.strictEqual(marked.body.opening.analytics.entry_complete, true);
  assert.strictEqual(marked.body.opening.analytics.valuation_complete, false);
  assert.strictEqual(marked.body.opening.cost, '55.00');

  const locked = await send(port, 'PUT', `/api/sealed/lots/${lotId}`, admin.id, { total_cost: '100.00' });
  assert.strictEqual(locked.status, 400);
  const same = await send(port, 'PUT', `/api/sealed/lots/${lotId}`, admin.id, {
    remaining_quantity: 1,
    total_cost: '110.00',
  });
  assert.strictEqual(same.status, 200, JSON.stringify(same.body));

  const second = await send(port, 'POST', `/api/sealed/lots/${lotId}/openings`, admin.id, { notes: 'box 2' });
  assert.strictEqual(second.status, 201, JSON.stringify(second.body));
  assert.notStrictEqual(second.body.opening.id, opening.id);
  assert.strictEqual(second.body.opening.cost, '55.00');
  assert.strictEqual(second.body.opening.analytics.recorded_quantity, 0);
  assert.strictEqual(second.body.opening.analytics.entry_complete, false);
  assert.strictEqual(second.body.opening.analytics.known_value, '0.00');
  assert.strictEqual(second.body.opening.analytics.value_difference, '-55.00');

  const list = await send(port, 'GET', `/api/sealed/products/${productId}/openings`, admin.id);
  assert.strictEqual(list.body.openings.length, 2);
  const hidden = await send(port, 'GET', `/api/sealed/products/${productId}/openings`, member.lastID);
  assert.strictEqual(hidden.status, 404);
  const stolen = await send(port, 'DELETE', `/api/sealed/openings/${second.body.opening.id}`, member.lastID);
  assert.strictEqual(stolen.status, 404);

  const removed = await send(port, 'DELETE', `/api/sealed/openings/${second.body.opening.id}`, admin.id);
  assert.strictEqual(removed.status, 200);
  const restored = await send(port, 'GET', `/api/sealed/products/${productId}`, admin.id);
  assert.strictEqual(restored.body.product.lots[0].remaining_quantity, 1);
  assert.strictEqual(restored.body.product.lots[0].remaining_cost, '55.00');

  const empty = await send(port, 'POST', `/api/sealed/lots/${lotId}/openings`, admin.id, { quantity: 2 });
  assert.strictEqual(empty.status, 400);
  await send(port, 'POST', `/api/sealed/lots/${lotId}/openings`, admin.id, {});
  const over = await send(port, 'POST', `/api/sealed/lots/${lotId}/openings`, admin.id, {});
  assert.strictEqual(over.status, 400);

  const tracked = await db.get(`SELECT filed_ids FROM sealed_pull WHERE id = ?`, [fresh.id]);
  assert.strictEqual(tracked.filed_ids, String(fresh.collection_id));
  await db.run(`UPDATE sealed_pull SET filed_ids = '' WHERE id = ?`, [fresh.id]);
  await db.initDb();
  const remembered = await db.get(`SELECT filed_ids FROM sealed_pull WHERE id = ?`, [fresh.id]);
  assert.strictEqual(remembered.filed_ids, String(fresh.collection_id));
  const linkedRow = await db.get(`SELECT filed_ids FROM sealed_pull WHERE collection_id = ?`, [copy.lastID]);
  assert.strictEqual(linkedRow.filed_ids, '');
  const dropped = await send(port, 'DELETE', `/api/sealed/openings/${opening.id}/pulls/${fresh.id}`, admin.id);
  assert.strictEqual(dropped.status, 200, JSON.stringify(dropped.body));
  const afterPull = await db.get(
    `SELECT COUNT(*) AS n FROM collection WHERE user_id = ? AND card_id = ?`,
    [admin.id, 'tcgdex-en-open-hit']
  );
  assert.strictEqual(afterPull.n, 1);

  const pair = await send(port, 'POST', `/api/sealed/openings/${opening.id}/pulls`, admin.id, {
    card_id: 'tcgdex-en-open-hit',
    quantity: 2,
  });
  assert.strictEqual(pair.status, 201, JSON.stringify(pair.body));
  const pairPull = pair.body.opening.pulls.find(pull => pull.quantity === 2 && pull.card_id === 'tcgdex-en-open-hit');
  const pairRow = await db.get(`SELECT filed_ids FROM sealed_pull WHERE id = ?`, [pairPull.id]);
  assert.strictEqual(pairRow.filed_ids.split(',').length, 2);
  const paired = await db.get(
    `SELECT COUNT(*) AS n FROM collection WHERE user_id = ? AND card_id = ?`,
    [admin.id, 'tcgdex-en-open-hit']
  );
  assert.strictEqual(paired.n, 3);

  const undone = await send(port, 'DELETE', `/api/sealed/openings/${opening.id}`, admin.id);
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.body));
  const kept = await db.get(`SELECT purchase_price FROM collection WHERE id = ?`, [copy.lastID]);
  assert.strictEqual(kept.purchase_price, 4);
  const left = await db.get(
    `SELECT COUNT(*) AS n FROM collection WHERE user_id = ? AND card_id = ?`,
    [admin.id, 'tcgdex-en-open-hit']
  );
  assert.strictEqual(left.n, 1);
  const foreignGone = await db.get(`SELECT id FROM collection WHERE id = ?`, [skipped.collection_id]);
  assert.strictEqual(foreignGone, undefined);
  const sealedAgain = await send(port, 'GET', `/api/sealed/products/${productId}`, admin.id);
  assert.strictEqual(sealedAgain.body.product.lots[0].remaining_quantity, 1);

  await new Promise(resolve => server.close(resolve));
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* already gone */ }
  }
  console.log('sealedOpening.test.js: all assertions passed');
}

main().catch((err) => {
  console.error(err);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* already gone */ }
  }
  process.exit(1);
});
