'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { openConnection } = require('../src/utils/salesRepository');
const { prepare, createTradePortal, webhookUrl } = require('../src/utils/tradePortal');
const { createTradeRouters } = require('../src/routes/tradePortal');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trade-portal-test-'));
  const file = path.join(dir, 'test.db');
  await fs.writeFile(file, '');
  const db = await openConnection(file);
  t.after(async () => { await db.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT, share_token TEXT, share_enabled INTEGER);
    INSERT INTO users VALUES (1,'owner','collection-only-token',0),(2,'other','other-token',1);
    CREATE TABLE card_cache(id TEXT PRIMARY KEY, name TEXT, printed_name TEXT, set_name TEXT, number TEXT,
      image_url TEXT, game TEXT, price_trend REAL, price_normal REAL, price_holofoil REAL,
      price_reverse_holofoil REAL, price_1st_edition REAL, price_currency TEXT, price_source TEXT, rarity TEXT);
    INSERT INTO card_cache VALUES ('a','Trade Pikachu','Pikachu','Set A','1','','pokemon',10,10,20,NULL,NULL,'USD','fixture','Rare'),
      ('b','Wanted Raichu','Raichu','Set B','2','','pokemon',8,8,NULL,NULL,NULL,'EUR','fixture',NULL),
      ('c','Unknown card','Unknown','Set C','3','','pokemon',0,NULL,NULL,NULL,NULL,'USD','fixture',NULL);
    CREATE TABLE collection(id INTEGER PRIMARY KEY, user_id INTEGER, card_id TEXT, quantity INTEGER,
      condition TEXT, printing TEXT, language TEXT, grader TEXT, grade REAL, market_value REAL,
      list_type TEXT, is_trade INTEGER, purchase_price REAL, notes TEXT);
    INSERT INTO collection VALUES
      (10,1,'a',2,'Near Mint','Holofoil','English','Raw',NULL,NULL,'collection',1,99,'private note'),
      (11,1,'a',1,'Near Mint','Normal','English','Raw',NULL,NULL,'collection',0,99,'not for trade'),
      (12,1,'a',1,'Near Mint','Normal','English','Raw',NULL,NULL,'sold',1,99,'sold'),
      (20,1,'b',3,'Near Mint','Normal','English','Raw',NULL,NULL,'wishlist',0,NULL,'private wanted note'),
      (21,1,'c',1,'Near Mint','Normal','English','Raw',NULL,NULL,'wishlist',0,NULL,'unknown'),
      (30,2,'a',1,'Near Mint','Normal','English','Raw',NULL,NULL,'collection',1,5,'other user');
    CREATE TABLE sealed_product(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, product_type TEXT,
      set_name TEXT DEFAULT '', set_id TEXT DEFAULT '', language TEXT DEFAULT 'English', image_url TEXT DEFAULT '',
      provider TEXT DEFAULT '', provider_product_id TEXT DEFAULT '',
      market_price_cents INTEGER, market_currency TEXT, archived_at TEXT);
    CREATE TABLE sealed_lot(id INTEGER PRIMARY KEY, user_id INTEGER, product_id INTEGER, quantity INTEGER, remaining_quantity INTEGER,
      total_cost_cents INTEGER, remaining_cost_cents INTEGER, currency TEXT, archived_at TEXT, updated_at TEXT, purchased_at TEXT, notes TEXT);`);
  for (let pass = 0; pass < 2; pass++) await prepare(db);
  let notifications = 0, notificationFails = false, fxFails = false;
  const service = createTradePortal({ db, connect: () => openConnection(file),
    valuationFor: currency => {
      if (!['USD', 'EUR'].includes(currency)) throw Object.assign(new Error('Unsupported reporting currency'), {status: 400});
      return {
        cents: async (amount, source) => {
          if (fxFails && source !== currency) throw Object.assign(new Error('Unavailable'), {code: 'VALUATION_FX_UNAVAILABLE'});
          return source === currency ? amount : amount * 2;
        },
        metadata: () => ({ currency, staleRates: false, sourceCurrencies: ['USD', 'EUR'] }),
      };
    },
    notify: async () => { notifications++; if (notificationFails) throw Object.assign(new Error('Secret URL must not leak'), {code: 'TEST_FAILED'}); },
  });
  const settings = await service.update(1, { enabled: true, currency: 'USD' });
  const body = {
    requested: [{entry_id: 10, quantity: 1}], offered: [{entry_id: 20, quantity: 1}],
    discord_contact: 'visitor.discord', message: 'Interested in trading',
    request_key: 'request-key-12345678',
  };
  return { db, service, settings, body, connect: () => openConnection(file), notifications: () => notifications,
    failNotification: () => { notificationFails = true; }, failFx: () => { fxFails = true; } };
}

test('trade token exposes only listed copies and wants, independently of collection sharing', async t => {
  const {service, settings} = await fixture(t);
  assert.equal(settings.token.length, 64);
  assert.equal(settings.webhook_configured, false);
  assert.ok(!('discord_webhook' in settings));
  const page = await service.listing(settings.token);
  assert.deepEqual(page.available.map(card => card.entry_id), [10]);
  assert.deepEqual(page.wanted.map(card => card.entry_id), [21, 20]);
  assert.equal(page.available[0].unit_cents, 2000, 'selected Holofoil quote, not Normal price');
  assert.equal(page.wanted.find(card => card.entry_id === 20).unit_cents, 1600, 'FX conversion');
  for (const card of [...page.available, ...page.wanted]) {
    for (const key of ['user_id','purchase_price','notes','market_value','cert_number','location_id','share_token','discord_webhook']) {
      assert.equal(key in card, false, `private ${key} absent`);
    }
  }
  await assert.rejects(service.listing('collection-only-token'), {status: 404});
  const old = settings.token, rotated = await service.rotate(1);
  assert.notEqual(rotated.token, old);
  await assert.rejects(service.listing(old), {status: 404});
  await service.update(1, {enabled: false, currency: 'USD'});
  await assert.rejects(service.listing(rotated.token), {status: 404});
});

test('quotes and stored proposals use authoritative quantities and prices without changing inventory', async t => {
  const {db, service, settings, body} = await fixture(t);
  const before = await db.all('SELECT * FROM collection ORDER BY id');
  const quote = await service.quote(settings.token, {...body, requested_total: 1, difference_percent: 100});
  assert.deepEqual(quote.summary, {
    currency: 'USD', requested: {known_cents: 2000, unknown_quantity: 0},
    offered: {known_cents: 1600, unknown_quantity: 0}, cash_cents: 0, difference_cents: -400, difference_percent: -20,
  });
  const saved = await service.submit(settings.token, body);
  assert.equal(saved.notification, 'not_configured');
  assert.equal(saved.replayed, false);
  assert.equal((await service.submit(settings.token, body)).id, saved.id);
  await assert.rejects(service.submit(settings.token, {...body, message: 'changed'}), {status: 409});
  assert.equal((await service.inbox(1)).requests.length, 1);
  assert.equal((await service.inbox(2)).requests.length, 0);
  assert.equal((await service.inbox(1)).requests[0].proposal.summary.difference_percent, -20);
  assert.deepEqual(await db.all('SELECT * FROM collection ORDER BY id'), before);
  await assert.rejects(service.remove(2, saved.id), {status: 404});
  await service.remove(1, saved.id);
  assert.equal((await service.inbox(1)).requests.length, 0);
});

test('unknown prices and FX failures never produce a misleading fairness percentage', async t => {
  const f = await fixture(t);
  const unknown = await f.service.quote(f.settings.token, {...f.body, offered: [{entry_id: 21, quantity: 1}]});
  assert.equal(unknown.summary.difference_percent, null);
  assert.equal(unknown.summary.difference_cents, null);
  assert.equal(unknown.summary.offered.unknown_quantity, 1);
  f.failFx();
  const fx = await f.service.quote(f.settings.token, f.body);
  assert.equal(fx.offered[0].price_state, 'fx_unavailable');
  assert.equal(fx.summary.difference_percent, null);
  const saved = await f.service.submit(f.settings.token, f.body);
  assert.ok(saved.id, 'unknown pricing does not block proposals');
});

test('identical copies stack, differing condition or printing stay separate, and copies are priced individually', async t => {
  const {db, service, settings, body} = await fixture(t);
  await db.exec(`INSERT INTO collection VALUES
    (13,1,'a',1,'Near Mint','Holofoil','English','Raw',NULL,25,'collection',1,99,''),
    (14,1,'a',1,'Lightly Played','Holofoil','English','Raw',NULL,NULL,'collection',1,99,''),
    (15,1,'a',1,'Near Mint','Normal','English','Raw',NULL,NULL,'collection',1,99,'');`);
  const page = await service.listing(settings.token);
  const stack = page.available.find(card => card.entry_id === 10);
  assert.equal(stack.quantity, 3, 'two legacy-stacked copies plus one identical copy');
  assert.equal(stack.price_varies, true);
  assert.ok(!('copies' in stack) && !('list_type' in stack));
  assert.deepEqual(page.available.map(card => card.entry_id).sort(), [10, 14, 15]);
  const quote = await service.quote(settings.token, {...body, requested: [{entry_id: 10, quantity: 3}]});
  assert.deepEqual(quote.requested[0].entry_ids, [10, 13]);
  assert.equal(quote.summary.requested.known_cents, 2000 * 2 + 2500);
  await assert.rejects(service.quote(settings.token, {...body, requested: [{entry_id: 13, quantity: 1}]}), {status: 409},
    'only the stack ID is selectable');
  await assert.rejects(service.quote(settings.token, {...body, requested: [{entry_id: 10, quantity: 4}]}), {status: 409});
});

test('visitors can add cash or offer cash only, and cash counts toward the offered value', async t => {
  const {service, settings, body} = await fixture(t);
  const topUp = await service.quote(settings.token, {...body, cash_cents: 400});
  assert.equal(topUp.summary.cash_cents, 400);
  assert.equal(topUp.summary.offered.known_cents, 2000);
  assert.equal(topUp.summary.difference_percent, 0);
  const cashOnly = {...body, offered: [], cash_cents: 2500, request_key: 'cash-only-request-1234'};
  const quote = await service.quote(settings.token, cashOnly);
  assert.deepEqual(quote.offered, []);
  assert.equal(quote.summary.difference_cents, 500);
  const saved = await service.submit(settings.token, cashOnly);
  assert.equal((await service.inbox(1)).requests.find(row => row.id === saved.id).proposal.summary.cash_cents, 2500);
  for (const cash_cents of [-1, 1.5, '500', 10_000_001]) {
    await assert.rejects(service.quote(settings.token, {...body, cash_cents}), {status: 400});
  }
  await assert.rejects(service.quote(settings.token, {...body, offered: []}), {status: 400}, 'an offer needs cards or cash');
  await assert.rejects(service.quote(settings.token, {...body, offered: [], cash_cents: 0}), {status: 400});
});

test('stale, hidden, other-user and duplicate selections are rejected', async t => {
  const {db, service, settings, body} = await fixture(t);
  for (const id of [11, 12, 20, 30, 999]) {
    await assert.rejects(service.quote(settings.token, {...body, requested: [{entry_id: id, quantity: 1}]}), {status: 409});
  }
  for (const requested of [[], [{entry_id: 10, quantity: 0}], [{entry_id: 10, quantity: 1.5}],
    [{entry_id: 10, quantity: 1}, {entry_id: 10, quantity: 1}], Array(51).fill({entry_id: 10, quantity: 1})]) {
    await assert.rejects(service.quote(settings.token, {...body, requested}), {status: 400});
  }
  await assert.rejects(service.quote(settings.token, {...body, requested: [{entry_id: 10, quantity: 3}]}), {status: 409});
  await db.run('UPDATE collection SET is_trade=0 WHERE id=10');
  await assert.rejects(service.submit(settings.token, body), {status: 409});
  assert.equal((await service.inbox(1)).requests.length, 0);
});

test('concurrent retries insert exactly one immutable proposal', async t => {
  const {db, service, settings, body} = await fixture(t);
  const results = await Promise.all([
    service.submit(settings.token, body),
    service.submit(settings.token, body),
    service.submit(settings.token, {...body, request_key: 'another-request-123456'}),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(results.filter(result => result.replayed).length, 1);
  assert.equal((await service.inbox(1)).requests.length, 2);
  await db.run('UPDATE collection SET quantity=1 WHERE id=10');
  await assert.rejects(service.submit(settings.token, {...body, request_key: 'stale-request-12345678', requested: [{entry_id: 10, quantity: 2}]}), {status: 409});
});

test('Discord delivery failure preserves inbox, replay does not duplicate notification, and URL is restricted', async t => {
  const f = await fixture(t);
  const url = 'https://discord.com/api/webhooks/123456/' + 'a'.repeat(40);
  await f.service.update(1, {enabled: true, currency: 'USD', discord_webhook: url});
  assert.equal((await f.service.settings(1)).webhook_configured, true);
  const sent = await f.service.submit(f.settings.token, f.body);
  assert.equal(sent.notification, 'delivered');
  await f.service.submit(f.settings.token, f.body);
  assert.equal(f.notifications(), 1);
  f.failNotification();
  assert.equal(await f.service.retry(1, sent.id), 'failed');
  assert.equal((await f.service.inbox(1)).requests[0].notification, 'failed');
  await assert.rejects(f.service.retry(2, sent.id), {status: 404});
  for (const candidate of ['http://127.0.0.1/hook', url + '?x=1', url.replace('discord.com','discord.com.example.org'),
    url.replace('discord.com','discord.com:444'), url.replace('discord.com','user:pass@discord.com'),
    url.replace('https:', 'http:'), 'https://discord.com/api/other']) {
    assert.throws(() => webhookUrl(candidate), {status: 400});
  }
  await f.service.update(1, {enabled: true, currency: 'USD', discord_webhook: ''});
  assert.equal((await f.service.settings(1)).webhook_configured, false);
});

test('Discord transport disallows redirects and mentions and bounds delivery time', async t => {
  const f = await fixture(t);
  const axios = require('axios');
  const previous = axios.defaults.adapter;
  t.after(() => { axios.defaults.adapter = previous; });
  let posted;
  axios.defaults.adapter = async config => {
    posted = config;
    return { status: 204, statusText: 'No Content', data: '', headers: {}, config };
  };
  const service = createTradePortal({ db: f.db, connect: f.connect });
  await service.update(1, { enabled: true, currency: 'USD', discord_webhook: 'https://discord.com/api/webhooks/123456/' + 'a'.repeat(40) });
  const saved = await service.submit(f.settings.token, {...f.body, offered: [{entry_id: 21, quantity: 1}], discord_contact: '@everyone'});
  assert.equal(saved.notification, 'delivered');
  assert.equal(posted.maxRedirects, 0);
  assert.equal(posted.timeout, 8000);
  const payload = JSON.parse(posted.data);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.ok(payload.embeds[0].description.includes('@everyone'));
  assert.ok(!posted.data.includes('private note'));
});

test('public HTTP workflow and owner inbox remain on distinct authentication boundaries', async t => {
  const f = await fixture(t);
  const {publicRouter, privateRouter} = createTradeRouters(f.service);
  const app = express(); app.use(express.json());
  app.use('/api/trade-public', publicRouter);
  app.use('/api', (req, res, next) => {
    if (!req.get('x-user')) return res.status(401).json({error: 'Login required'});
    req.user = {id: Number(req.get('x-user')), via_api_key: req.get('x-api-key') === '1'}; next();
  });
  app.use('/api/trade', privateRouter);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = (url, options) => fetch(`http://127.0.0.1:${server.address().port}${url}`, options);
  assert.equal((await call('/api/trade/settings')).status, 401);
  assert.equal((await call('/api/trade/settings', {headers: {'x-user': '1','x-api-key': '1'}})).status, 403);
  const listed = await call(`/api/trade-public/${f.settings.token}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('cache-control'), 'no-store');
  const sent = await call(`/api/trade-public/${f.settings.token}/requests`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(f.body),
  });
  assert.equal(sent.status, 201);
  assert.equal((await call('/api/trade/requests', {headers: {'x-user': '2'}})).status, 200);
  const other = await (await call('/api/trade/requests', {headers: {'x-user': '2'}})).json();
  assert.deepEqual(other.requests, []);
  for (let attempt = 1; attempt < 5; attempt++) {
    assert.equal((await call(`/api/trade-public/${f.settings.token}/requests`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(f.body),
    })).status, 200);
  }
  const limited = await call(`/api/trade-public/${f.settings.token}/requests`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(f.body),
  });
  assert.equal(limited.status, 429);
  assert.ok((await limited.json()).error);
});

test('custom binders expose only their members, and links are revoked by disabling, rotating or deleting', async t => {
  const { db, service, settings, body } = await fixture(t);
  await db.exec(`INSERT INTO collection VALUES (13,1,'b',1,'Near Mint','Normal','English','Raw',NULL,NULL,'collection',1,4,'')`);
  const binder = await service.createBinder(1, { name: 'Event binder' });
  assert.equal(binder.items, 0);
  assert.deepEqual((await service.listing(binder.token)).available, []);
  await assert.rejects(service.assign(1, { entry_ids: [11], add_to: [binder.id] }), {status: 409}, 'unlisted copies cannot join a binder');
  await assert.rejects(service.assign(2, { entry_ids: [30], add_to: [binder.id] }), {status: 404});
  await service.assign(1, { entry_ids: [10, 20], add_to: [binder.id] });
  const page = await service.listing(binder.token);
  assert.equal(page.binder, 'Event binder');
  assert.deepEqual(page.available.map(card => card.entry_id), [10]);
  assert.deepEqual(page.wanted.map(card => card.entry_id), [20]);
  assert.equal((await service.listing(settings.token)).available.length, 2, 'the master link still lists everything');
  await assert.rejects(service.quote(binder.token, {...body, requested: [{entry_id: 13, quantity: 1}]}), {status: 409});

  await service.update(1, { enabled: false, currency: 'USD' });
  const saved = await service.submit(binder.token, body);
  const [request] = (await service.inbox(1, null)).requests;
  assert.equal(request.id, saved.id);
  assert.equal(request.binder_name, 'Event binder');
  assert.equal(request.status, 'new');

  const other = await service.createBinder(1, { name: 'Online' });
  await service.assign(1, { entry_ids: [10], add_to: [other.id], remove_from: [binder.id] });
  const items = await service.items(1);
  assert.deepEqual(items.available.find(card => card.entry_id === 10).binder_ids, [other.id]);
  assert.equal(items.available.find(card => card.entry_id === 10).rarity, 'Rare');
  assert.deepEqual(items.wanted.find(card => card.entry_id === 20).binder_ids, [binder.id]);

  await service.updateBinder(1, binder.id, { enabled: false });
  await assert.rejects(service.listing(binder.token), {status: 404});
  const rotated = await service.rotateBinder(1, other.id);
  await assert.rejects(service.listing(other.token), {status: 404});
  assert.equal((await service.listing(rotated.token)).available.length, 1);
  await service.deleteBinder(1, other.id);
  await assert.rejects(service.listing(rotated.token), {status: 404});
  await assert.rejects(service.updateBinder(2, binder.id, { name: 'x' }), {status: 404});
});

test('unlisting returns copies to the collection and removes wanted entries and memberships', async t => {
  const { db, service } = await fixture(t);
  const binder = await service.createBinder(1, { name: 'B' });
  await service.assign(1, { entry_ids: [10, 21], add_to: [binder.id] });
  assert.deepEqual(await service.unlist(1, { entry_ids: [10, 21] }), { unlisted: 1, removed_wanted: 1 });
  assert.equal((await db.get('SELECT is_trade FROM collection WHERE id = 10')).is_trade, 0);
  assert.equal(await db.get('SELECT id FROM collection WHERE id = 21'), undefined);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM trade_binder_item')).n, 0);
  await assert.rejects(service.unlist(1, { entry_ids: [11] }), {status: 409});
});

test('inbox statuses filter and count, and completed trades cannot be reopened or deleted', async t => {
  const { db, service, settings, body } = await fixture(t);
  const first = await service.submit(settings.token, body);
  const second = await service.submit(settings.token, {...body, request_key: 'request-key-second-1'});
  await service.updateRequest(1, first.id, { status: 'active', owner_note: 'Meet Saturday' });
  assert.deepEqual((await service.inbox(1, null, 'active')).requests.map(row => [row.id, row.owner_note]), [[first.id, 'Meet Saturday']]);
  assert.deepEqual(await service.counts(1), { new: 1, active: 1, declined: 0, completed: 0, archived: 0 });
  await assert.rejects(service.updateRequest(1, second.id, { status: 'completed' }), {status: 400});
  await assert.rejects(service.updateRequest(2, second.id, { status: 'active' }), {status: 404});
  await assert.rejects(service.inbox(1, null, 'bogus'), {status: 400});
  await db.run("UPDATE trade_request SET status = 'completed' WHERE id = ?", [second.id]);
  await assert.rejects(service.updateRequest(1, second.id, { status: 'new' }), {status: 409});
  await assert.rejects(service.remove(1, second.id), {status: 409});
  assert.equal((await service.updateRequest(1, second.id, { owner_note: 'Done' })).owner_note, 'Done');
});

async function completionFixture(t) {
  const f = await fixture(t);
  await f.db.exec(`ALTER TABLE collection ADD COLUMN game TEXT;
    CREATE TABLE sealed_pull(id INTEGER PRIMARY KEY, user_id INTEGER, collection_id INTEGER, filed_ids TEXT, opening_id INTEGER);
    INSERT INTO collection(id,user_id,card_id,quantity,condition,printing,language,grader,list_type,is_trade,purchase_price)
      VALUES (13,1,'a',1,'Near Mint','Holofoil','English','Raw','collection',1,5);`);
  await f.db.run('UPDATE collection SET quantity = 1 WHERE id = 10');
  return f;
}

test('completing a trade books given copies as sales at received value plus net cash and adds received cards', async t => {
  const { db, service, settings, body } = await completionFixture(t);
  const saved = await service.submit(settings.token, {...body, requested: [{entry_id: 10, quantity: 2}], offered: [{entry_id: 20, quantity: 2}], cash_cents: 500});
  const draft = await service.completionDraft(1, saved.id);
  assert.deepEqual(draft.given.map(copy => [copy.entry_id, copy.value_cents, copy.available]), [[10, 2000, true], [13, 2000, true]]);
  assert.equal(draft.received[0].unit_cents, 1600, 'EUR price converted to USD');
  assert.deepEqual(draft.received[0].wishlist_ids, [20]);
  assert.equal(draft.cash_in_cents, 500);

  const terms = { given: [10, 13], received: [{ index: 0, quantity: 2, unit_cents: 1600 }], cash_in_cents: 501,
    cash_out_cents: 0, completed_on: '2026-03-01' };
  const preview = await service.previewCompletion(1, saved.id, terms);
  assert.equal(preview.proceeds_cents, 3701);
  assert.deepEqual(preview.given.map(copy => copy.proceeds_cents), [1851, 1850], 'largest remainder keeps the exact total');
  assert.deepEqual(preview.given.map(copy => copy.gain_cents), [1851 - 9900, 1850 - 500]);
  assert.equal((await db.get('SELECT list_type FROM collection WHERE id = 10')).list_type, 'collection', 'preview changes nothing');
  assert.equal((await db.get("SELECT status FROM trade_request WHERE id = ?", [saved.id])).status, 'new');

  await assert.rejects(service.complete(1, saved.id, {...terms, given: [11]}), {status: 400}, 'only proposal copies');
  await assert.rejects(service.complete(1, saved.id, {...terms, cash_out_cents: 10000}), {status: 400}, 'negative proceeds');
  const done = await service.complete(1, saved.id, terms);
  assert.equal(done.realized_gain_cents, 1851 - 9900 + 1850 - 500);
  const sold = await db.all("SELECT collection_id AS id, proceeds_cents FROM card_sale_record r JOIN card_acquisition_lot l ON l.id = r.lot_id ORDER BY collection_id");
  assert.deepEqual(sold, [{ id: 10, proceeds_cents: 1851 }, { id: 13, proceeds_cents: 1850 }]);
  assert.deepEqual((await db.all("SELECT list_type FROM collection WHERE id IN (10, 13)")).map(row => row.list_type), ['sold', 'sold']);
  const received = await db.all("SELECT card_id, quantity, purchase_price, is_trade, game FROM collection WHERE id IN (" + done.received[0].entry_ids.join(',') + ")");
  assert.deepEqual(received, [1, 2].map(() => ({ card_id: 'b', quantity: 1, purchase_price: 16, is_trade: 0, game: 'pokemon' })));
  assert.equal((await db.get('SELECT quantity FROM collection WHERE id = 20')).quantity, 1, 'wanted quantity is decremented');
  assert.equal((await service.counts(1)).completed, 1);
  await assert.rejects(service.complete(1, saved.id, terms), {status: 409});
  const history = await service.history(1);
  assert.equal(history.totals.trades, 1);
  assert.equal(history.totals.received_cents, 3200);
  assert.equal(history.totals.cash_in_cents, 501);
  assert.equal(history.trades[0].result.given.length, 2);
});

test('trade completion requires acknowledging unknown basis and validates cash-only purchases', async t => {
  const { db, service, settings, body } = await completionFixture(t);
  await db.run('UPDATE collection SET purchase_price = NULL WHERE id = 10');
  const saved = await service.submit(settings.token, body);
  const terms = { given: [10], received: [], cash_in_cents: 2000, completed_on: '2026-03-01' };
  await assert.rejects(service.complete(1, saved.id, terms), {status: 400});
  const done = await service.complete(1, saved.id, {...terms, allow_unknown_basis: true});
  assert.equal(done.unknown_basis, 1);
  assert.equal(done.realized_gain_cents, null);

  const buy = await service.submit(settings.token, {...body, request_key: 'request-key-buy-0001', requested: [{entry_id: 13, quantity: 1}]});
  await assert.rejects(service.complete(1, buy.id, { given: [], received: [{ index: 0, quantity: 1, unit_cents: 900 }],
    cash_out_cents: 1000, completed_on: '2026-03-02' }), {status: 400}, 'value received must match cash paid');
  const bought = await service.complete(1, buy.id, { given: [], received: [{ index: 0, quantity: 1, unit_cents: 1000 }],
    cash_out_cents: 1000, completed_on: '2026-03-02', remove_from_wishlist: false });
  assert.equal(bought.proceeds_cents, 0);
  assert.equal((await db.get('SELECT quantity FROM collection WHERE id = 20')).quantity, 3);
});

async function sealedFixture(t) {
  const f = await completionFixture(t);
  const listings = require('../src/utils/tradeSealed');
  await f.db.exec(`INSERT INTO sealed_product(id,user_id,name,product_type,set_name,market_price_cents,market_currency) VALUES
    (1,1,'Booster box','booster_box','151',12000,'USD'),
    (2,1,'Wanted ETB','etb','151',5000,'USD'),
    (3,2,'Private box','booster_box','151',10000,'USD');
    INSERT INTO sealed_lot(id,user_id,product_id,quantity,remaining_quantity,total_cost_cents,remaining_cost_cents,currency) VALUES
    (1,1,1,4,4,28000,28000,'USD'), (2,2,3,1,1,1000,1000,'USD');`);
  await listings.setListing(f.db, 1, { product_id: 1, lot_id: 1, listed: true });
  await listings.setListing(f.db, 1, { product_id: 2, quantity: 3, listed: true });
  const rows = await listings.rows(f.db, 1);
  return { ...f, listing: rows.find(row => row.list_type === 'collection'),
    wanted: rows.find(row => row.list_type === 'wishlist'), listings };
}

test('sealed offers and binders use separate IDs, current stock and public-only metadata', async t => {
  const { db, service, settings, listing, wanted } = await sealedFixture(t);
  const binder = await service.createBinder(1, { name: 'Cards and boxes' });
  await service.assign(1, { entry_ids: [10, listing.entry_id, wanted.entry_id], add_to: [binder.id] });
  const page = await service.listing(binder.token);
  assert.equal(page.available.find(item => item.kind === 'sealed').quantity, 4);
  const sealed = page.available.find(item => item.kind === 'sealed');
  assert.equal(sealed.unit_cents, 12000);
  for (const key of ['lot_id', 'user_id', 'total_cost_cents', 'remaining_cost_cents', 'notes']) assert.equal(key in sealed, false);
  assert.equal((await service.binders(1))[0].items, 3, 'card and sealed memberships both count');
  assert.deepEqual((await service.items(1)).available.find(item => item.kind === 'sealed').binder_ids, [binder.id]);
  const offer = { requested: [{ entry_id: listing.entry_id, quantity: 2 }], offered: [{ entry_id: wanted.entry_id, quantity: 3 }] };
  assert.equal((await service.quote(settings.token, offer)).summary.requested.known_cents, 24000);
  assert.equal((await service.quote(settings.token, offer)).summary.offered.known_cents, 15000);
  await assert.rejects(service.assign(2, { entry_ids: [listing.entry_id], add_to: [(await service.createBinder(2, { name: 'Other' })).id] }), { status: 409 });
  await db.run('UPDATE sealed_lot SET remaining_quantity = 1 WHERE id = 1');
  await assert.rejects(service.quote(settings.token, offer), { status: 409 });
  await service.unlist(1, { entry_ids: [listing.entry_id, wanted.entry_id] });
  assert.equal((await service.listing(binder.token)).available.filter(item => item.kind === 'sealed').length, 0);
  assert.equal((await db.get('SELECT remaining_quantity FROM sealed_lot WHERE id = 1')).remaining_quantity, 1, 'unlisting never consumes stock');
});

test('sealed trade completion previews without mutation, consumes exact lot basis and receives wishlist lots', async t => {
  const { db, service, settings, body, listing, wanted } = await sealedFixture(t);
  const binder = await service.createBinder(1, { name: 'Boxes' });
  await service.assign(1, { entry_ids: [listing.entry_id, wanted.entry_id], add_to: [binder.id] });
  const saved = await service.submit(binder.token, { ...body, requested: [{ entry_id: listing.entry_id, quantity: 2 }],
    offered: [{ entry_id: wanted.entry_id, quantity: 2 }], cash_cents: 5000 });
  const draft = await service.completionDraft(1, saved.id);
  assert.equal(draft.given[0].max_quantity, 2);
  assert.equal(draft.received[0].kind, 'sealed');
  const terms = { given: [{ entry_id: listing.entry_id, quantity: 2 }], received: [{ index: 0, quantity: 2, unit_cents: 5000 }],
    cash_in_cents: 5000, completed_on: '2026-03-01' };
  const preview = await service.previewCompletion(1, saved.id, terms);
  assert.equal(preview.given[0].basis_cents, 14000);
  assert.equal(preview.realized_gain_cents, 1000);
  assert.equal((await db.get('SELECT remaining_quantity FROM sealed_lot WHERE id = 1')).remaining_quantity, 4);
  await assert.rejects(service.complete(1, saved.id, { ...terms, given: [{ entry_id: listing.entry_id, quantity: 3 }] }), { status: 409 });
  const done = await service.complete(1, saved.id, terms);
  const lot = await db.get('SELECT * FROM sealed_lot WHERE id = ?', [done.received[0].lot_id]);
  assert.equal(lot.product_id, 2);
  assert.equal(lot.remaining_quantity, 2);
  assert.equal(lot.total_cost_cents, 10000);
  assert.equal(lot.currency, 'USD');
  assert.equal((await db.get('SELECT remaining_cost_cents FROM sealed_lot WHERE id = 1')).remaining_cost_cents, 14000);
  assert.equal((await db.get("SELECT quantity FROM trade_sealed_listing WHERE list_type = 'wishlist' AND user_id = 1")).quantity, 1);
  assert.equal((await service.listing(binder.token)).available[0].quantity, 2, 'partial trade keeps the remaining stock in the binder');
  assert.equal((await db.get("SELECT quantity FROM sealed_sale_record WHERE user_id = 1")).quantity, 2);
  assert.equal((await service.history(1)).trades[0].result.given[0].quantity, 2);
  await assert.rejects(service.complete(1, saved.id, terms), { status: 409 });
});

test('mixed card and sealed trades allocate proceeds by total given market value', async t => {
  const { db, service, settings, body, listing, wanted } = await sealedFixture(t);
  const saved = await service.submit(settings.token, { ...body, requested: [{ entry_id: 10, quantity: 1 }, { entry_id: listing.entry_id, quantity: 2 }],
    offered: [{ entry_id: wanted.entry_id, quantity: 1 }] });
  const done = await service.complete(1, saved.id, { given: [10, { entry_id: listing.entry_id, quantity: 2 }],
    received: [{ index: 0, quantity: 1, unit_cents: 26000 }], completed_on: '2026-03-01' });
  assert.deepEqual(done.given.map(line => line.proceeds_cents), [2000, 24000]);
  assert.deepEqual((await db.all('SELECT kind FROM sales_entry ORDER BY id')).map(row => row.kind), ['card', 'sealed']);
  assert.equal((await db.get('SELECT remaining_quantity FROM sealed_lot WHERE id = 1')).remaining_quantity, 2);
});

test('missing sealed prices remain unknown and fallback allocation weights physical quantities', async t => {
  const { db, service, settings, body, listing } = await sealedFixture(t);
  await db.run('UPDATE sealed_product SET market_price_cents = NULL WHERE id = 1');
  assert.equal((await service.listing(settings.token)).available.find(item => item.kind === 'sealed').unit_cents, null);
  const saved = await service.submit(settings.token, { ...body, requested: [{ entry_id: 10, quantity: 1 }, { entry_id: listing.entry_id, quantity: 2 }],
    offered: [], cash_cents: 3000 });
  const preview = await service.previewCompletion(1, saved.id, { given: [10, { entry_id: listing.entry_id, quantity: 2 }],
    received: [], cash_in_cents: 3000, completed_on: '2026-03-01' });
  assert.deepEqual(preview.given.map(line => line.proceeds_cents), [1000, 2000]);
  assert.equal(preview.given_cents, null);
  await db.run('UPDATE sealed_product SET market_price_cents = 0 WHERE id = 1');
  assert.equal((await service.listing(settings.token)).available.find(item => item.kind === 'sealed').unit_cents, 0, 'explicit zero is not a missing quote');
});

test('sealed trade failure rolls back card sales, sealed stock and execution together', async t => {
  const { db, service, settings, body, listing } = await sealedFixture(t);
  const saved = await service.submit(settings.token, { ...body, requested: [{ entry_id: 10, quantity: 1 }, { entry_id: listing.entry_id, quantity: 1 }],
    offered: [], cash_cents: 14000 });
  await require('../src/utils/salesApplication').saleSteps.prepare(db);
  await db.exec(`CREATE TRIGGER reject_trade_receipt BEFORE INSERT ON sales_entry WHEN NEW.kind = 'sealed'
    BEGIN SELECT RAISE(ABORT, 'fixture sealed write failure'); END;`);
  await assert.rejects(service.complete(1, saved.id, { given: [10, listing.entry_id], received: [],
    cash_in_cents: 14000, completed_on: '2026-03-01' }), /fixture sealed write failure/);
  assert.equal((await db.get('SELECT list_type FROM collection WHERE id = 10')).list_type, 'collection');
  assert.equal((await db.get('SELECT remaining_quantity FROM sealed_lot WHERE id = 1')).remaining_quantity, 4);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM trade_execution')).n, 0);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM card_sale_record')).n, 0);
});

test('foreign-currency sealed trades record native sales and USD accounting, failing explicitly without FX', async t => {
  const { db, service, settings, body, listing, failFx } = await sealedFixture(t);
  await db.run("UPDATE sealed_lot SET currency = 'EUR', total_cost_cents = 20000, remaining_cost_cents = 20000 WHERE id = 1");
  const saved = await service.submit(settings.token, { ...body, requested: [{ entry_id: listing.entry_id, quantity: 1 }],
    offered: [], cash_cents: 12000 });
  const terms = { given: [listing.entry_id], received: [], cash_in_cents: 12000, completed_on: '2026-03-01' };
  // The deterministic fixture deliberately doubles conversions in either direction.
  const done = await service.complete(1, saved.id, terms);
  assert.equal(done.given[0].basis_cents, 10000);
  assert.equal(done.realized_gain_cents, 2000);
  const sale = await db.get('SELECT currency, proceeds_cents, sold_basis_cents FROM sealed_sale_record');
  assert.deepEqual(sale, { currency: 'EUR', proceeds_cents: 24000, sold_basis_cents: 5000 });
  const next = await service.submit(settings.token, { ...body, request_key: 'request-key-sealed-fx', requested: [{ entry_id: listing.entry_id, quantity: 1 }],
    offered: [], cash_cents: 12000 });
  failFx();
  await assert.rejects(service.complete(1, next.id, terms), { code: 'VALUATION_FX_UNAVAILABLE' });
  assert.equal((await db.get('SELECT remaining_quantity FROM sealed_lot WHERE id = 1')).remaining_quantity, 3);
});
