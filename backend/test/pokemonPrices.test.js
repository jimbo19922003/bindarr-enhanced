'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { openConnection } = require('../src/utils/salesRepository');
const { createPokemonPrices } = require('../src/pokemonPrices');

const now = Date.parse('2026-11-09T12:00:00Z');
const card = { id: 'tcgdex-en-base1-4', game: 'pokemon', language: 'English',
  name: 'Charizard', number: '4', set_id: 'base1', set_name: 'Base Set',
  price_trend: 10, price_normal: null, price_holofoil: 10, price_reverse_holofoil: null,
  price_1st_edition: null, price_currency: 'EUR', price_source: 'tcgcsv', last_updated: '2026-11-01 00:00:00' };
const quote = { data: { id: 'base1-4', set_id: 'base1', set_name: 'Base Set', name: 'Charizard',
  number: '4', base_finish: 'holo', prices: [{ card_id: 'base1-4', variant_id: null,
    source: 'cardmarket', currency: 'EUR', trend_price: 12, recorded_at: '2026-11-09T07:00:00Z' }] } };

async function fixture(t, client, fallback, tcgcsv = null) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pokemon-prices-'));
  const file = path.join(root, 'test.db');
  await fs.writeFile(file, '');
  const database = await openConnection(file);
  t.after(async () => { await database.close(); await fs.rm(root, { recursive: true, force: true }); });
  await database.exec(`CREATE TABLE card_cache (
    id TEXT PRIMARY KEY, game TEXT, language TEXT, name TEXT, number TEXT, set_id TEXT, set_name TEXT,
    price_trend REAL, price_normal REAL, price_holofoil REAL, price_reverse_holofoil REAL,
    price_1st_edition REAL, price_avg1 REAL, price_avg7 REAL, price_avg30 REAL,
    price_currency TEXT, price_source TEXT, last_updated TEXT, tcgplayer_product_id INTEGER,
    price_as_of TEXT, price_fetched_at TEXT, price_base_finish TEXT);
    CREATE TABLE collection (card_id TEXT, list_type TEXT DEFAULT 'collection'); CREATE TABLE deck_cards (card_id TEXT);
    CREATE TABLE pokewallet_map (card_id TEXT PRIMARY KEY, status TEXT, reason TEXT);
    CREATE TABLE price_history (card_id TEXT, price REAL, currency TEXT, recorded_at TEXT);`);
  const keys = Object.keys(card);
  await database.run(`INSERT INTO card_cache (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(key => card[key]));
  await database.run('INSERT INTO collection (card_id) VALUES (?)', [card.id]);
  return { database, service: createPokemonPrices({ database, carddex: client,
    pokewallet: { priceFallback: fallback }, tcgcsv, now: () => now, refreshDays: async () => 1 }) };
}

test('TCGCSV is preferred over CardDex and PokéWallet', async t => {
  const { database, service } = await fixture(t, { json: async () => { throw new Error('CardDex must not run'); } },
    async () => { throw new Error('PokéWallet must not run'); },
    { quoteForCard: async () => ({ price_trend: 42, price_normal: 20, price_holofoil: 42,
      price_reverse_holofoil: null, price_1st_edition: null, productId: 123, source: 'tcgcsv', asOf: '2026-11-09T07:00:00Z' }) });
  assert.equal((await service.refreshCard(card)).status, 'tcgcsv');
  const updated = await database.get('SELECT price_trend, price_normal, price_holofoil, price_currency, price_source, tcgplayer_product_id FROM card_cache WHERE id = ?', [card.id]);
  assert.deepEqual(updated, { price_trend: 42, price_normal: 20, price_holofoil: 42, price_currency: 'USD', price_source: 'tcgcsv', tcgplayer_product_id: 123 });
});

test('TCGCSV failure falls back to CardDex', async t => {
  const { service } = await fixture(t, { json: async () => quote }, async () => ({ updated: 0 }),
    { quoteForCard: async () => { throw new Error('cache unavailable'); } });
  assert.equal((await service.refreshCard(card)).status, 'matched');
});

test('a missing TCGCSV quote falls through CardDex to PokéWallet', async t => {
  const calls = [];
  const { service } = await fixture(t, { json: async () => { calls.push('carddex'); return {data:null}; } },
    async () => { calls.push('pokewallet'); return { updated: 1 }; },
    { quoteForCard: async () => { calls.push('tcgcsv'); return null; } });
  assert.equal((await service.refreshCard(card)).status, 'fallback');
  assert.deepEqual(calls, ['tcgcsv', 'carddex', 'pokewallet']);
});

test('TCGCSV cannot overwrite a concurrently updated price', async t => {
  let database;
  const setup = await fixture(t, { json: async () => { throw new Error('must not fetch'); } },
    async () => { throw new Error('must not fetch'); },
    { quoteForCard: async () => {
      await database.run("UPDATE card_cache SET price_trend=99, price_source='pokewallet-tcgplayer' WHERE id=?", [card.id]);
      return { price_trend:42, price_normal:42, price_holofoil:null, price_reverse_holofoil:null,
        price_1st_edition:null, productId:123, source:'tcgcsv', asOf:'2026-11-09T07:00:00Z' };
    } });
  database = setup.database;
  assert.equal((await setup.service.refreshCard(card)).status, 'changed');
  assert.equal((await database.get('SELECT price_trend FROM card_cache WHERE id = ?', [card.id])).price_trend, 99);
});

test('CardDex wins and fresh source data prevents repeated API lookups', async t => {
  let requests = 0, fallbacks = 0;
  const { database, service } = await fixture(t, { json: async () => { requests++; return quote; } },
    async () => { fallbacks++; return { updated: 1 }; });
  assert.equal((await service.sweep()).examined, 1);
  assert.equal((await service.sweep()).examined, 0);
  const updated = await database.get('SELECT * FROM card_cache WHERE id = ?', [card.id]);
  assert.equal(updated.price_trend, 12);
  assert.equal(updated.price_holofoil, 12);
  assert.equal(updated.price_currency, 'EUR');
  assert.equal(updated.price_source, 'carddex-cardmarket');
  assert.equal((await database.get('SELECT COUNT(*) AS n FROM price_history')).n, 0);
  assert.equal(requests, 1);
  assert.equal(fallbacks, 0);
});

test('source freshness is 48 hours, not the time the quote was copied locally', async t => {
  let requests = 0;
  const { database, service } = await fixture(t, { json: async () => { requests++; return quote; } },
    async () => { throw new Error('must not run'); },
    { quoteForCard: async () => ({ price_trend: 99, asOf: '2026-11-07T11:59:59Z', source: 'tcgcsv' }) });
  await database.run("UPDATE card_cache SET last_updated = '2026-11-09 12:00:00', price_as_of = '2026-11-07T11:59:59Z' WHERE id = ?", [card.id]);
  assert.equal((await service.refreshCard(card)).status, 'matched');
  const updated = await database.get('SELECT price_trend, price_as_of, price_base_finish FROM card_cache WHERE id = ?', [card.id]);
  assert.deepEqual(updated, { price_trend: 12, price_as_of: '2026-11-09T07:00:00Z', price_base_finish: 'Holofoil' });
  assert.equal(requests, 1);
});

test('failed fallbacks preserve a stale quote without falsely making its source date current', async t => {
  const { database, service } = await fixture(t, { json: async () => ({ data: null }) }, async () => ({ updated: 0 }));
  const asOf = '2026-11-01T00:00:00Z';
  await database.run('UPDATE card_cache SET price_as_of = ? WHERE id = ?', [asOf, card.id]);
  await service.refreshCard(card);
  assert.deepEqual(await database.get('SELECT price_trend, price_as_of FROM card_cache WHERE id = ?', [card.id]), { price_trend: 10, price_as_of: asOf });
});

test('cache-only previews never spend API calls and do not block later live fallback', async t => {
  let calls = 0;
  let unavailable = false;
  const { database, service } = await fixture(t, { json: async () => { calls++; return quote; } },
    async () => { throw new Error('must not run'); }, { quoteForCard: async () => { if (unavailable) throw new Error('mirror unavailable'); return null; } });
  assert.equal((await service.refreshCard(card, null, { allowApi: false })).status, 'cache_only');
  assert.equal(calls, 0);
  assert.equal((await database.get('SELECT COUNT(*) AS n FROM carddex_price_attempt')).n, 0);
  unavailable = true;
  assert.equal((await service.refreshCard(card, null, { allowApi: false })).status, 'cache_only');
  assert.equal(calls, 0);
  assert.equal((await service.refreshCard(card)).status, 'matched');
  assert.equal(calls, 1);
});

test('a newly fresh mirror is usable even during a failed API retry cooldown', async t => {
  let mirror = null;
  let calls = 0;
  const { database, service } = await fixture(t, { json: async () => { calls++; return { data: null }; } },
    async () => ({ updated: 0 }), { quoteForCard: async () => mirror });
  await service.refreshCard(card);
  assert.equal((await service.refreshCard(card)).status, 'not_due');
  assert.equal(calls, 1);
  mirror = { price_trend: 42, asOf: '2026-11-09T10:00:00Z', source: 'tcgcsv' };
  assert.equal((await service.refreshCard(card)).status, 'tcgcsv');
  assert.equal((await database.get('SELECT price_trend FROM card_cache WHERE id = ?', [card.id])).price_trend, 42);
  assert.equal(calls, 1);
});

test('freshness boundaries reject unknown or future dates without inventing timestamps', () => {
  const { isFreshQuote } = require('../src/utils/priceFreshness');
  const now = Date.parse('2026-11-09T12:00:00Z');
  assert.equal(isFreshQuote('2026-11-07 12:00:00', now), true);
  assert.equal(isFreshQuote('2026-11-07T11:59:59Z', now), false);
  assert.equal(isFreshQuote('2026-11-09T12:05:01Z', now), false);
  for (const date of [null, '', 'not-a-date']) assert.equal(isFreshQuote(date, now), false);
});

test('TCGCSV history fetches independently of current price source and refuses a different finish', async t => {
  const paths = [];
  const { service } = await fixture(t, { json: async endpoint => {
    paths.push(endpoint);
    if (endpoint.endsWith('/prices/history')) return { data: [
      { trend_price: 8, recorded_at: '2026-11-08T07:00:00Z', source: 'tcgplayer', currency: 'USD' },
      { trend_price: 500, recorded_at: '2026-11-08T08:00:00Z', variant_id: 'reverse' },
      { trend_price: 999, recorded_at: '2026-11-10T07:00:00Z' },
    ] };
    return quote;
  } }, async () => ({ updated: 0 }));
  const sourceCard = { ...card, price_source: 'tcgcsv', price_currency: 'USD' };
  const history = await service.history(sourceCard, 'Holofoil');
  assert.deepEqual(history.points, [{ price: 8, recorded_at: '2026-11-08T07:00:00Z', finish: 'Holofoil' }]);
  assert.equal((await service.history(sourceCard, 'Reverse Holofoil')).points.length, 0);
  assert.equal(paths.length, 2, 'base finish and historical series are cached');
});

test('CardDex replaces a different-currency quote without retaining old finish prices', async t => {
  const usdQuote = { data: { ...quote.data, prices: [{ ...quote.data.prices[0],
    source: 'tcgplayer', currency: 'USD', trend_price: 22 }] } };
  const { database, service } = await fixture(t, { json: async () => usdQuote },
    async () => { throw new Error('fallback must not run'); });
  await database.run(`UPDATE card_cache SET price_normal = 8, price_reverse_holofoil = 9,
    price_1st_edition = 11 WHERE id = ?`, [card.id]);
  await database.run(`INSERT INTO pokewallet_map VALUES (?, 'currency_conflict', 'currency_differs')`, [card.id]);
  const previous = await database.get('SELECT * FROM card_cache WHERE id = ?', [card.id]);
  assert.equal((await service.refreshCard(previous)).status, 'matched');
  const updated = await database.get(`SELECT price_trend, price_normal, price_holofoil, price_reverse_holofoil,
    price_1st_edition, price_currency, price_source FROM card_cache WHERE id = ?`, [card.id]);
  assert.deepEqual(updated, { price_trend: 22, price_normal: null, price_holofoil: 22,
    price_reverse_holofoil: null, price_1st_edition: null, price_currency: 'USD', price_source: 'carddex-tcgplayer' });
  assert.deepEqual(await database.get('SELECT status, reason FROM pokewallet_map WHERE card_id = ?', [card.id]),
    { status: 'skipped_priced', reason: 'existing_quote' });
});

test('sweep resolves 30th Celebration to the CardDex set and writes a confirmed quote', async t => {
  const { database, service } = await fixture(t, { json: async endpoint => {
    assert.equal(endpoint, '/v1/cards/30c-037');
    return { data: { ...quote.data, id: '30c-037', set_id: '30c', set_name: '30th Celebration',
      name: 'Pikachu', number: '037', prices: [{ ...quote.data.prices[0], card_id: '30c-037' }] } };
  } }, async () => { throw new Error('fallback must not run'); });
  const id = 'tcgdex-en-30th-037';
  await database.run(`UPDATE card_cache SET id = ?, set_id = '30th', set_name = '30th Celebration',
    name = 'Pikachu', number = '037' WHERE id = ?`, [id, card.id]);
  await database.run('UPDATE collection SET card_id = ? WHERE card_id = ?', [id, card.id]);
  assert.deepEqual((await service.sweep()).counts, { matched: 1 });
  const updated = await database.get('SELECT price_trend, price_source FROM card_cache WHERE id = ?', [id]);
  assert.deepEqual(updated, { price_trend: 12, price_source: 'carddex-cardmarket' });
  assert.equal((await database.get('SELECT provider_id FROM carddex_price_attempt WHERE card_id = ?', [id])).provider_id, '30c-037');
});

test('gallery price refresh and history use the mapped parent-set printing', async t => {
  const paths = [];
  const { database, service } = await fixture(t, { json: async endpoint => {
    paths.push(endpoint);
    if (endpoint.endsWith('/prices/history')) return { data: [{ trend_price: 11, recorded_at: '2026-11-08T07:00:00Z' }] };
    return { data: { ...quote.data, id: 'swsh9-TG01', set_id: 'swsh9', set_name: 'Brilliant Stars',
      name: 'Flareon', number: 'TG01', prices: [{ ...quote.data.prices[0], card_id: 'swsh9-TG01' }] } };
  } }, async () => { throw new Error('fallback must not run'); });
  const id = 'tcgdex-en-swsh9tg-TG01';
  await database.run(`UPDATE card_cache SET id = ?, set_id = 'swsh9tg', set_name = 'Brilliant Stars Trainer Gallery',
    name = 'Flareon', number = 'TG01' WHERE id = ?`, [id, card.id]);
  await database.run('UPDATE collection SET card_id = ? WHERE card_id = ?', [id, card.id]);
  assert.deepEqual((await service.sweep()).counts, { matched: 1 });
  const updated = await database.get('SELECT * FROM card_cache WHERE id = ?', [id]);
  assert.equal((await service.history(updated)).status, 'fresh');
  assert.deepEqual(paths, ['/v1/cards/swsh9-TG01', '/v1/cards/swsh9-TG01/prices/history']);
});

test('failed CardDex tries PokéWallet, preserving a cached price when both fail', async t => {
  let fallbacks = 0;
  const { database, service } = await fixture(t, { json: async () => { throw Object.assign(new Error(), { code: 'rate_limited' }); } },
    async () => { fallbacks++; return { updated: 0 }; });
  const result = await service.refreshCard(card);
  assert.equal(result.status, 'rate_limited');
  assert.equal(fallbacks, 1);
  const unchanged = await database.get('SELECT price_trend, price_currency, price_source FROM card_cache WHERE id = ?', [card.id]);
  assert.deepEqual(unchanged, { price_trend: 10, price_currency: 'EUR', price_source: 'tcgcsv' });
});

test('a concurrent newer quote cannot be overwritten by a slow CardDex response', async t => {
  let database;
  const setup = await fixture(t, { json: async () => {
    await database.run(`UPDATE card_cache SET price_trend = 99, price_source = 'pokewallet-cardmarket',
      last_updated = '2026-11-09 11:59:00' WHERE id = ?`, [card.id]);
    return quote;
  } }, async () => { throw new Error('fallback must not run'); });
  database = setup.database;
  assert.equal((await setup.service.refreshCard(card)).status, 'changed');
  const current = await database.get('SELECT price_trend, price_source FROM card_cache WHERE id = ?', [card.id]);
  assert.deepEqual(current, { price_trend: 99, price_source: 'pokewallet-cardmarket' });
});

test('a failed fetch restores the latest compatible positive recorded price', async t => {
  const { database, service } = await fixture(t, { json: async () => ({ data: null }) },
    async () => ({ updated: 0 }));
  await database.run(`UPDATE card_cache SET price_trend = 0, price_holofoil = NULL WHERE id = ?`, [card.id]);
  await database.run(`INSERT INTO price_history VALUES (?, 8, 'EUR', '2026-11-07 00:00:00')`, [card.id]);
  await database.run(`INSERT INTO price_history VALUES (?, 9, 'USD', '2026-11-09 00:00:00')`, [card.id]);
  const empty = await database.get('SELECT * FROM card_cache WHERE id = ?', [card.id]);
  assert.equal((await service.refreshCard(empty)).status, 'cached_history');
  const restored = await database.get('SELECT price_trend, price_currency, price_source FROM card_cache WHERE id = ?', [card.id]);
  assert.deepEqual(restored, { price_trend: 8, price_currency: 'EUR', price_source: 'cached-history' });
  assert.equal((await database.get('SELECT quote_at FROM carddex_price_attempt WHERE card_id = ?', [card.id])).quote_at, '2026-11-07T00:00:00.000Z');
});

test('a later cached CardDex history point can restore an empty current price', async t => {
  const { database, service } = await fixture(t, { json: async () => ({ data: null }) },
    async () => ({ updated: 0 }));
  await service.initialize();
  await database.run(`UPDATE card_cache SET price_trend = 0, price_holofoil = NULL WHERE id = ?`, [card.id]);
  await database.run(`INSERT INTO price_history VALUES (?, 8, 'EUR', '2026-11-07 00:00:00')`, [card.id]);
  await database.run(`INSERT INTO carddex_history_cache VALUES (?, 'cardmarket', ?, ?)`,
    [card.id, JSON.stringify([{ price: 11, recorded_at: '2026-11-08T07:00:00Z' }]), now]);
  const empty = await database.get('SELECT * FROM card_cache WHERE id = ?', [card.id]);
  assert.equal((await service.refreshCard(empty)).status, 'cached_history');
  assert.equal((await database.get('SELECT price_trend FROM card_cache WHERE id = ?', [card.id])).price_trend, 11);
});

test('bounded sweeps make progress without retrying already attempted cards', async t => {
  let requests = 0;
  const { database, service } = await fixture(t, { json: async () => { requests++; return { data: null }; } },
    async () => ({ updated: 0 }));
  for (let i = 0; i < 26; i++) {
    const id = `tcgdex-en-base1-extra${i}`;
    await database.run(`INSERT INTO card_cache (id, game, language, name, number, set_id, set_name)
      VALUES (?, 'pokemon', 'English', 'Test', ?, 'base1', 'Base Set')`, [id, String(i)]);
    await database.run(`INSERT INTO collection (card_id) VALUES (?)`, [id]);
  }
  assert.equal((await service.sweep()).examined, 25);
  assert.equal((await service.sweep()).examined, 2);
  assert.equal((await service.sweep()).examined, 0);
  assert.equal(requests, 27);
});

test('history replaces the provider cache and reuses it without collecting snapshots', async t => {
  let requests = 0;
  const { database, service } = await fixture(t, { json: async (_path, params) => {
    requests++;
    assert.equal(params.source, 'cardmarket');
    return { data: [{ trend_price: 11, recorded_at: '2026-11-08T07:00:00Z' }] };
  } }, async () => ({ updated: 0 }));
  const sourceCard = { ...card, price_source: 'carddex-cardmarket', price_base_finish: 'Holofoil' };
  assert.equal((await service.history(sourceCard)).status, 'fresh');
  assert.equal((await service.history(sourceCard)).status, 'cached');
  assert.equal(requests, 1);
  assert.equal((await database.get('SELECT COUNT(*) AS n FROM price_history')).n, 0);
});
