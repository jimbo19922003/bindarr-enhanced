'use strict';
const assert = require('assert');
const os = require('os');
const path = require('path');
const http = require('http');
process.env.DB_PATH = path.join(os.tmpdir(), `bindarr-reporting-${process.pid}.db`);
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
const db = require('../src/db');
const fx = require('../src/utils/currencyConversion');
let ratesAvailable = true;
fx.convertCents = async (amount, from, to) => ({
  convertedCents: !ratesAvailable && from !== to ? null : Math.round(amount * (from === to ? 1 : 1.25)), stale: false,
});
const { createReportingValuation } = require('../src/utils/reportingValuation');

async function main() {
  const valuation = createReportingValuation('USD');
  const card = await valuation.card({ price_currency: 'EUR', price_trend: 54.85, printing: 'Normal', price_normal: 54.85 });
  assert.strictEqual(card.price_trend, 68.56);
  assert.strictEqual(card.price_currency, 'USD');
  assert.strictEqual(card.source_quote.price, 54.85);
  const reverse = await valuation.card({ price_currency: 'EUR', printing: 'Reverse Holofoil', price_trend: 54.85, price_reverse_holofoil: 10 });
  assert.strictEqual(reverse.price_trend, 12.5);
  await db.initDb();
  const admin = await db.get("SELECT id FROM users WHERE username = 'admin'");
  await db.run(`INSERT INTO card_cache (id, name, game, set_id, set_name, price_trend, price_normal, price_reverse_holofoil, price_currency)
    VALUES ('fx-eur', 'Euro card', 'pokemon', 'test', 'Test', 54.85, 54.85, 10, 'EUR'),
    ('fx-usd', 'Dollar card', 'pokemon', 'test-alt', ' TEST ', 10, 10, NULL, 'USD')`);
  for (const id of ['fx-eur', 'fx-usd']) await db.run(`INSERT INTO collection (user_id, card_id, quantity, purchase_price, printing, game, list_type)
    VALUES (?, ?, 1, 0, 'Normal', 'pokemon', 'collection')`, [admin.id, id]);
  const app = require('express')();
  app.use((req, _res, next) => { req.user = { id: admin.id }; next(); });
  app.use('/api', require('../src/routes/stats'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const dashboard = await (await fetch(`${base}/api/stats`)).json();
    const worth = await (await fetch(`${base}/api/stats/networth`)).json();
    assert.strictEqual(dashboard.summary.totalValue, 78.56);
    assert.strictEqual(worth.totalValue, 78.56);
    assert.strictEqual(dashboard.cardSets[0].value, 78.56);
    assert.strictEqual(dashboard.cardSets.length, 1);
    assert.strictEqual(dashboard.cardSets[0].name, 'Test');
    assert.strictEqual(dashboard.cardSets[0].count, 2);
    assert.strictEqual(dashboard.sets[0].value, 78.56);
    assert.strictEqual(dashboard.topValuable[0].price_trend, 68.56);
    assert.strictEqual(dashboard.topValuable[0].price_currency, 'USD');
    assert.strictEqual(dashboard.summary.extraCopiesCount, 0);
    assert.strictEqual(dashboard.summary.extraCopiesValue, 0);

    await db.run(`INSERT INTO card_cache (id, name, game, set_id, set_name, price_trend, price_currency)
      VALUES ('unpriced', 'Unpriced card', 'pokemon', 'test', 'Test', 0, 'USD'),
      ('mtg-extra', 'Other game', 'mtg', 'other', 'Other', 5, 'USD')`);
    await db.run(`INSERT INTO collection (user_id, card_id, quantity, purchase_price, printing, game, list_type)
      VALUES (?, 'fx-eur', 2, 0, 'Reverse Holofoil', 'pokemon', 'collection'),
      (?, 'fx-usd', 1, 0, 'Normal', 'pokemon', 'collection'),
      (?, 'unpriced', 2, 0, 'Normal', 'pokemon', 'collection'),
      (?, 'mtg-extra', 2, 0, 'Normal', 'mtg', 'collection')`,
    [admin.id, admin.id, admin.id, admin.id]);
    const duplicates = await (await fetch(`${base}/api/stats?game=pokemon`)).json();
    assert.strictEqual(duplicates.summary.totalCards, 7);
    assert.strictEqual(duplicates.summary.uniqueCards, 3);
    assert.strictEqual(duplicates.summary.duplicateCopies, 4);
    assert.strictEqual(duplicates.summary.extraCopiesCount, 4);
    // Keep the 68.56 normal copy, not either 12.50 reverse holofoil.
    assert.strictEqual(duplicates.summary.extraCopiesValue, 35);
    const allGames = await (await fetch(`${base}/api/stats`)).json();
    assert.strictEqual(allGames.summary.duplicateCopies, 5);
    assert.strictEqual(allGames.summary.extraCopiesCount, 5);
    assert.strictEqual(allGames.summary.extraCopiesValue, 40);
    const otherGame = await (await fetch(`${base}/api/stats?game=mtg`)).json();
    assert.strictEqual(otherGame.summary.extraCopiesCount, 1);
    assert.strictEqual(otherGame.summary.extraCopiesValue, 5);

    const original = await db.get("SELECT price_trend, price_currency FROM card_cache WHERE id = 'fx-eur'");
    assert.strictEqual(original.price_trend, 54.85);
    assert.strictEqual(original.price_currency, 'EUR');
    ratesAvailable = false;
    const unavailable = await fetch(`${base}/api/stats`);
    assert.strictEqual(unavailable.status, 503);
    assert.strictEqual((await unavailable.json()).code, 'VALUATION_FX_UNAVAILABLE');
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('reportingValuation.test.js: all assertions passed');
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
