// Set collection browsing uses language-scoped local cache and user-scoped
// collection rows, never a provider's whole-set endpoint.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `bindarr-cacheset-${process.pid}.db`);
process.env.DB_PATH = tmpDb;

const express = require('express');
const db = require('../src/db');
const cardSets = require('../src/cardSets');
const originalCacheSetCards = cardSets.cacheSetCards;
let server;

async function cleanup() {
  cardSets.cacheSetCards = originalCacheSetCards;
  if (server && server.listening) await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => { try { db.dbConnection.close(() => resolve()); } catch { resolve(); } });
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDb + suffix); } catch { /* already gone */ }
  }
}

async function get(base, setId, game = 'pokemon', lang = '') {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ game, ...(lang ? { lang } : {}) });
    http.get(`${base}/api/collection/sets/${encodeURIComponent(setId)}/cards?${query}`, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(text) }); }
        catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function main() {
  try {
    await db.initDb();
    const userId = (await db.run(
      `INSERT INTO users (username, password_hash, role, share_token) VALUES (?, ?, 'admin', ?)`,
      [`cache-set-${process.pid}`, db.hashPassword('test-password'), `cache-set-share-${process.pid}`]
    )).lastID;
    const app = express();
    app.use((req, _res, next) => { req.user = { id: userId, role: 'admin' }; next(); });
    app.use('/api', require('../src/routes/collection'));
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const addCard = (id, name, setId, number, language = 'English') => db.run(
      `INSERT INTO card_cache (id, name, set_id, set_name, number, image_url, game, language)
       VALUES (?, ?, ?, 'Cache Set', ?, '', 'pokemon', ?)`,
      [id, name, setId, number, language]
    );
    await addCard('tcgdex-en-cache-1', 'Owned card', 'cache-set', '2');
    await addCard('tcgdex-en-cache-2', 'Missing card', 'cache-set', '10');
    await addCard('tcgdex-ja-cache-1', 'Japanese duplicate', 'cache-set', '2', 'Japanese');
    await addCard('tcgdex-ja-only-1', 'Cached Japanese card', 'ja-only-set', '1', 'Japanese');
    await db.run(
      `INSERT INTO collection (card_id, user_id, quantity, list_type) VALUES (?, ?, 1, 'collection')`,
      ['tcgdex-ja-cache-1', userId]
    );

    const result = await get(base, 'cache-set');
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.body.map(card => card.id).sort(), ['tcgdex-en-cache-1', 'tcgdex-en-cache-2']);
    assert.strictEqual(result.body.find(card => card.id === 'tcgdex-en-cache-1').owned, 1);
    assert.strictEqual(result.body.find(card => card.id === 'tcgdex-en-cache-2').owned, 0);

    const japanese = await get(base, 'cache-set', 'pokemon', 'ja');
    assert.strictEqual(japanese.status, 200);
    assert.deepStrictEqual(japanese.body.map(card => card.id), ['tcgdex-ja-cache-1']);
    assert.strictEqual(japanese.body[0].owned, 1);

    const fallback = await get(base, 'ja-only-set');
    assert.strictEqual(fallback.status, 200);
    assert.strictEqual(fallback.body[0].id, 'tcgdex-ja-only-1');

    let providerFetches = 0;
    cardSets.cacheSetCards = async (game, setId, language) => {
      providerFetches++;
      assert.strictEqual(game, 'pokemon');
      assert.strictEqual(setId, 'provider-set');
      assert.strictEqual(language, 'Japanese');
      await new Promise(resolve => setTimeout(resolve, 10));
      await db.run(
        `INSERT INTO card_cache (id, name, set_id, set_name, number, image_url, game, language)
         VALUES ('tcgdex-ja-provider-1', 'Fetched Japanese card', ?, 'Provider Set', '1', '', ?, ?)`,
        [setId, game, language]
      );
    };
    const [populated, populatedAgain] = await Promise.all([
      get(base, 'provider-set', 'pokemon', 'ja'),
      get(base, 'provider-set', 'pokemon', 'ja'),
    ]);
    assert.strictEqual(providerFetches, 1);
    assert.deepStrictEqual(populated.body.map(card => card.id), ['tcgdex-ja-provider-1']);
    assert.deepStrictEqual(populatedAgain.body.map(card => card.id), ['tcgdex-ja-provider-1']);

    assert.strictEqual((await get(base, 'cache-set', 'pokemon', 'not-a-language')).status, 400);
    assert.strictEqual((await get(base, 'cache-set', 'invalid')).status, 400);
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
