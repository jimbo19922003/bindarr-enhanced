const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');
const { spawn } = require('child_process');

// Custom sets end to end: rule matching (name/illustrator/set/rarity, language),
// manual include/exclude, per-card vs per-printing completion, ownership, and
// that another user can neither see nor change someone else's set.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bindarr-customsets-'));
const tmpDb = path.join(tmpDir, 'bindarr.db');
const projectRoot = path.join(__dirname, '../../../');
const port = '3037';
const base = `http://localhost:${port}`;

const CARDS = [
  // id, name, set_id, number, rarity, language, illustrator, printings
  ['cs-pika-1', 'Pikachu', 'cs1', '025', 'Common', 'English', 'Mitsuhiro Arita', '["Normal","Reverse Holofoil"]'],
  ['cs-pika-2', 'Pikachu ex', 'cs2', '063', 'Double Rare', 'English', 'PLANETA', '["Holofoil"]'],
  ['cs-pika-jp', 'ピカチュウ', 'cs1-jp', '25', 'Common', 'Japanese', 'Mitsuhiro Arita', null],
  ['cs-raichu', 'Raichu', 'cs1', '026', 'Rare', 'English', 'Mitsuhiro Arita', '["Holofoil"]'],
  ['cs-bulba', 'Bulbasaur', 'cs1', '001', 'Common', 'English', 'Ken Sugimori', null],
];

async function waitForServer(url) {
  for (let i = 0; i < 150; i++) {
    try { const res = await fetch(url); if (res.ok) return; } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start in time');
}

function insertCards() {
  const sqlite3 = require(path.join(projectRoot, 'backend/node_modules/sqlite3'));
  return new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(tmpDb);
    conn.serialize(() => {
      const stmt = conn.prepare(`INSERT OR REPLACE INTO card_cache
        (id, name, printed_name, game, set_id, set_name, number, rarity, language, illustrator, available_printings, price_trend)
        VALUES (?, ?, ?, 'pokemon', ?, ?, ?, ?, ?, ?, ?, 1)`);
      for (const [id, name, setId, number, rarity, language, illustrator, printings] of CARDS) {
        stmt.run(id, name, name, setId, setId.toUpperCase(), number, rarity, language, illustrator, printings);
      }
      stmt.finalize(err => conn.close(() => (err ? reject(err) : resolve())));
    });
  });
}

