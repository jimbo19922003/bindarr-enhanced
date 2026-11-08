'use strict';
const assert = require('assert');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
process.env.DB_PATH = path.join(os.tmpdir(), `bindarr-rip-fx-${process.pid}.db`);
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
const db = require('../src/db');
let available = true;
require('../src/utils/currencyConversion').convertCents = async (amount, from, to) => ({
  convertedCents: !available && from !== to ? null : Math.round(amount * (from === to ? 1 : 1.25)), stale: false,
});
const { pickCatalogSet } = require('../src/utils/sealedOpening');

async function main() {
  assert.strictEqual(pickCatalogSet({ code: '30C', name: '30th Celebration', cached: [{ set_id: '30th', set_name: '30th Celebration' }], sets: [] }).set_id, '30th');
  await db.initDb();
  const admin = await db.get("SELECT id FROM users WHERE username = 'admin'");
  const other = await db.run("INSERT INTO users (username, password_hash, role) VALUES ('other-rip-user', 'x', 'member')");
  await db.run(`INSERT INTO card_cache (id, name, game, language, set_id, set_name, number, price_trend, price_normal, price_currency) VALUES
    ('tcgdex-en-rip-usd', 'Dollar card', 'pokemon', 'English', '30th', '30th Celebration', '1', 10, 10, 'USD'),
    ('tcgdex-en-rip-eur', 'Euro card', 'pokemon', 'English', '30th-classic', '30th Classic', '2', 54.85, 54.85, 'EUR')`);
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-test-user'] || admin.id) }; next(); });
  app.use('/api', require('../src/routes/sealed'));
  app.use('/api', require('../src/routes/sealedOpenings'));
  app.use('/api', require('../src/routes/stats'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = async (method, url, body, userId = admin.id) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(userId) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const created = await send('POST', '/api/sealed/products', { name: 'Mixed-set box', product_type: 'etb', set_name: '30th Celebration', lot: { quantity: 2, total_cost: '100.00', currency: 'USD' } });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const productId = created.body.product.id, lotId = created.body.product.lots[0].id;
    const opened = await send('POST', `/api/sealed/lots/${lotId}/openings`, { pulls: [
      { card_id: 'tcgdex-en-rip-usd', quantity: 1 }, { card_id: 'tcgdex-en-rip-eur', quantity: 1 },
    ] });
    assert.strictEqual(opened.status, 201, JSON.stringify(opened.body));
    const opening = opened.body.opening;
    const euro = opening.pulls.find(pull => pull.card_id === 'tcgdex-en-rip-eur');
    assert.strictEqual(euro.current_value, '68.56'); assert.strictEqual(euro.value_at_opening, '68.56');
    assert.strictEqual(euro.set_name, '30th Classic');
    assert.strictEqual(opening.analytics.known_value, '78.56');
    assert.strictEqual(opening.analytics.unpriced_quantity, 0);
    const stored = await db.get('SELECT current_unit_cents, opened_unit_cents FROM sealed_pull WHERE id = ?', [euro.id]);
    assert.strictEqual(stored.current_unit_cents, 6856); assert.strictEqual(stored.opened_unit_cents, 6856);
    const stats = await send('GET', '/api/stats');
    assert.strictEqual(stats.body.summary.totalValue, 78.56);
    assert.strictEqual(stats.body.openingPerformance.reports.find(row => row.currency === 'USD').overall.knownValue, 78.56);
    await db.run('UPDATE sealed_pull SET current_unit_cents = NULL, opened_unit_cents = NULL WHERE id = ?', [euro.id]);
    const repaired = await send('GET', `/api/sealed/products/${productId}/openings`);
    assert.strictEqual(repaired.body.openings[0].analytics.known_value, '78.56');
    const legacy = await db.get('SELECT current_unit_cents, opened_unit_cents FROM sealed_pull WHERE id = ?', [euro.id]);
    assert.strictEqual(legacy.current_unit_cents, 6856); assert.strictEqual(legacy.opened_unit_cents, null);
    await db.run('UPDATE sealed_pull SET current_unit_cents = 1234, opened_unit_cents = 1100 WHERE id = ?', [euro.id]);
    await send('GET', `/api/sealed/openings/${opening.id}`);
    const manual = await db.get('SELECT current_unit_cents, opened_unit_cents FROM sealed_pull WHERE id = ?', [euro.id]);
    assert.strictEqual(manual.current_unit_cents, 1234); assert.strictEqual(manual.opened_unit_cents, 1100);
    assert.strictEqual((await send('GET', `/api/sealed/openings/${opening.id}`, null, other.lastID)).status, 404);
    assert.strictEqual((await send('DELETE', `/api/sealed/openings/${opening.id}`, null, other.lastID)).status, 404);
    const copiesBefore = (await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ?', [admin.id])).n;
    available = false;
    const failed = await send('POST', `/api/sealed/lots/${lotId}/openings`, { pulls: [{ card_id: 'tcgdex-en-rip-eur', quantity: 1 }] });
    assert.strictEqual(failed.status, 503);
    assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ?', [admin.id])).n, copiesBefore);
    const stock = await db.get('SELECT remaining_quantity FROM sealed_lot WHERE id = ?', [lotId]);
    assert.strictEqual(stock.remaining_quantity, 1);
    available = true;
    const invalid = await send('POST', `/api/sealed/openings/${opening.id}/pulls`, { name: 'Wrong currency', quantity: 1, current_value: '2.00', currency: 'EUR' });
    assert.strictEqual(invalid.status, 400);
    assert.strictEqual((await send('PUT', `/api/sealed/openings/${opening.id}`, { entry_complete: true })).body.opening.entry_complete, true);
    assert.strictEqual((await send('DELETE', `/api/sealed/openings/${opening.id}`)).status, 200);
    assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ?', [admin.id])).n, 0);
    assert.strictEqual((await db.get('SELECT remaining_quantity FROM sealed_lot WHERE id = ?', [lotId])).remaining_quantity, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('sealedOpening.test.js: all assertions passed');
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
