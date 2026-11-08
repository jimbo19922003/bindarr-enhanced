// Exercise real HTTP and SQLite, but observe requested pacing instead of
// requiring those I/O operations to complete within a 40ms wall-clock budget.
const assert = require('assert');
const http = require('http');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(os.tmpdir(), `bindarr-pricesweep-${process.pid}.db`);
process.env.POKEMON_TCG_API_KEY = 'test-key';
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
process.env.POKEMON_PRICE_GAP_MS = '40';

const db = require('../src/db');
const { updateCollectionPrices, tcgClient } = require('../src/tcgApi');
const gap = Number(process.env.POKEMON_PRICE_GAP_MS);
const tcgSource = path.resolve(__dirname, '../src/tcgApi.js');

async function observePacing(state) {
  const original = global.setTimeout;
  const scheduled = [];
  global.setTimeout = function (callback, delay, ...args) {
    const caller = String(new Error().stack?.split('\n')[2] || '');
    // Capture the configured gap, plus any other timer requested directly by
    // tcgApi (including a mistakenly hardcoded after-last-request delay).
    // Leave HTTP/socket and other dependency timers unchanged.
    if (Number(delay) === gap || caller.includes(tcgSource + ':')) {
      scheduled.push({ afterRequest: state.hits, delay: Number(delay) });
      return original(callback, 0, ...args);
    }
    return original(callback, delay, ...args);
  };
  try {
    await updateCollectionPrices(true);
    return scheduled;
  } finally {
    global.setTimeout = original;
  }
}

function makeServer(state) {
  return http.createServer((req, res) => {
    state.hits++;
    const id = decodeURIComponent(req.url.split('/cards/')[1] || '').split('?')[0];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        id, name: 'Test Card', number: '1',
        set: { id: 'test', name: 'Test Set' },
        images: { small: 'https://img/small.png' },
        tcgplayer: { prices: { normal: { market: 1.23 } } },
      },
    }));
  });
}

const listen = server => new Promise(resolve =>
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));

async function seed({ fresh, stale }) {
  await db.run('DELETE FROM collection');
  await db.run('DELETE FROM card_cache');
  await db.run('DELETE FROM price_sweeps').catch(() => {});
  let n = 0;
  const add = async (count, when) => {
    for (let i = 0; i < count; i++) {
      const id = `sv1-${++n}`;
      await db.run(
        `INSERT INTO card_cache (id, name, set_id, number, game, language, price_trend, last_updated)
         VALUES (?, ?, ?, ?, 'pokemon', 'English', 1.0, ${when})`,
        [id, `Card ${n}`, 'sv1', String(n)]
      );
      await db.run(
        `INSERT INTO collection (user_id, card_id, quantity, condition) VALUES (1, ?, 1, 'Near Mint')`,
        [id]
      );
    }
  };
  await add(fresh, `datetime('now')`);
  await add(stale, `datetime('now', '-4 days')`);
}

async function main() {
  await db.initDb();
  {
    const state = { hits: 0 };
    const server = makeServer(state);
    tcgClient.defaults.baseURL = await listen(server);
    try {
      await seed({ fresh: 40, stale: 0 });
      const pacing = await observePacing(state);
      assert.strictEqual(state.hits, 0, 'cards cached today must not be re-fetched');
      assert.deepStrictEqual(pacing, [], 'fresh cards must not schedule pacing delays');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
  {
    const state = { hits: 0 };
    const server = makeServer(state);
    tcgClient.defaults.baseURL = await listen(server);
    try {
      await seed({ fresh: 30, stale: 5 });
      const pacing = await observePacing(state);
      assert.strictEqual(state.hits, 5, 'only the five stale cards should reach the provider');
      assert.deepStrictEqual(pacing, [1, 2, 3, 4].map(afterRequest => ({ afterRequest, delay: gap })),
        'five requests require four configured gaps between requests, with none before the first or after the last');
      const priced = await db.get(
        `SELECT COUNT(*) n FROM card_cache
         WHERE game = 'pokemon' AND price_trend = 1.23 AND last_updated > datetime('now', '-1 day')`
      );
      assert.strictEqual(priced.n, 5, 'every stale card must come back with its new price');
      const history = await db.get('SELECT COUNT(*) n FROM price_history');
      assert.strictEqual(history.n, 5, 'a price movement must be recorded once per card');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
  {
    const state = { hits: 0 };
    const server = makeServer(state);
    tcgClient.defaults.baseURL = await listen(server);
    try {
      await seed({ fresh: 0, stale: 1 });
      const pacing = await observePacing(state);
      assert.strictEqual(state.hits, 1);
      assert.deepStrictEqual(pacing, [], 'one request must not schedule a before-first or after-last delay');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
  console.log('pricesweep.test.js: request, pacing, price and history assertions passed');
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
