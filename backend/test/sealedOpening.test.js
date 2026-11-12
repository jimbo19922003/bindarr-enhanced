'use strict';
const assert = require('assert');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
process.env.DB_PATH = path.join(os.tmpdir(), `bindarr-rip-fx-${process.pid}.db`);
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
const db = require('../src/db');
require('../src/utils/cardApi').hydrate = async () => {};
require('../src/pokemonPrices').getPokemonPrices = () => ({ refreshCard: async () => {} });
let available = true;
require('../src/utils/currencyConversion').convertCents = async (amount, from, to) => ({
  convertedCents: !available && from !== to ? null : Math.round(amount * (from === to ? 1 : 1.25)), stale: false,
});
const { pickCatalogSet } = require('../src/utils/sealedOpening');

async function main() {
  assert.strictEqual(pickCatalogSet({ code: '30C', name: '30th Celebration', cached: [{ set_id: '30th', set_name: '30th Celebration' }], sets: [] }).set_id, '30th');
  await db.initDb();
  const admin = await db.get("SELECT id FROM users WHERE username = 'admin'");
  const other = await db.run("INSERT INTO users (username, password_hash, role, share_token) VALUES ('other-rip-user', 'x', 'member', ?)", [require('crypto').randomBytes(32).toString('hex')]);
  await db.run(`INSERT INTO card_cache (id, name, game, language, set_id, set_name, number, price_trend, price_normal, price_currency) VALUES
    ('tcgdex-en-rip-usd', 'Dollar card', 'pokemon', 'English', '30th', '30th Celebration', '1', 10, 10, 'USD'),
    ('tcgdex-en-rip-eur', 'Euro card', 'pokemon', 'English', '30th-classic', '30th Classic', '2', 54.85, 54.85, 'EUR')`);
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-test-user'] || admin.id) }; next(); });
  app.use('/api', require('../src/routes/sealed'));
  app.use('/api', require('../src/routes/sealedOpenings'));
  app.use('/api', require('../src/routes/collection'));
  app.use('/api', require('../src/routes/stats'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = async (method, url, body, userId = admin.id, headers = {}) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(userId), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const identity = await send('GET', '/api/scan-queue/identity');
    assert.strictEqual(identity.status, 200);
    const spoofedFields = [{ openingPull: true }, { opening_pull: true }, { acquisition_source: 'opening' }, { context: { openingPull: true } }];
    for (const [index, fields] of spoofedFields.entries()) {
      for (const [url, cardFields, headers] of [
        ['/api/collection', { card_id: 'tcgdex-en-rip-usd' }, {}],
        ['/api/scan-queue/add', { card_id: 'tcgdex-en-rip-usd' }, { 'Idempotency-Key': `zero-cost-test-${index}`, 'X-Scan-Instance': identity.body.instance_id }],
        ['/api/collection/bulk-add', { card_ids: ['tcgdex-en-rip-usd'] }, {}],
      ]) {
        const rejected = await send('POST', url, { ...cardFields, purchase_price: 0, ...fields }, admin.id, headers);
        assert.strictEqual(rejected.status, 409, JSON.stringify(rejected.body));
        assert.strictEqual(rejected.body.code, 'ZERO_COST_CONFIRMATION_REQUIRED');
      }
    }
    assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ?', [admin.id])).n, 0);
    const created = await send('POST', '/api/sealed/products', { name: 'Mixed-set box', product_type: 'etb', set_name: '30th Celebration', lot: { quantity: 2, total_cost: '100.00', currency: 'USD' } });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const productId = created.body.product.id, lotId = created.body.product.lots[0].id;
    const opened = await send('POST', `/api/sealed/lots/${lotId}/openings`, { pulls: [
      { card_id: 'tcgdex-en-rip-usd', quantity: 1 }, { card_id: 'tcgdex-en-rip-eur', quantity: 1 },
    ] });
    assert.strictEqual(opened.status, 201, JSON.stringify(opened.body));
    const opening = opened.body.opening;
    const openingCopies = await db.all('SELECT id, purchase_price, zero_cost_confirmed FROM collection WHERE user_id = ? ORDER BY id', [admin.id]);
    assert.strictEqual(openingCopies.length, 2);
    for (const copy of openingCopies) {
      assert.strictEqual(copy.purchase_price, null);
      assert.strictEqual(copy.zero_cost_confirmed, 0);
      assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM card_acquisition_lot WHERE collection_id = ?', [copy.id])).n, 0);
    }
    const euro = opening.pulls.find(pull => pull.card_id === 'tcgdex-en-rip-eur');
    assert.strictEqual(euro.current_value, '68.56'); assert.strictEqual(euro.value_at_opening, '68.56');
    assert.strictEqual(euro.set_name, '30th Classic');
    assert.strictEqual(opening.analytics.known_value, '78.56');
    assert.strictEqual(opening.analytics.unpriced_quantity, 0);
    const stored = await db.get('SELECT current_unit_cents, opened_unit_cents FROM sealed_pull WHERE id = ?', [euro.id]);
    assert.strictEqual(stored.current_unit_cents, 6856); assert.strictEqual(stored.opened_unit_cents, 6856);
    await db.run(require('../../shared/investmentLedgerSchema.json').dailySchema);
    const timeZone = await require('../src/utils/portfolioTimeZone').readTimeZone(db);
    await db.run(`INSERT INTO portfolio_daily_performance
      (user_id,game,currency,time_zone,day,recorded_at,value_cents,cards_cents,sealed_cents,invested_cents,gain_cents,return_pct,ledger_id,stale_rates,unpriced_cards,unpriced_sealed)
      VALUES (?, '', 'USD', ?, '2000-01-01', 946684800000, 6000, 6000, 0, 0, 6000, NULL, 0, 0, 0, 0)`, [admin.id, timeZone]);
    const stats = await send('GET', '/api/stats');
    assert.strictEqual(stats.body.summary.totalValue, 78.56);
    assert.deepStrictEqual(stats.body.summary.dayChange, { amount: 18.56, since: '2000-01-01', timeZone, incomplete: false });
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
    await db.run(`UPDATE card_cache SET available_printings = '["Holofoil","Reverse Holofoil"]', price_holofoil = 8, price_reverse_holofoil = NULL WHERE id = 'tcgdex-en-rip-eur'`);
    const invalidPrinting = await send('POST', `/api/sealed/lots/${lotId}/openings`, { pulls: [{ card_id: 'tcgdex-en-rip-eur', quantity: 1, printing: 'Normal' }] });
    assert.strictEqual(invalidPrinting.status, 400);
    const finishes = await send('POST', `/api/sealed/lots/${lotId}/openings`, { pulls: [
      { card_id: 'tcgdex-en-rip-eur', quantity: 2, printing: 'Holofoil' },
      { card_id: 'tcgdex-en-rip-eur', quantity: 1, printing: 'Reverse Holofoil' },
    ] });
    assert.strictEqual(finishes.status, 201, JSON.stringify(finishes.body));
    const finishPulls = finishes.body.opening.pulls;
    assert.strictEqual(finishPulls[0].current_value, '10.00');
    // No Reverse Holofoil quote: valued from the card's market price as an estimate.
    assert.strictEqual(finishPulls[1].current_value, '68.56');
    assert.strictEqual(finishPulls[1].value_at_opening, '68.56');
    const copies = await db.all('SELECT printing FROM collection WHERE user_id = ? ORDER BY id', [admin.id]);
    assert.deepStrictEqual(copies.map(row => row.printing), ['Holofoil', 'Holofoil', 'Reverse Holofoil']);
    await send('GET', `/api/sealed/products/${productId}/openings`);
    assert.strictEqual((await db.get('SELECT current_unit_cents FROM sealed_pull WHERE id = ?', [finishPulls[1].id])).current_unit_cents, 6856);
    const override = await send('POST', `/api/sealed/lots/${lotId}/openings`, { pulls: [
      { card_id: 'tcgdex-en-rip-eur', quantity: 1, printing: 'Reverse Holofoil', current_value: '3.00' },
    ] });
    assert.strictEqual(override.status, 201, JSON.stringify(override.body));
    assert.strictEqual(override.body.opening.pulls[0].current_value, '3.00');
    assert.strictEqual(override.body.opening.pulls[0].value_at_opening, '3.00');
    assert.strictEqual((await send('DELETE', `/api/sealed/openings/${override.body.opening.id}`)).status, 200);
    const gift = await send('POST', '/api/collection', { card_id: 'tcgdex-en-rip-usd', purchase_price: 0, zero_cost_confirmed: true });
    assert.strictEqual(gift.status, 200, JSON.stringify(gift.body));
    const giftCopy = await db.get('SELECT purchase_price, zero_cost_confirmed FROM collection WHERE id = ?', [gift.body.id]);
    assert.strictEqual(giftCopy.purchase_price, 0);
    assert.strictEqual(giftCopy.zero_cost_confirmed, 1);
    assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM card_acquisition_lot WHERE collection_id = ?', [gift.body.id])).n, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('sealedOpening.test.js: all assertions passed');
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
