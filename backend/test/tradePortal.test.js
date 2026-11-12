'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { openConnection } = require('../src/utils/salesRepository');
const { schema, createTradePortal, webhookUrl } = require('../src/utils/tradePortal');
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
      price_reverse_holofoil REAL, price_1st_edition REAL, price_currency TEXT, price_source TEXT);
    INSERT INTO card_cache VALUES ('a','Trade Pikachu','Pikachu','Set A','1','','pokemon',10,10,20,NULL,NULL,'USD','fixture'),
      ('b','Wanted Raichu','Raichu','Set B','2','','pokemon',8,8,NULL,NULL,NULL,'EUR','fixture'),
      ('c','Unknown card','Unknown','Set C','3','','pokemon',0,NULL,NULL,NULL,NULL,'USD','fixture');
    CREATE TABLE collection(id INTEGER PRIMARY KEY, user_id INTEGER, card_id TEXT, quantity INTEGER,
      condition TEXT, printing TEXT, language TEXT, grader TEXT, grade REAL, market_value REAL,
      list_type TEXT, is_trade INTEGER, purchase_price REAL, notes TEXT);
    INSERT INTO collection VALUES
      (10,1,'a',2,'Near Mint','Holofoil','English','Raw',NULL,NULL,'collection',1,99,'private note'),
      (11,1,'a',1,'Near Mint','Normal','English','Raw',NULL,NULL,'collection',0,99,'not for trade'),
      (12,1,'a',1,'Near Mint','Normal','English','Raw',NULL,NULL,'sold',1,99,'sold'),
      (20,1,'b',3,'Near Mint','Normal','English','Raw',NULL,NULL,'wishlist',0,NULL,'private wanted note'),
      (21,1,'c',1,'Near Mint','Normal','English','Raw',NULL,NULL,'wishlist',0,NULL,'unknown'),
      (30,2,'a',1,'Near Mint','Normal','English','Raw',NULL,NULL,'collection',1,5,'other user');`);
  for (let pass = 0; pass < 2; pass++) for (const sql of schema) await db.run(sql);
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
    offered: {known_cents: 1600, unknown_quantity: 0}, difference_cents: -400, difference_percent: -20,
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
