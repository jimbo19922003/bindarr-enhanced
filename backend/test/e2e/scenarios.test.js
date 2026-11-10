const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { spawn } = require('child_process');

// Isolated temp DB and unique port
const tmpDb = path.join(os.tmpdir(), `bindarr-scenarios-test-${process.pid}.db`);
process.env.DB_PATH = tmpDb;
const port = '3012';

const projectRoot = path.join(__dirname, '../../../');
const db = require('../../src/db');

async function waitForServer(port) {
  const url = `http://localhost:${port}/api/health`;
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (e) {
      // retry
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server on port ${port} did not start in time`);
}

async function waitForDatabase() {
  for (let i = 0; i < 150; i++) {
    try {
      const admin = await db.get(`SELECT id FROM users WHERE username = ?`, ['admin']);
      if (admin) return admin.id;
    } catch (e) {
      // retry
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Database did not initialize in time');
}

async function runTests() {
  // Start server preloading scryfall-mock.js
  const mockScript = path.join(__dirname, 'scryfall-mock.js');
  const serverScript = path.join(projectRoot, 'backend/src/server.js');
  const server = spawn('node', ['-r', mockScript, serverScript], {
    env: {
      ...process.env,
      PORT: port,
      DB_PATH: tmpDb,
      // F6-TC5 exercises the self-registration flow, which is invite-only unless
      // explicitly enabled.
      ALLOW_REGISTRATION: 'true'
    }
  });

  try {
    await waitForServer(port);
    const adminId = await waitForDatabase();

    // Insert a valid session token for authentication
    const token = 'test-token-123';
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 1);
    await db.run(
      `INSERT OR REPLACE INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
      [token, adminId, expiresAt.toISOString()]
    );

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    // F6-TC2: Mixed-game collection sorting (Pokémon energy type, then MTG card type)
    try {
      const { sortCards } = require('../../src/utils/compartmentSort');
      const cards = [
        { name: 'Swamp', types: [], subtypes: ['Basic', 'Land', 'Swamp'], game: 'mtg' },
        { name: 'Charmander', types: ['Fire'], game: 'pokemon' },
        { name: 'Serra Angel', types: ['White'], subtypes: ['Creature', 'Angel'], game: 'mtg' },
        { name: 'Bulbasaur', types: ['Grass'], game: 'pokemon' }
      ];
      const sorted = sortCards(cards, 'type-name', 'normals_first');
      // Bulbasaur (Grass) -> Charmander (Fire) -> Serra Angel (Creature) -> Swamp (Land)
      assert.strictEqual(sorted[0].name, 'Bulbasaur');
      assert.strictEqual(sorted[1].name, 'Charmander');
      assert.strictEqual(sorted[2].name, 'Serra Angel');
      assert.strictEqual(sorted[3].name, 'Swamp');
      console.log('PASS: F6-TC2');
    } catch (err) {
      console.error('FAIL: F6-TC2 -', err.message);
      throw err;
    }

    // F6-TC3: Scryfall proxy search & add to binder with price history writing
    try {
      const searchRes = await fetch(`http://localhost:${port}/api/search?game=mtg&name=Lotus`, { headers: authHeaders });
      const cards = await searchRes.json();
      assert.ok(cards.length > 0, 'Should return Lotus card');
      assert.strictEqual(cards[0].name, 'Black Lotus');

      // Add to collection
      const addRes = await fetch(`http://localhost:${port}/api/collection`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          card_id: cards[0].id,
          quantity: 1,
          condition: 'Near Mint',
          printing: 'Normal',
          language: 'English',
          purchase_price: 10000.0,
          location_id: null
        })
      });
      assert.strictEqual(addRes.status, 200);

      // Verify price history row exists for this card
      const priceHist = await db.all(`SELECT * FROM price_history WHERE card_id = ?`, [cards[0].id]);
      assert.ok(priceHist.length > 0, 'Price history record must be written');
      console.log('PASS: F6-TC3');
    } catch (err) {
      console.error('FAIL: F6-TC3 -', err.message);
      throw err;
    }

    // Scan requests must never insert a second copy, even after a lost response,
    // concurrent retries, deletion, or a failure after the insert.
    {
      const identityResponse = await fetch(`http://localhost:${port}/api/scan-queue/identity`, { headers: authHeaders });
      assert.strictEqual(identityResponse.status, 200);
      const identity = await identityResponse.json();
      assert.strictEqual(identity.user_id, adminId);
      const card = await db.get(`SELECT card_id FROM collection WHERE user_id = ? LIMIT 1`, [adminId]);
      const body = { card_id: card.card_id, game: 'mtg', quantity: 1, purchase_price: null };
      const request = (key, payload = body, instance = identity.instance_id, headers = authHeaders) =>
        fetch(`http://localhost:${port}/api/scan-queue/add`, {
          method: 'POST',
          headers: { ...headers, 'Idempotency-Key': key, 'X-Scan-Instance': instance },
          body: JSON.stringify(payload)
        });
      const key = 'scan-retry-test-001';
      const responses = await Promise.all(Array.from({ length: 5 }, () => request(key)));
      assert.ok(responses.every(response => response.status === 200));
      const results = await Promise.all(responses.map(response => response.json()));
      assert.ok(results.every(result => result.id === results[0].id));
      assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ? AND scan_request_key = ?', [adminId, key])).n, 1);
      assert.strictEqual((await request(key, { ...body, condition: 'Damaged' })).status, 409);
      assert.strictEqual((await request('scan-wrong-server-001', body, 'wrong-instance')).status, 409);
      assert.strictEqual((await request('scan-many-copies-001', { ...body, quantity: 2 })).status, 400);
      assert.strictEqual((await fetch(`http://localhost:${port}/api/scan-queue/add`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify(body)
      })).status, 400);
      await db.run('DELETE FROM collection WHERE id = ?', [results[0].id]);
      assert.strictEqual((await (await request(key)).json()).id, results[0].id);
      assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ? AND scan_request_key = ?', [adminId, key])).n, 0);

      const other = await db.run("INSERT INTO users (username, password_hash, role, share_token) VALUES ('scan-other', 'unused', 'member', 'scan-other-token')");
      const otherToken = 'scan-other-session';
      await db.run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))", [otherToken, other.lastID]);
      const otherHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${otherToken}` };
      const otherResult = await request(key, body, identity.instance_id, otherHeaders);
      assert.strictEqual(otherResult.status, 200);
      assert.notStrictEqual((await otherResult.json()).id, results[0].id);

      await db.run('DELETE FROM price_history WHERE card_id = ?', [card.card_id]);
      await db.run(`CREATE TRIGGER scan_test_price_failure BEFORE INSERT ON price_history BEGIN SELECT RAISE(ABORT, 'test price failure'); END`);
      const partialKey = 'scan-partial-test-001';
      const partial = await (await request(partialKey)).json();
      assert.strictEqual(partial.needs_attention, true);
      await db.run('DROP TRIGGER scan_test_price_failure');
      const recovered = await (await request(partialKey)).json();
      assert.deepStrictEqual(recovered, partial);
      assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ? AND scan_request_key = ?', [adminId, partialKey])).n, 1);
      await db.run('UPDATE collection SET quantity = 2 WHERE id = ?', [partial.id]);
      await db.splitStackedRows();
      assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ? AND scan_request_key = ?', [adminId, partialKey])).n, 1);
      assert.strictEqual((await (await request(partialKey)).json()).id, partial.id);
      console.log('PASS: F6-TC7');
    }

    // F6-TC4: set/number code -> API Search -> Add -> Compartment recommendation
    try {
      const scanText = 'ELD/171';
      // Parse a set code + collector number
      const match = scanText.match(/^([A-Z0-9]{3,5})[\s\/]+([0-9a-zA-Z★]+)$/);
      assert.ok(match);
      const set = match[1];
      const num = match[2];

      const searchRes = await fetch(`http://localhost:${port}/api/search?game=mtg&set=${set}&number=${num}`, { headers: authHeaders });
      const matches = await searchRes.json();
      assert.ok(matches.length > 0);
      assert.strictEqual(matches[0].name, 'Questing Beast');
      console.log('PASS: F6-TC4');
    } catch (err) {
      console.error('FAIL: F6-TC4 -', err.message);
      throw err;
    }

    // F6-TC5: Complete user session flow: register -> login -> create binder -> scan multiple -> add -> verify stats
    try {
      const uniqueUsername = `tester_${Date.now()}`;
      // 1. Register User
      const regRes = await fetch(`http://localhost:${port}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uniqueUsername, password: 'password123' })
      });
      assert.strictEqual(regRes.status, 201);

      // 2. Login User
      const loginRes = await fetch(`http://localhost:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uniqueUsername, password: 'password123' })
      });
      assert.strictEqual(loginRes.status, 200);
      const { token: userToken } = await loginRes.json();
      assert.ok(userToken);

      const userHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      };

      // 3. Create location
      const locRes = await fetch(`http://localhost:${port}/api/locations`, {
        method: 'POST',
        headers: userHeaders,
        body: JSON.stringify({ name: 'E2E User Binder', type: 'Binder' })
      });
      assert.strictEqual(locRes.status, 200);
      const loc = await locRes.json();
      const locId = loc.id;

      // 4. Add cards to binder
      const addRes1 = await fetch(`http://localhost:${port}/api/collection`, {
        method: 'POST',
        headers: userHeaders,
        body: JSON.stringify({
          // Cards fetched from Scryfall are cached under the "mtg-" id prefix
          // (see F3-TC2/F5-TC3); F6-TC4 above cached this card as mtg-eld-171.
          card_id: 'mtg-eld-171',
          quantity: 1,
          condition: 'Near Mint',
          printing: 'Normal',
          language: 'English',
          purchase_price: 10.0,
          location_id: locId
        })
      });
      assert.strictEqual(addRes1.status, 200);

      // 5. Verify stats/collection list endpoint
      const collectionListRes = await fetch(`http://localhost:${port}/api/collection`, {
        headers: userHeaders
      });
      assert.strictEqual(collectionListRes.status, 200);
      const collectionList = await collectionListRes.json();
      assert.ok(collectionList.length > 0);
      console.log('PASS: F6-TC5');
    } catch (err) {
      console.error('FAIL: F6-TC5 -', err.message);
      throw err;
    }

    // F6-TC6: Manual tap-to-place (Arrange). Box inserts-and-shifts; binder
    // places at an absolute pocket (no cascade) and swaps on an occupied one.
    try {
      const seedCard = (id, name) => db.run(
        `INSERT OR REPLACE INTO card_cache (id, name, supertype, subtypes, types, rarity, set_id, set_name, number, image_url, price_trend)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, 'Pokémon', '[]', '[]', 'Common', 's1', 'Set One', '1', '', 1]
      );
      const addEntry = async (cardId, compId, locId, position) => {
        const r = await db.run(
          `INSERT INTO collection (card_id, quantity, condition, printing, language, location_id, compartment_id, position, user_id)
           VALUES (?, 1, 'Near Mint', 'Normal', 'English', ?, ?, ?, ?)`,
          [cardId, locId, compId, position, adminId]
        );
        return r.lastID;
      };
      const placeReq = (entryId, body) => fetch(`http://localhost:${port}/api/collection/${entryId}/place`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify(body)
      });

      // --- Box: insert between cards, shifting the rest down one ---
      for (const [id, name] of [['pl-b1', 'B1'], ['pl-b2', 'B2'], ['pl-b3', 'B3'], ['pl-b4', 'B4']]) await seedCard(id, name);
      const boxLoc = await db.run(`INSERT INTO locations (name, type, sort_order, foil_sorting, rule_type, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
        ['TC6 Box', 'Box', 'custom', 'normals_first', 'any', adminId]);
      const boxRow = await db.run(`INSERT INTO compartments (location_id, idx, capacity) VALUES (?, ?, ?)`, [boxLoc.lastID, 1, 400]);
      await addEntry('pl-b1', boxRow.lastID, boxLoc.lastID, 1000);
      await addEntry('pl-b2', boxRow.lastID, boxLoc.lastID, 2000);
      await addEntry('pl-b3', boxRow.lastID, boxLoc.lastID, 3000);
      const b4 = await addEntry('pl-b4', null, null, 0); // unsorted

      const boxRes = await placeReq(b4, { compartment_id: boxRow.lastID, slot: 2 });
      assert.strictEqual(boxRes.status, 200, 'box place should succeed');
      const boxRows = await db.all(`SELECT card_id, position FROM collection WHERE compartment_id = ? AND user_id = ? ORDER BY position`, [boxRow.lastID, adminId]);
      assert.deepStrictEqual(boxRows.map(r => r.card_id), ['pl-b1', 'pl-b4', 'pl-b2', 'pl-b3'], 'B4 must insert at slot 2, shifting B2/B3 down');
      assert.deepStrictEqual(boxRows.map(r => r.position), [1000, 2000, 3000, 4000], 'box positions must densify after insert');

      // --- Binder: absolute pocket (gap preserved), then swap ---
      for (const [id, name] of [['pl-p1', 'P1'], ['pl-p2', 'P2']]) await seedCard(id, name);
      const binLoc = await db.run(`INSERT INTO locations (name, type, sort_order, foil_sorting, rule_type, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
        ['TC6 Binder', 'Binder', 'custom', 'normals_first', 'any', adminId]);
      const page = await db.run(`INSERT INTO compartments (location_id, idx, capacity) VALUES (?, ?, ?)`, [binLoc.lastID, 1, 9]);
      const p1 = await addEntry('pl-p1', page.lastID, binLoc.lastID, 1000); // pocket 1
      const p2 = await addEntry('pl-p2', null, null, 0); // unsorted

      // Place P2 at pocket 5 — absolute, no compaction, P1 stays at pocket 1.
      const binRes = await placeReq(p2, { compartment_id: page.lastID, slot: 5 });
      assert.strictEqual(binRes.status, 200, 'binder place should succeed');
      const p1pos = (await db.get(`SELECT position FROM collection WHERE id = ?`, [p1])).position;
      const p2pos = (await db.get(`SELECT position FROM collection WHERE id = ?`, [p2])).position;
      assert.strictEqual(p1pos, 1000, 'binder must NOT compact — P1 keeps pocket 1');
      assert.strictEqual(p2pos, 5000, 'P2 must land at the absolute pocket 5');

      // Swap P2 (pocket 5) with P1 (pocket 1): they exchange, no cascade.
      const swapRes = await placeReq(p2, { compartment_id: page.lastID, swap_with: p1 });
      assert.strictEqual(swapRes.status, 200, 'binder swap should succeed');
      assert.strictEqual((await db.get(`SELECT position FROM collection WHERE id = ?`, [p2])).position, 1000, 'after swap P2 takes pocket 1');
      assert.strictEqual((await db.get(`SELECT position FROM collection WHERE id = ?`, [p1])).position, 5000, 'after swap P1 takes pocket 5');

      // Guard: manual placement is rejected on a non-custom container.
      const schemeLoc = await db.run(`INSERT INTO locations (name, type, sort_order, foil_sorting, rule_type, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
        ['TC6 Scheme', 'Box', 'name-asc', 'normals_first', 'any', adminId]);
      const schemeRow = await db.run(`INSERT INTO compartments (location_id, idx, capacity) VALUES (?, ?, ?)`, [schemeLoc.lastID, 1, 400]);
      const rejRes = await placeReq(b4, { compartment_id: schemeRow.lastID, slot: 1 });
      assert.strictEqual(rejRes.status, 400, 'manual placement must be blocked outside custom order');

      console.log('PASS: F6-TC6');
    } catch (err) {
      console.error('FAIL: F6-TC6 -', err.message);
      throw err;
    }

  } finally {
    try { server.kill('SIGKILL'); } catch {}
    try {
      await new Promise(resolve => {
        db.dbConnection.close(() => resolve());
      });
    } catch {}
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDb + suffix); } catch {}
    }
  }
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    process.exit(1);
  });
