'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { openConnection } = require('../../src/utils/salesRepository');

test('real server: isolated trade sharing, anonymous proposals, scoped inbox and restart persistence', { timeout: 45000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bindarr-trade-e2e-'));
  const dbPath = path.join(dir, 'bindarr.db');
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let server, connection, logs = '';
  async function stop() {
    if (!server || server.exitCode != null || server.signalCode != null) return;
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  t.after(async () => {
    await stop();
    if (connection) await connection.close();
    await fs.rm(dir, {recursive: true, force: true});
  });
  async function start() {
    logs = '';
    server = spawn(process.execPath, [path.join(__dirname, '../../src/server.js')], {
      env: { ...process.env, DB_PATH: dbPath, PORT: String(port), HTTPS_PORT: '', ALLOW_REGISTRATION: 'true',
        DEFAULT_ADMIN_PASSWORD: 'trade-test-password', BACKUP_INTERVAL_HOURS: '0', BINDARR_DISABLE_TCGCSV_SYNC: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', data => { logs = (logs + data).slice(-6000); });
    server.stderr.on('data', data => { logs = (logs + data).slice(-6000); });
    for (let attempt = 0; attempt < 150; attempt++) {
      if (server.exitCode != null) throw new Error(`Server exited during startup: ${logs}`);
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* Wait for the child listener. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server not ready: ${logs}`);
  }
  async function call(url, method = 'GET', body, token) {
    const response = await fetch(`${base}${url}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {}) },
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    return { status: response.status, body: await response.json() };
  }
  const login = async username => {
    const result = await call('/api/auth/login', 'POST', {username, password: 'trade-test-password'});
    assert.equal(result.status, 200);
    return result.body.token;
  };
  await start();
  const auth = await login('admin');
  connection = await openConnection(dbPath);
  const owner = await connection.get('SELECT id, share_token FROM users WHERE username = ?', ['admin']);
  await connection.run("INSERT INTO card_cache(id,name,set_name,number,price_trend,price_currency) VALUES ('trade-fixture','Trade card','Fixture','1',10,'USD'), ('want-fixture','Wanted card','Fixture','2',5,'USD')");
  await connection.run("INSERT INTO collection(user_id,card_id,quantity,is_trade,list_type) VALUES (?,'trade-fixture',2,1,'collection'), (?,'want-fixture',2,0,'wishlist'), (?,'want-fixture',7,0,'collection')", [owner.id, owner.id, owner.id]);
  const entries = await connection.all('SELECT id, quantity, list_type FROM collection WHERE user_id = ? ORDER BY id', [owner.id]);
  const configured = await call('/api/trade/settings', 'PUT', { enabled: true, currency: 'USD' }, auth);
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  assert.ok(!('discord_webhook' in configured.body));
  const token = configured.body.token;
  const listed = await call(`/api/trade-public/${token}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.available.length, 1);
  assert.equal(listed.body.wanted.length, 1);
  assert.equal((await call(`/api/shared/${token}`)).status, 404, 'trade token cannot unlock collection API');
  assert.equal((await call(`/api/trade-public/${owner.share_token}`)).status, 404);
  await connection.run('UPDATE users SET share_enabled=1 WHERE id=?', [owner.id]);
  assert.equal((await call(`/api/shared/${owner.share_token}`)).status, 200, 'existing sharing still works independently');
  await call('/api/trade/settings', 'PUT', { enabled: false, currency: 'USD' }, auth);
  assert.equal((await call(`/api/trade-public/${token}`)).status, 404);
  assert.equal((await call(`/api/shared/${owner.share_token}`)).status, 200, 'disabling trade sharing does not disable collection sharing');
  await call('/api/trade/settings', 'PUT', { enabled: true, currency: 'USD' }, auth);
  await connection.run('UPDATE users SET share_enabled=0 WHERE id=?', [owner.id]);
  assert.equal((await call(`/api/trade-public/${token}`)).status, 200, 'trade sharing works without collection sharing');
  assert.equal((await call('/api/trade/requests')).status, 401);
  const proposal = {
    requested: [{entry_id: entries[0].id, quantity: 1}],
    offered: [{entry_id: entries[1].id, quantity: 2}],
    discord_contact: 'fixture.visitor', message: 'A test proposal', request_key: 'e2e-request-key-123456',
  };
  const saved = await call(`/api/trade-public/${token}/requests`, 'POST', proposal);
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const inbox = await call('/api/trade/requests', 'GET', undefined, auth);
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.requests[0].proposal.summary.difference_percent, 0);
  assert.equal(inbox.body.requests[0].notification, 'not_configured');
  assert.deepEqual(await connection.all('SELECT id, quantity, list_type FROM collection WHERE user_id = ? ORDER BY id', [owner.id]), entries);
  const registered = await call('/api/auth/register', 'POST', {username: 'tradereviewer', password: 'trade-test-password'});
  assert.equal(registered.status, 201);
  const other = await login('tradereviewer');
  assert.deepEqual((await call('/api/trade/requests', 'GET', undefined, other)).body.requests, []);
  assert.equal((await call(`/api/trade/requests/${saved.body.id}`, 'DELETE', undefined, other)).status, 404);

  assert.equal((await call('/api/trade/requests/counts', 'GET', undefined, auth)).body.new, 1);
  const updated = await call(`/api/trade/requests/${saved.body.id}`, 'PATCH', {status: 'active', owner_note: 'Meeting Friday'}, auth);
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.status, 'active');
  assert.equal((await call(`/api/trade/requests/${saved.body.id}`, 'PATCH', {status: 'active'}, other)).status, 404);
  assert.deepEqual((await call('/api/trade/requests?status=active', 'GET', undefined, auth)).body.requests.map(row => row.id), [saved.body.id]);
  const created = await call('/api/trade/binders', 'POST', {name: 'Friday meetup'}, auth);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await call('/api/trade/binder-items', 'PUT', {entry_ids: [entries[0].id], add_to: [created.body.id]}, other)).status, 404);
  assert.equal((await call('/api/trade/binder-items', 'PUT', {entry_ids: [entries[0].id], add_to: [created.body.id]}, auth)).status, 200);
  const binderListing = await call(`/api/trade-public/${created.body.token}`);
  assert.equal(binderListing.status, 200);
  assert.equal(binderListing.body.available.length, 1);
  assert.equal(binderListing.body.wanted.length, 0);
  assert.deepEqual((await call('/api/trade/items', 'GET', undefined, auth)).body.available[0].binder_ids, [created.body.id]);
  assert.equal((await call(`/api/trade/binders/${created.body.id}`, 'PUT', {enabled: false}, auth)).status, 200);
  assert.equal((await call(`/api/trade-public/${created.body.token}`)).status, 404);

  await stop();
  await connection.close(); connection = null;
  await start();
  assert.equal((await call(`/api/trade-public/${token}`)).status, 200);
  assert.equal((await call('/api/trade/requests', 'GET', undefined, auth)).body.requests[0].id, saved.body.id);
  const replay = await call(`/api/trade-public/${token}/requests`, 'POST', proposal);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.id, saved.body.id);
  const rotated = await call('/api/trade/rotate', 'POST', {}, auth);
  assert.equal(rotated.status, 200);
  assert.equal((await call(`/api/trade-public/${token}`)).status, 404);
  assert.equal((await call(`/api/trade-public/${rotated.body.token}`)).status, 200);

  const box = await call('/api/sealed/products', 'POST', { name: 'Trade box', product_type: 'booster_box',
    language: 'English', market_price: '120.00', market_currency: 'USD',
    lot: { quantity: 2, total_cost: '140.00', currency: 'USD' } }, auth);
  assert.equal(box.status, 201, JSON.stringify(box.body));
  const want = await call('/api/sealed/products', 'POST', { name: 'Wanted ETB', product_type: 'etb',
    language: 'English', market_price: '50.00', market_currency: 'USD' }, auth);
  assert.equal(want.status, 201, JSON.stringify(want.body));
  const listedBox = await call('/api/sealed/trade-listings', 'PUT', {
    product_id: box.body.product.id, lot_id: box.body.product.lots[0].id, listed: true,
  }, auth);
  assert.equal(listedBox.status, 200, JSON.stringify(listedBox.body));
  assert.equal((await call('/api/sealed/trade-listings', 'PUT', {
    product_id: box.body.product.id, lot_id: box.body.product.lots[0].id, listed: true,
  }, other)).status, 404, 'sealed trade listing cannot use another owner inventory');
  assert.equal((await call('/api/sealed/trade-listings', 'PUT', {
    product_id: want.body.product.id, quantity: 1, listed: true,
  }, auth)).status, 200);
  const sealedItems = await call('/api/sealed/trade-listings', 'GET', undefined, auth);
  assert.equal(sealedItems.status, 200);
  assert.equal(sealedItems.body.listings.length, 2);
  const mixed = await call(`/api/trade-public/${rotated.body.token}`);
  const givenSealed = mixed.body.available.find(item => item.kind === 'sealed');
  const receivedSealed = mixed.body.wanted.find(item => item.kind === 'sealed');
  assert.equal(givenSealed.quantity, 2);
  const sealedProposal = await call(`/api/trade-public/${rotated.body.token}/requests`, 'POST', {
    ...proposal, request_key: 'e2e-sealed-trade-12345',
    requested: [{ entry_id: givenSealed.entry_id, quantity: 1 }],
    offered: [{ entry_id: receivedSealed.entry_id, quantity: 1 }], cash_cents: 2000,
  });
  assert.equal(sealedProposal.status, 201, JSON.stringify(sealedProposal.body));
  const completeBody = { given: [{ entry_id: givenSealed.entry_id, quantity: 1 }],
    received: [{ index: 0, quantity: 1, unit_cents: 5000 }], cash_in_cents: 2000, completed_on: '2026-03-01' };
  const completionUrl = `/api/trade/requests/${sealedProposal.body.id}/complete`;
  const preview = await call(completionUrl, 'POST', { ...completeBody, preview: true }, auth);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.given[0].basis_cents, 7000);
  assert.equal((await call(`/api/sealed/products/${box.body.product.id}`, 'GET', undefined, auth)).body.product.remaining_quantity, 2);
  const completed = await call(completionUrl, 'POST', completeBody, auth);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.realized_gain_cents, 0);
  assert.equal((await call(`/api/sealed/products/${box.body.product.id}`, 'GET', undefined, auth)).body.product.remaining_quantity, 1);
  assert.equal((await call(`/api/sealed/products/${want.body.product.id}`, 'GET', undefined, auth)).body.product.remaining_quantity, 1);
  assert.equal((await call('/api/sealed/trade-listings', 'GET', undefined, auth)).body.listings.filter(item => item.list_type === 'wishlist').length, 0);
  assert.equal((await call(completionUrl, 'POST', completeBody, auth)).status, 409);
});
