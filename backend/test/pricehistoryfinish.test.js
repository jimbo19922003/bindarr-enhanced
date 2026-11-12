// The inspector headline is the copy's own printing column (resolveCardPrice);
// the chart must follow that same series, and a card that moved from CardDex to
// another source keeps the CardDex history it already cached.
'use strict';
const assert = require('assert');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
process.env.DB_PATH = path.join(os.tmpdir(), `bindarr-pricefinish-${process.pid}.db`);
const db = require('../src/db');
const { recordPrice, recordFinishPrices } = require('../src/utils/priceHelpers');
const pause = () => new Promise(resolve => setTimeout(resolve, 10));

async function main() {
  await db.initDb();
  const admin = await db.get("SELECT id FROM users ORDER BY id LIMIT 1") || { id: 1 };
  // CardDex quoted the base (normal) finish at 38.19; the reverse holo column is its own price.
  await db.run(`INSERT INTO card_cache (id, name, game, language, price_trend, price_normal, price_reverse_holofoil, price_currency, price_source)
    VALUES ('tcgdex-en-fin-1', 'Finish card', 'pokemon', 'English', 38.19, 38.19, 45, 'EUR', 'carddex-cardmarket')`);
  assert.strictEqual(await recordFinishPrices('tcgdex-en-fin-1'), 2, 'both priced finishes start a series');
  assert.strictEqual(await recordFinishPrices('tcgdex-en-fin-1'), 0, 'unchanged finishes are not re-recorded');
  await pause();
  await db.run(`UPDATE card_cache SET price_reverse_holofoil = 61.51 WHERE id = 'tcgdex-en-fin-1'`);
  assert.strictEqual(await recordPrice('tcgdex-en-fin-1', 38.19), true);
  assert.strictEqual((await db.get(`SELECT COUNT(*) AS n FROM price_history_finish WHERE card_id = 'tcgdex-en-fin-1' AND finish = 'Reverse Holofoil'`)).n, 2);

  // Moved to TCGCSV (USD) with a cached CardDex tcgplayer series from before.
  await db.run(`INSERT INTO card_cache (id, name, game, language, price_trend, price_normal, price_currency, price_source)
    VALUES ('tcgdex-en-fin-2', 'Switched card', 'pokemon', 'English', 35, 35, 'USD', 'tcgcsv-market')`);
  const pokemonPrices = require('../src/pokemonPrices').getPokemonPrices();
  await pokemonPrices.initialize();
  const day = 86400000;
  await db.run(`INSERT INTO carddex_history_cache (card_id, source, body, fetched_at) VALUES ('tcgdex-en-fin-2', 'tcgplayer', ?, ?)`,
    [JSON.stringify([{ price: 45, recorded_at: new Date(Date.now() - 10 * day).toISOString(), finish: 'Normal' }, { price: 40, recorded_at: new Date(Date.now() - 5 * day).toISOString(), finish: 'Normal' }]), Date.now()]);
  await recordPrice('tcgdex-en-fin-2', 35);

  const app = express();
  app.use((req, _res, next) => { req.user = { id: admin.id }; next(); });
  app.use('/api', require('../src/routes/stats'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const get = async url => (await fetch(`http://127.0.0.1:${server.address().port}${url}`)).json();
  try {
    const reverse = await get('/api/cards/tcgdex-en-fin-1/price-history?range=30d&printing=Reverse%20Holofoil');
    assert.strictEqual(reverse.finish, 'Reverse Holofoil');
    assert.deepStrictEqual(reverse.data.map(point => point.price), [45, 61.51, 61.51], 'the reverse holo chart ends at the headline price');
    assert.strictEqual(reverse.insufficientHistory, false);

    const normal = await get('/api/cards/tcgdex-en-fin-1/price-history?range=30d&printing=Normal');
    assert.strictEqual(normal.finish, 'Normal', 'printing-specific history does not depend on price equality');

    const switched = await get('/api/cards/tcgdex-en-fin-2/price-history?range=30d&printing=Normal');
    assert.strictEqual(switched.finish, 'Normal');
    assert.deepStrictEqual(switched.data.map(point => point.price), [45, 40, 35, 35], 'cached CardDex history survives the source switch');
    assert.strictEqual(switched.carddexCount, 2);
  } finally {
    server.close();
  }
  console.log('pricehistoryfinish.test.js: all assertions passed');
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