async function runTests() {
  const server = spawn('node', [path.join(projectRoot, 'backend/src/server.js')], {
    env: { ...process.env, PORT: port, DB_PATH: tmpDb, HTTPS_PORT: '', ALLOW_REGISTRATION: 'true' },
  });
  const json = { 'Content-Type': 'application/json' };

  try {
    await waitForServer(`${base}/api/health`);
    await insertCards();

    const login = async (username, password) => {
      const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ username, password }) });
      assert.strictEqual(r.status, 200, `login ${username}`);
      return { ...json, Authorization: `Bearer ${(await r.json()).token}` };
    };
    const admin = await login('admin', process.env.DEFAULT_ADMIN_PASSWORD || 'test-admin-password');
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: json, body: JSON.stringify({ username: 'setmember', password: 'password123' }),
    });
    assert.strictEqual(reg.status, 201, 'member registers');
    const member = await login('setmember', 'password123');
    const call = async (headers, method, url, body) => {
      const r = await fetch(`${base}/api${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const ids = list => list.map(c => c.id).sort();

    // F9-TC1: validation refuses an unnamed set, a bad game and malformed rules
    assert.strictEqual((await call(admin, 'POST', '/custom-sets', { name: '', game: 'pokemon' })).status, 400);
    assert.strictEqual((await call(admin, 'POST', '/custom-sets', { name: 'x', game: 'chess' })).status, 400);
    assert.strictEqual((await call(admin, 'POST', '/custom-sets', { name: 'x', game: 'pokemon', rules: { names: 'Pikachu' } })).status, 400);
    console.log('PASS: F9-TC1');

    // F9-TC2: a name rule matches every card containing the name, in the chosen language only
    const created = await call(admin, 'POST', '/custom-sets', { name: 'Pikachu master', game: 'pokemon', rules: { names: ['pikachu'] } });
    assert.strictEqual(created.status, 201);
    const setId = created.body.id;
    let view = await call(admin, 'GET', `/custom-sets/${setId}/cards?lang=en`);
    assert.strictEqual(view.status, 200);
    assert.deepStrictEqual(ids(view.body.cards), ['cs-pika-1', 'cs-pika-2']);
    view = await call(admin, 'GET', `/custom-sets/${setId}/cards?lang=ja`);
    assert.deepStrictEqual(ids(view.body.cards), [], 'Japanese name does not contain the Latin term');
    console.log('PASS: F9-TC2');

    // F9-TC3: illustrator + set + rarity rules combine with AND
    const arita = await call(admin, 'POST', '/custom-sets', {
      name: 'Arita', game: 'pokemon', rules: { illustrators: ['arita'], set_ids: ['cs1'], rarities: ['rare'] },
    });
    view = await call(admin, 'GET', `/custom-sets/${arita.body.id}/cards?lang=en`);
    assert.deepStrictEqual(ids(view.body.cards), ['cs-raichu']);
    console.log('PASS: F9-TC3');

    // F9-TC4: manual include adds a card the rules miss (any language); exclude removes a match
    assert.strictEqual((await call(admin, 'PUT', `/custom-sets/${setId}/cards/cs-pika-jp`, { mode: 'include' })).status, 200);
    assert.strictEqual((await call(admin, 'PUT', `/custom-sets/${setId}/cards/cs-pika-2`, { mode: 'exclude' })).status, 200);
    assert.strictEqual((await call(admin, 'PUT', `/custom-sets/${setId}/cards/missing-card`, { mode: 'include' })).status, 404);
    view = await call(admin, 'GET', `/custom-sets/${setId}/cards?lang=en`);
    assert.deepStrictEqual(ids(view.body.cards), ['cs-pika-1', 'cs-pika-jp']);
    assert.deepStrictEqual(view.body.excluded.map(c => c.id), ['cs-pika-2']);
    assert.strictEqual((await call(admin, 'DELETE', `/custom-sets/${setId}/cards/cs-pika-2`)).status, 200);
    view = await call(admin, 'GET', `/custom-sets/${setId}/cards?lang=en`);
    assert.deepStrictEqual(ids(view.body.cards), ['cs-pika-1', 'cs-pika-2', 'cs-pika-jp']);
    console.log('PASS: F9-TC4');

    // F9-TC5: owning a copy marks the card owned; printing mode splits slots per printing
    const add = await call(admin, 'POST', '/collection', { card_id: 'cs-pika-1', quantity: 2, printing: 'Reverse Holofoil', condition: 'Near Mint' });
    assert.ok([200, 201].includes(add.status), `add to collection, got ${add.status}`);
    view = await call(admin, 'GET', `/custom-sets/${setId}/cards?lang=en`);
    const pika = view.body.cards.find(c => c.id === 'cs-pika-1');
    assert.strictEqual(pika.owned, 1);
    assert.strictEqual(pika.owned_qty, 2);
    assert.strictEqual(pika.slot_printing, null);
    assert.ok('price_normal' in pika && 'price_reverse_holofoil' in pika, 'tiles carry printing prices for the add drawer');
    assert.strictEqual((await call(admin, 'PUT', `/custom-sets/${setId}`, { completion_mode: 'printing' })).status, 200);
    view = await call(admin, 'GET', `/custom-sets/${setId}/cards?lang=en`);
    const slots = view.body.cards.filter(c => c.id === 'cs-pika-1').map(c => [c.slot_printing, c.owned]);
    assert.deepStrictEqual(slots, [['Normal', 0], ['Reverse Holofoil', 1]]);
    assert.deepStrictEqual(view.body.cards.filter(c => c.id === 'cs-pika-jp').map(c => c.slot_printing), ['Normal'], 'unknown printings fall back to Normal');
    console.log('PASS: F9-TC5');

    // F9-TC6: another user cannot see, read, edit or delete the set
    const list = await call(member, 'GET', '/custom-sets');
    assert.deepStrictEqual(list.body, []);
    assert.strictEqual((await call(member, 'GET', `/custom-sets/${setId}/cards`)).status, 404);
    assert.strictEqual((await call(member, 'PUT', `/custom-sets/${setId}`, { name: 'mine' })).status, 404);
    assert.strictEqual((await call(member, 'PUT', `/custom-sets/${setId}/cards/cs-bulba`, { mode: 'include' })).status, 404);
    assert.strictEqual((await call(member, 'DELETE', `/custom-sets/${setId}`)).status, 404);
    assert.strictEqual((await call(admin, 'GET', '/custom-sets')).body.length, 2);
    console.log('PASS: F9-TC6');

    // F9-TC8: wishlisting missing cards flags them without counting them as owned
    assert.strictEqual((await call(admin, 'POST', '/collection', { card_id: 'cs-bulba', list_type: 'shelf', purchase_price: null })).status, 400);
    const wish = await call(admin, 'POST', '/collection/bulk-add', {
      card_ids: ['cs-pika-1', 'cs-bulba'], list_type: 'wishlist', printing: 'Normal', language: 'English', purchase_price: null,
    });
    assert.strictEqual(wish.status, 200, JSON.stringify(wish.body));
    assert.strictEqual(wish.body.added, 2);
    assert.match(wish.body.message, /to wishlist/);
    view = await call(admin, 'GET', `/custom-sets/${setId}/cards?lang=en`);
    const pikaSlots = view.body.cards.filter(c => c.id === 'cs-pika-1').map(c => [c.slot_printing, c.owned, c.wishlisted]);
    assert.deepStrictEqual(pikaSlots, [['Normal', 0, 1], ['Reverse Holofoil', 1, 0]]);
    const standard = await call(admin, 'GET', '/collection/sets/cs1/cards?game=pokemon&lang=en');
    const bulba = standard.body.find(c => c.id === 'cs-bulba');
    assert.deepStrictEqual([bulba.owned, bulba.wishlisted], [0, 1]);
    assert.deepStrictEqual([standard.body.find(c => c.id === 'cs-raichu').wishlisted], [0]);
    console.log('PASS: F9-TC8');

    // F9-TC9: admins hide optional tabs for everyone; unknown tabs and non-admins are refused
    assert.strictEqual((await call(admin, 'PUT', '/settings', { hidden_tabs: ['collection'] })).status, 400);
    assert.strictEqual((await call(admin, 'PUT', '/settings', { hidden_tabs: 'notes' })).status, 400);
    assert.strictEqual((await call(member, 'PUT', '/settings', { hidden_tabs: ['notes'] })).status, 403);
    const hide = await call(admin, 'PUT', '/settings', { hidden_tabs: ['notes', 'storage', 'deckbuilder'] });
    assert.strictEqual(hide.status, 200, JSON.stringify(hide.body));
    assert.deepStrictEqual((await call(member, 'GET', '/settings')).body.hidden_tabs, ['storage', 'deckbuilder', 'notes']);
    assert.deepStrictEqual((await call(admin, 'PUT', '/settings', { hidden_tabs: [] })).body.hidden_tabs, []);
    console.log('PASS: F9-TC9');

    // F9-TC7: suggestions list cached illustrators; delete removes the set and its overrides
    const suggestions = await call(admin, 'GET', '/custom-sets-suggestions?game=pokemon&field=illustrator&q=ari');
    assert.deepStrictEqual(suggestions.body.map(s => s.value), ['Mitsuhiro Arita']);
    assert.strictEqual((await call(admin, 'DELETE', `/custom-sets/${setId}`)).status, 200);
    assert.strictEqual((await call(admin, 'GET', `/custom-sets/${setId}/cards`)).status, 404);
    console.log('PASS: F9-TC7');
  } finally {
    server.kill('SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 300));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* still locked */ }
  }
}

runTests()
  .then(() => setTimeout(() => process.exit(0), 500))
  .catch(err => { console.error('FAIL: customsets.test.js -', err.message); setTimeout(() => process.exit(1), 500); });
