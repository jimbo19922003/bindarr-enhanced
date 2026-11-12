'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
process.env.DB_PATH = path.join(os.tmpdir(), `bindarr-conversion-${process.pid}.db`);
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
const db = require('../src/db');
require('../src/utils/cardApi').hydrate = async () => {};
require('../src/pokemonPrices').getPokemonPrices = () => ({ refreshCard: async () => {} });
const { openConnection } = require('../src/utils/salesRepository');
const connect = () => openConnection(db.dbPath);
const sales = require('../src/utils/salesApplication').createSalesApplication({ connect });
const basis = require('../src/utils/openingBasisRepository').createOpeningBasisRepository({ connect });
const spending = user => require('../src/utils/dashboardAccounting').readRecordedSpending(db, user, '', { cents: async cents => cents });

async function main() {
  await db.initDb();
  const user = (await db.get("SELECT id FROM users WHERE username = 'admin'")).id;
  const other = (await db.run("INSERT INTO users (username, password_hash, role, share_token) VALUES ('conversion-other', 'x', 'member', ?)", [require('crypto').randomBytes(32).toString('hex')])).lastID;
  await db.run(`INSERT INTO card_cache (id, name, game, language, price_trend, price_normal, price_currency)
    VALUES ('tcgdex-en-conversion', 'Promo or pull', 'pokemon', 'English', 20, 20, 'USD')`);
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-test-user'] || user) }; next(); });
  app.use('/api', require('../src/routes/sealed'));
  app.use('/api', require('../src/routes/sealedOpenings'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = async (method, url, body, owner = user) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(owner) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const create = async (name, cost) => {
    const result = await send('POST', '/api/sealed/products', { name, product_type: 'collection_box', lot: { quantity: 1, total_cost: cost, currency: 'USD', purchased_at: '2026-11-01' } });
    assert.strictEqual(result.status, 201, JSON.stringify(result.body));
    return result.body.product;
  };
  const listed = async product => {
    const result = await send('GET', `/api/sealed/products/${product.id}/openings`);
    assert.strictEqual(result.status, 200);
    return result.body;
  };
  const card = value => ({ card_id: 'tcgdex-en-conversion', quantity: 1, ...(value === undefined ? {} : { current_value: value }) });
  const sale = (kind, id) => ({ kind, id, quantity: 1, proceedsCents: 500, feesCents: 0, currency: 'USD', soldOn: '2026-11-12' });
  try {
    const product = await create('Mixed pack UPC', '60.01'), lot = product.lots[0];
    const payload = { request_id: 'convert-priced-0001', entry_complete: true, pulls: [card()], packs: [
      { name: 'Set A pack', set_name: 'Set A', quantity: 2, market_value: '10' },
      { name: 'Set B pack', set_name: 'Set B', quantity: 1, market_value: '20' },
    ] };
    const opened = await send('POST', `/api/sealed/lots/${lot.id}/openings`, payload);
    assert.strictEqual(opened.status, 201, JSON.stringify(opened.body));
    assert.strictEqual(opened.body.opening.cost_pending, false);
    assert.strictEqual(opened.body.opening.cost_cents, 2000);
    const parentId = opened.body.opening.id;
    let data = await listed(product), converted = data.conversions[0];
    assert.strictEqual(converted.allocation_status, 'finalized');
    assert.strictEqual(converted.packs.length, 3);
    const inventory = await send('GET', '/api/sealed/products');
    const packProduct = inventory.body.products.find(item => item.id === converted.packs[0].product_id);
    assert.strictEqual(packProduct.lots.length, 2);
    assert.strictEqual(packProduct.lots[0].source_product_name, 'Mixed pack UPC');
    assert.strictEqual(packProduct.lots[0].source_product_type, 'collection_box');
    assert.strictEqual(packProduct.lots[0].parent_opening_id, parentId);
    const otherInventory = await send('GET', '/api/sealed/products', undefined, other);
    assert.ok(!otherInventory.body.products.some(item => item.id === packProduct.id), 'Sources stay user scoped');
    assert.deepStrictEqual(converted.packs.map(pack => pack.total_cost_cents), [1000, 1000, 2001]);
    assert.strictEqual(converted.packs.reduce((sum, pack) => sum + pack.total_cost_cents, opened.body.opening.cost_cents), 6001);
    assert.strictEqual((await spending(user)).knownCents, 6001, 'Converted pack lots are not additional spending');
    const portfolio = await require('../src/utils/currentPortfolio').currentPortfolio(user, '', require('../src/utils/reportingValuation').createReportingValuation('USD'));
    assert.strictEqual(portfolio.totalSpent, 60.01, 'Legacy portfolio spending also excludes derived pack lots');
    const storedLot = await db.get('SELECT * FROM sealed_lot WHERE id = ?', [lot.id]);
    assert.strictEqual(storedLot.remaining_quantity, 0);
    assert.strictEqual(storedLot.remaining_cost_cents, 0);
    const copies = await db.all('SELECT id FROM collection WHERE user_id = ?', [user]);
    assert.strictEqual(copies.length, 1, 'Only the promo is filed on conversion');
    assert.strictEqual((await send('POST', `/api/sealed/lots/${lot.id}/openings`, payload)).status, 200);
    assert.strictEqual((await listed(product)).conversions[0].packs.length, 3);
    assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ?', [user])).n, 1);
    assert.strictEqual((await send('POST', `/api/sealed/lots/${lot.id}/openings`, { ...payload, notes: 'changed' })).status, 409);
    assert.strictEqual((await send('POST', `/api/sealed/lots/${lot.id}/openings`, { ...payload, request_id: 'convert-empty-lot' })).status, 400);
    const first = converted.packs[0], untouched = converted.packs[1];
    assert.strictEqual((await send('PUT', `/api/sealed/lots/${first.id}`, { total_cost: '99' })).status, 409);
    assert.strictEqual((await send('POST', `/api/sealed/lots/${first.id}/openings`, { ...payload, request_id: 'convert-child-pack' })).status, 400);
    const child = await send('POST', `/api/sealed/lots/${first.id}/openings`, { entry_complete: true, pulls: [card('5')] });
    assert.strictEqual(child.status, 201, JSON.stringify(child.body));
    assert.strictEqual(child.body.opening.cost_cents, 1000);
    data = await listed(product);
    assert.strictEqual(data.openings.length, 1);
    assert.strictEqual(data.conversions[0].packs[0].openings[0].pulls.length, 1);
    assert.strictEqual(data.conversions[0].packs[1].remaining_quantity, 1);
    assert.strictEqual((await send('DELETE', `/api/sealed/openings/${parentId}`)).status, 409);
    assert.strictEqual((await send('DELETE', `/api/sealed/openings/${child.body.opening.id}`)).status, 200);
    assert.strictEqual((await send('PUT', `/api/sealed/openings/${parentId}/conversion-values`, { packs: [], promos: [] })).status, 409);
    await db.run("UPDATE sealed_product SET market_price_cents = 9900, market_currency = 'USD' WHERE id = ?", [first.product_id]);
    assert.deepStrictEqual((await listed(product)).conversions[0].allocation, converted.allocation, 'Later prices do not rewrite opening-time weights');
    assert.strictEqual((await send('DELETE', `/api/sealed/openings/${parentId}`)).status, 200);
    assert.strictEqual(await db.get('SELECT id FROM sealed_lot WHERE id = ?', [untouched.id]), undefined);
    assert.strictEqual((await db.get('SELECT remaining_cost_cents FROM sealed_lot WHERE id = ?', [lot.id])).remaining_cost_cents, 6001);
    assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ?', [user])).n, 0);

    const pendingProduct = await create('Pending UPC', '25.01'), pendingLot = pendingProduct.lots[0];
    const pending = await send('POST', `/api/sealed/lots/${pendingLot.id}/openings`, {
      request_id: 'convert-pending-0002', entry_complete: true, pulls: [card('10')],
      packs: [{ name: 'Unknown price pack', quantity: 2 }],
    });
    assert.strictEqual(pending.status, 201, JSON.stringify(pending.body));
    assert.strictEqual(pending.body.opening.cost_pending, true);
    assert.strictEqual(pending.body.opening.cost_cents, 2501);
    converted = (await listed(pendingProduct)).conversions[0];
    const pack1 = converted.packs[0], pack2 = converted.packs[1], pendingId = pending.body.opening.id;
    const childPending = await send('POST', `/api/sealed/lots/${pack1.id}/openings`, { entry_complete: true, pulls: [card('5')] });
    assert.strictEqual(childPending.status, 201, JSON.stringify(childPending.body));
    assert.strictEqual(childPending.body.opening.cost_pending, true);
    assert.strictEqual((await basis.finalize(user, childPending.body.opening.id)).status, 'pending');
    const childCopy = childPending.body.opening.pulls[0].collection_id;
    await assert.rejects(require('../src/utils/salesRepository').createSalesRepository({ connect }).createLot(user, { collectionId: childCopy }), error => error.status === 409 && /allocation/.test(error.message));
    await assert.rejects(sales.preview(user, sale('sealed', pack2.id)), error => error.status === 409 && /allocation/.test(error.message));
    await assert.rejects(sales.preview(user, sale('card', childCopy)), error => error.status === 409 && /allocation/.test(error.message));
    const values = { packs: [{ lot_id: pack1.id, market_value: '10' }, { lot_id: pack2.id, market_value: '20' }], promos: [{ pull_id: pending.body.opening.pulls[0].id, market_value: '10' }] };
    assert.strictEqual((await send('PUT', `/api/sealed/openings/${pendingId}/conversion-values`, values, other)).status, 404);
    assert.strictEqual((await send('GET', `/api/sealed/products/${pendingProduct.id}/openings`, null, other)).status, 404);
    const malformed = { packs: [...values.packs, { lot_id: first.id, market_value: '100' }], promos: [] };
    assert.strictEqual((await send('PUT', `/api/sealed/openings/${pendingId}/conversion-values`, malformed)).status, 400);
    assert.strictEqual((await listed(pendingProduct)).conversions[0].packs[0].market_value, null, 'Failed edits roll back all market weights');
    const finalized = await send('PUT', `/api/sealed/openings/${pendingId}/conversion-values`, values);
    assert.strictEqual(finalized.status, 200, JSON.stringify(finalized.body));
    assert.strictEqual(finalized.body.allocation_status, 'finalized');
    data = await listed(pendingProduct);
    assert.strictEqual(data.openings[0].cost_cents, 625);
    assert.deepStrictEqual(data.conversions[0].packs.map(pack => pack.total_cost_cents), [625, 1251]);
    assert.strictEqual(data.conversions[0].packs[0].openings[0].cost_cents, 625);
    assert.strictEqual(data.conversions[0].packs[0].openings[0].cost_pending, false);
    assert.strictEqual((await db.get('SELECT remaining_cost_cents FROM sealed_lot WHERE id = ?', [pack1.id])).remaining_cost_cents, 0);
    assert.strictEqual((await db.get('SELECT remaining_cost_cents FROM sealed_lot WHERE id = ?', [pack2.id])).remaining_cost_cents, 1251);
    assert.strictEqual((await sales.preview(user, sale('card', childCopy))).soldBasisCents, 625);
    assert.strictEqual((await sales.preview(user, sale('sealed', pack2.id))).soldBasisCents, 1251);
    assert.strictEqual((await spending(user)).knownCents, 8502);
    await db.initDb();
    assert.strictEqual((await listed(pendingProduct)).conversions[0].allocation_status, 'finalized', 'Conversion persists across schema initialization');
    assert.strictEqual((await send('DELETE', `/api/sealed/openings/${childPending.body.opening.id}`)).status, 200);
    assert.strictEqual((await send('DELETE', `/api/sealed/openings/${pendingId}`)).status, 200);

    const zeroProduct = await create('Zero quotes box', '10');
    const zero = await send('POST', `/api/sealed/lots/${zeroProduct.lots[0].id}/openings`, {
      request_id: 'convert-zero-quotes', entry_complete: true, pulls: [],
      packs: [{ name: 'Zero quote pack', quantity: 2, market_value: '0' }],
    });
    assert.strictEqual(zero.status, 201);
    assert.strictEqual(zero.body.opening.cost_pending, true, 'An all-zero weight total cannot allocate a purchase');
    assert.strictEqual((await send('DELETE', `/api/sealed/openings/${zero.body.opening.id}`)).status, 200);
    const incomplete = await send('POST', `/api/sealed/lots/${zeroProduct.lots[0].id}/openings`, {
      request_id: 'convert-missing-promo', entry_complete: false, pulls: [{ name: 'Unpriced promo', quantity: 2 }],
      packs: [{ name: 'Known price pack', quantity: 2, market_value: '5' }],
    });
    assert.strictEqual(incomplete.status, 201);
    const incompleteId = incomplete.body.opening.id, promoId = incomplete.body.opening.pulls[0].id;
    const promoValue = { packs: [], promos: [{ pull_id: promoId, market_value: '10' }] };
    assert.strictEqual((await send('PUT', `/api/sealed/openings/${incompleteId}/conversion-values`, promoValue)).body.allocation_status, 'pending', 'Unfinished promo entry prevents finalization');
    await send('PUT', `/api/sealed/openings/${incompleteId}`, { entry_complete: true });
    assert.strictEqual((await send('PUT', `/api/sealed/openings/${incompleteId}/conversion-values`, promoValue)).body.allocation_status, 'finalized');
    assert.strictEqual((await listed(zeroProduct)).openings[0].cost_cents, 500, 'Two promos receive their combined proportional market weight');
    assert.strictEqual((await send('DELETE', `/api/sealed/openings/${incompleteId}`)).status, 200);
    const rollbackLot = zeroProduct.lots[0].id;
    await db.run("CREATE TRIGGER conversion_abort BEFORE INSERT ON sealed_pack_lot BEGIN SELECT RAISE(ABORT, 'forced conversion failure'); END");
    const failed = await send('POST', `/api/sealed/lots/${rollbackLot}/openings`, { request_id: 'convert-rollback-0003', entry_complete: true, pulls: [card()], packs: [{ name: 'Rollback pack', quantity: 2, market_value: '5' }] });
    assert.strictEqual(failed.status, 500);
    assert.strictEqual((await db.get('SELECT remaining_quantity FROM sealed_lot WHERE id = ?', [rollbackLot])).remaining_quantity, 1);
    assert.strictEqual(await db.get("SELECT id FROM sealed_product WHERE name = 'Rollback pack'"), undefined);
    assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ?', [user])).n, 0);
    await db.run('DROP TRIGGER conversion_abort');
    const otherProduct = await send('POST', '/api/sealed/products', { name: 'Other user box', product_type: 'booster_box', lot: { quantity: 1, total_cost: '5', currency: 'USD' } }, other);
    const otherConverted = await send('POST', `/api/sealed/lots/${otherProduct.body.product.lots[0].id}/openings`, {
      request_id: 'convert-owner-delete', entry_complete: true, pulls: [], packs: [{ name: 'Other user pack', quantity: 2 }],
    }, other);
    assert.strictEqual(otherConverted.status, 201);
    await db.run('DELETE FROM users WHERE id = ?', [other]);
    assert.strictEqual(await db.get('SELECT opening_id FROM sealed_product_conversion WHERE user_id = ?', [other]), undefined);
    assert.deepStrictEqual(await db.all('PRAGMA foreign_key_check'), []);

    // A pack picked from the sealed catalog becomes a linked, quoted product, and
    // a second conversion of the same catalog pack reuses it.
    const catalogPack = { name: 'Catalog Booster Pack', set_name: 'Catalog Set', set_id: 'cat', quantity: 1, market_value: '4.50',
      provider: 'pokewallet', provider_product_id: 'pk_0123456789abcdef', catalog_market_price: '4.25', catalog_market_currency: 'USD', market_source: 'pokewallet' };
    for (const [index, requestId] of ['convert-catalog-0001', 'convert-catalog-0002'].entries()) {
      const box = await create(`Catalog box ${index}`, '10');
      const made = await send('POST', `/api/sealed/lots/${box.lots[0].id}/openings`, { request_id: requestId, entry_complete: true, pulls: [], packs: [catalogPack] });
      assert.strictEqual(made.status, 201, JSON.stringify(made.body));
    }
    const linked = await db.all("SELECT * FROM sealed_product WHERE provider_product_id = 'pk_0123456789abcdef'");
    assert.strictEqual(linked.length, 1, 'the same catalog pack is one product');
    assert.strictEqual(linked[0].market_price_cents, 425);
    assert.strictEqual(linked[0].market_source, 'pokewallet');
    assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM sealed_lot WHERE product_id = ?', [linked[0].id])).n, 2);
    const unlinked = await db.get("SELECT provider, provider_product_id FROM sealed_product WHERE name = 'Set A pack'");
    assert.deepStrictEqual({ ...unlinked }, { provider: '', provider_product_id: '' }, 'a hand-typed pack stays unlinked');
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('sealedConversion.test.js: all assertions passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await new Promise((resolve, reject) => db.dbConnection.close(error => error ? reject(error) : resolve()));
  for (const suffix of ['', '-wal', '-shm']) {
    const file = process.env.DB_PATH + suffix;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});
