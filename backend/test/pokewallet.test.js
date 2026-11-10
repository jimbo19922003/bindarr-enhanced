'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(os.tmpdir(), `bindarr-pokewallet-${process.pid}.db`);
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
process.env.POKEWALLET_API_KEY = 'pk_test_SHOULD_NOT_LEAK_9f3a';

const db = require('../src/db');
const api = require('../src/pokewalletApi');
const { extractQuote, matchSearchResults, searchQuery } = require('../src/utils/pokewalletMatch');
const { cacheNormalizedCards } = require('../src/utils/cardCache');
const { resolveCardPrice } = require('../src/utils/priceHelpers');

const KEY = process.env.POKEWALLET_API_KEY;
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/pokewallet', name), 'utf8'));
const mewtwoSearch = fixture('search-mewtwo.json');
const ambiguousSearch = fixture('search-ambiguous.json');
const manualCard = fixture('card-manual.json');
const sealedCard = fixture('card-sealed.json');

const hits = { n: 0, keys: [], queries: [] };
let mode = 'search';
let releaseDelay = () => {};
let delayPromise = Promise.resolve();

function send(res, status, body, extraHeaders) {
  res.writeHead(status, { 'content-type': 'application/json', ...(extraHeaders || {}) });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  hits.n += 1;
  hits.keys.push(req.headers['x-api-key'] || '');
  const url = new URL(req.url, 'http://127.0.0.1');
  if (mode === '401') return send(res, 401, { error: 'Unauthorized', example: req.headers['x-api-key'] });
  if (mode === '429') return send(res, 429, { error: 'Rate limit exceeded' }, { 'retry-after': '30' });
  if (mode === 'delay' && url.pathname === '/search') {
    delayPromise.then(() => send(res, 200, mewtwoSearch));
    return;
  }
  if (url.pathname.startsWith('/cards/')) {
    const id = decodeURIComponent(url.pathname.slice('/cards/'.length));
    if (id === sealedCard.id) return send(res, 200, sealedCard);
    if (id === manualCard.id) return send(res, 200, manualCard, { 'x-ratelimit-remaining-hour': '3', 'x-ratelimit-remaining-day': '40' });
    return send(res, 404, { error: 'Card not found' });
  }
  const q = url.searchParams.get('q') || '';
  hits.queries.push(q);
  if (q.includes('MISSING')) {
    return send(res, 200, { results: [], pagination: { page: 1, limit: 20, total: 0, total_pages: 0 } });
  }
  if (q === 'Mewtwo ex') {
    return send(res, 200, {
      query: q,
      results: [{
        id: 'pk_15115115115115115115115115115111',
        card_info: {
          name: 'Mewtwo ex - 151/158',
          clean_name: 'Mewtwo ex 151 158',
          set_name: '30th Celebration',
          set_code: '30C',
          card_number: '151/158',
          product_type: 'card',
        },
        tcgplayer: {
          url: 'https://www.tcgplayer.com/product/555151',
          prices: [{ sub_type_name: 'Holofoil', market_price: 40, updated_at: '2026-11-01T00:00:00Z' }],
        },
        cardmarket: null,
      }],
      pagination: { page: 1, limit: 100, total: 1, total_pages: 1 },
    });
  }
  if (q.includes('Cubone')) return send(res, 200, ambiguousSearch);
  if (q.includes('Mewtwo')) {
    const headers = mode === 'remaining-zero' ? { 'x-ratelimit-remaining-hour': '0', 'x-ratelimit-remaining-day': '10' } : {};
    return send(res, 200, mewtwoSearch, headers);
  }
  return send(res, 200, { results: [], pagination: { page: 1, limit: 20, total: 0, total_pages: 0 } });
});

async function reset() {
  api.resetForTests();
  mode = 'search';
  hits.n = 0;
  hits.keys = [];
  hits.queries = [];
  await db.run(`DELETE FROM collection`);
  await db.run(`DELETE FROM pokewallet_map`);
  await db.run(`DELETE FROM pokewallet_cache`);
  await db.run(`DELETE FROM pokewallet_request`);
  await db.run(`DELETE FROM pokewallet_budget`);
  await db.run(`DELETE FROM price_history`);
  await db.run(`DELETE FROM card_cache`);
  await db.run(`UPDATE app_settings SET price_refresh_days = 1, pokewallet_prices_swept_at = NULL, pokewallet_last_report = NULL, pokewallet_api_key = '' WHERE id = 1`);
  process.env.POKEWALLET_API_KEY = KEY;
}

async function addCard({ id, name, setId, setName, number, language = 'English', price = 0, source = 'tcgdex', currency = 'EUR', userId = 1 }) {
  await db.run(
    `INSERT INTO card_cache (id, name, set_id, set_name, number, game, language, price_trend, price_currency, price_source)
     VALUES (?, ?, ?, ?, ?, 'pokemon', ?, ?, ?, ?)`,
    [id, name, setId, setName, number, language, price, currency, source]
  );
  await db.run(
    `INSERT INTO collection (user_id, card_id, quantity, condition, printing, language, position, game)
     VALUES (?, ?, 1, 'Near Mint', 'Holofoil', ?, 1000, 'pokemon')`,
    [userId, id, language]
  );
}

function assertNoSecret(value) {
  assert.ok(!JSON.stringify(value).includes('SHOULD_NOT_LEAK'), 'a response included the API key');
}

async function main() {
  await db.initDb();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  api.client.defaults.baseURL = `http://127.0.0.1:${server.address().port}`;

  const logs = [];
  const warn = console.warn;
  const error = console.error;
  console.warn = (...args) => logs.push(args.map(String).join(' '));
  console.error = (...args) => logs.push(args.map(String).join(' '));

  try {
    // Quotes stay in one currency. A Cardmarket average is not copied onto a USD row.
    const mixed = extractQuote(manualCard);
    assert.strictEqual(mixed.currency, 'USD');
    assert.strictEqual(mixed.source, 'pokewallet-tcgplayer');
    assert.strictEqual(mixed.price_trend, 4.5);
    assert.strictEqual(mixed.price_normal, 1.25);
    assert.strictEqual(mixed.price_holofoil, 4.5);
    assert.strictEqual(mixed.price_avg1, null);
    assert.strictEqual(mixed.tcgplayer_product_id, 245000);
    const preferredEur = extractQuote(manualCard, 'EUR');
    assert.strictEqual(preferredEur.currency, 'EUR');
    assert.strictEqual(preferredEur.price_trend, 2.1);
    const eur = extractQuote(ambiguousSearch.results[0]);
    assert.strictEqual(eur.currency, 'EUR');
    assert.strictEqual(eur.price_trend, 0.4);
    assert.strictEqual(extractQuote({ card_info: { product_type: 'sealed' }, tcgplayer: { prices: [{ sub_type_name: 'Normal', market_price: 50 }] } }).reason, 'not_a_card');
    assert.strictEqual(extractQuote({
      card_info: { product_type: 'card' },
      tcgplayer: { prices: [{ sub_type_name: 'Shadowless', market_price: 1000 }] },
    }).reason, 'variant_unconfirmed');
    assert.strictEqual(extractQuote({
      card_info: { product_type: 'card' },
      tcgplayer: { url: 'javascript:alert(1)', prices: [{ sub_type_name: 'Normal', market_price: 3 }] },
    }).tcgplayer_url, null);
    const several = matchSearchResults(
      { name: 'Cubone', number: '4', set_id: 'CBB3C', set_name: 'Gem Pack' },
      ambiguousSearch.results,
      2
    );
    assert.strictEqual(several.status, 'ambiguous');
    assert.strictEqual(several.candidates.length, 2);
    const unconfirmed = matchSearchResults(
      { name: 'Mewtwo', number: '003', set_id: 'base1', set_name: 'Base' },
      mewtwoSearch.results,
      2
    );
    assert.strictEqual(unconfirmed.status, 'ambiguous');
    assert.strictEqual(unconfirmed.reason, 'set_unconfirmed');

    // PokéWallet search is name + set code, or a numeric set id + number.
    // "Mewtwo ex 151" is not a query it accepts.
    assert.strictEqual(searchQuery({ name: 'Mewtwo ex', number: '151', set_id: '30th' }), 'Mewtwo ex 30th');
    assert.strictEqual(searchQuery({ name: 'Cubone', number: '4', set_id: 'CBB3C' }), 'Cubone CBB3C');
    assert.strictEqual(searchQuery({ name: 'Pikachu', number: '148', set_id: '24541' }), '24541 148');
    assert.strictEqual(searchQuery({ name: 'Pikachu', number: '025/165', set_id: '24541' }), '24541 25');
    const celebrationMatch = matchSearchResults(
      { name: 'Mewtwo ex', number: '151', set_id: '30th', set_name: '30th Celebration' },
      [{
        id: 'pk_15115115115115115115115115115111',
        card_info: {
          name: 'Mewtwo ex - 151/158',
          clean_name: 'Mewtwo ex 151 158',
          set_name: '30th Celebration',
          set_code: '30C',
          card_number: '151/158',
          product_type: 'card',
        },
        tcgplayer: { prices: [{ sub_type_name: 'Holofoil', market_price: 40 }] },
      }],
      1
    );
    assert.strictEqual(celebrationMatch.status, 'matched');
    assert.strictEqual(celebrationMatch.matches.length, 1);
    const differentCard = matchSearchResults(
      { name: 'Mewtwo', number: '151', set_id: '30th', set_name: '30th Celebration' },
      celebrationMatch.matches,
      1
    );
    assert.strictEqual(differentCard.status, 'unmatched');
    assert.strictEqual(matchSearchResults(
      { name: 'Pikachu', number: '25', set_id: 'sv3pt5', set_name: '151' },
      [{ card_info: { name: 'Pikachu - 025/165', card_number: '025/165', set_name: '151', set_code: 'MEW', product_type: 'card' } }],
      1
    ).status, 'matched');

    // Re-running init does not rewrite a card that is already there.
    await addCard({ id: 'tcgdex-en-30th-003', name: 'Mewtwo', setId: '30th', setName: 'Celebrations: Classic Collection', number: '003' });
    await db.initDb();
    assert.strictEqual((await db.get(`SELECT id, name FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-003'])).name, 'Mewtwo');
    assert.ok(await db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pokewallet_map'`));

    await reset();
    await addCard({ id: 'tcgdex-en-30th-003', name: 'Mewtwo', setId: '30th', setName: 'Celebrations: Classic Collection', number: '003' });
    await addCard({ id: 'tcgdex-ja-sv2a-004', name: 'フシギダネ', setId: 'sv2a', setName: 'ポケモンカード151', number: '004', language: 'Japanese', userId: 1 });
    await addCard({ id: 'sv1-25', name: 'Pikachu', setId: 'sv1', setName: 'Scarlet & Violet', number: '25', price: 0, source: 'pokemontcg', currency: 'USD' });
    const priced = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(priced.status, 'complete');
    assert.strictEqual(priced.updated, 1);
    assert.strictEqual(priced.skipped_language, 1);
    assert.strictEqual(hits.n, 1);
    assert.deepStrictEqual(hits.queries, ['Mewtwo 30th']);
    assert.deepStrictEqual(hits.keys, [KEY]);
    const row = await db.get(`SELECT * FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-003']);
    assert.strictEqual(row.id, 'tcgdex-en-30th-003');
    assert.strictEqual(row.name, 'Mewtwo');
    assert.strictEqual(row.set_id, '30th');
    assert.strictEqual(row.number, '003');
    assert.strictEqual(row.price_trend, 12.5);
    assert.strictEqual(row.price_holofoil, 12.5);
    assert.strictEqual(row.price_normal, null);
    assert.strictEqual(row.price_currency, 'USD');
    assert.strictEqual(row.price_source, 'pokewallet-tcgplayer');
    assert.strictEqual(row.tcgplayer_product_id, 246890);
    const owned = await db.get(`SELECT card_id, user_id, quantity, position FROM collection WHERE card_id = ?`, ['tcgdex-en-30th-003']);
    assert.strictEqual(owned.card_id, 'tcgdex-en-30th-003');
    assert.strictEqual(owned.user_id, 1);
    assert.strictEqual(owned.quantity, 1);
    assert.strictEqual(owned.position, 1000);
    assert.strictEqual(resolveCardPrice({ ...row, printing: 'Holofoil' }), 12.5);
    assert.strictEqual((await db.get(`SELECT id, price_trend FROM card_cache WHERE id = ?`, ['sv1-25'])).price_trend, 0);
    assert.strictEqual((await db.get(`SELECT price_trend, price_source FROM card_cache WHERE id = ?`, ['tcgdex-ja-sv2a-004'])).price_source, 'tcgdex');
    assertNoSecret(priced);

    const beforeSecond = hits.n;
    const again = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(again.updated, 1);
    assert.strictEqual(hits.n, beforeSecond, 'a repeat refresh uses the cached response');
    assert.strictEqual((await db.get(`SELECT price_trend FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-003'])).price_trend, 12.5);

    await cacheNormalizedCards([{
      id: 'tcgdex-en-30th-003', name: 'Mewtwo', printed_name: 'Mewtwo', set_id: '30th',
      set_name: 'Celebrations: Classic Collection', number: '003', language: 'English',
      price_trend: 0, price_source: 'tcgdex', price_currency: 'EUR',
    }], 'pokemon');
    const kept = await db.get(`SELECT id, price_trend, price_source, price_currency FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-003']);
    assert.strictEqual(kept.price_trend, 12.5);
    assert.strictEqual(kept.price_source, 'pokewallet-tcgplayer');
    assert.strictEqual(kept.price_currency, 'USD');

    await reset();
    await addCard({ id: 'tcgdex-en-base4-4', name: 'Charizard', setId: 'base4', setName: 'Base', number: '4', price: 400, source: 'tcgcsv', currency: 'USD' });
    await cacheNormalizedCards([{
      id: 'tcgdex-en-base4-4', name: 'Charizard', set_id: 'base4',
      set_name: 'Base', number: '4', language: 'English',
      price_trend: 0, price_source: 'tcgdex', price_currency: 'EUR',
    }], 'pokemon');
    const cachedQuote = await db.get(`SELECT price_trend, price_source, price_currency FROM card_cache WHERE id = ?`, ['tcgdex-en-base4-4']);
    assert.deepStrictEqual(cachedQuote, { price_trend: 400, price_source: 'tcgcsv', price_currency: 'USD' });
    const leftAlone = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(leftAlone.skipped_priced, 1);
    assert.strictEqual(leftAlone.updated, 0);
    assert.strictEqual(hits.n, 0, 'a priced card must not spend a request');
    assert.strictEqual((await db.get(`SELECT price_trend, price_source, id FROM card_cache WHERE id = ?`, ['tcgdex-en-base4-4'])).price_source, 'tcgcsv');

    await reset();
    await addCard({ id: 'tcgdex-en-30th-003', name: 'Mewtwo', setId: '30th', setName: 'Celebrations: Classic Collection', number: '003', price: 4, source: 'carddex-tcgplayer', currency: 'USD' });
    const previous = await db.get(`SELECT * FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-003']);
    const fallback = await api.priceFallback(previous);
    assert.strictEqual(fallback.updated, 1);
    const fallbackPrice = await db.get(`SELECT price_trend, price_source FROM card_cache WHERE id = ?`, [previous.id]);
    assert.deepStrictEqual(fallbackPrice, { price_trend: 12.5, price_source: 'pokewallet-tcgplayer' });

    await reset();
    await addCard({ id: 'tcgdex-en-30th-003', name: 'Mewtwo', setId: '30th', setName: 'Celebrations: Classic Collection', number: '003', price: 4, source: 'carddex-cardmarket', currency: 'EUR' });
    await db.run(`UPDATE card_cache SET price_normal = 3, price_reverse_holofoil = 5, price_1st_edition = 6 WHERE id = ?`, ['tcgdex-en-30th-003']);
    const euro = await db.get(`SELECT * FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-003']);
    const conflict = await api.priceFallback(euro);
    assert.strictEqual(conflict.updated, 1);
    assert.deepStrictEqual(await db.get(`SELECT price_trend, price_normal, price_holofoil,
      price_reverse_holofoil, price_1st_edition, price_currency, price_source FROM card_cache WHERE id = ?`, [euro.id]),
    { price_trend: 12.5, price_normal: null, price_holofoil: 12.5, price_reverse_holofoil: null,
      price_1st_edition: null, price_currency: 'USD', price_source: 'pokewallet-tcgplayer' });
    assert.strictEqual((await db.get(`SELECT status FROM pokewallet_map WHERE card_id = ?`, [euro.id])).status, 'matched');

    await reset();
    await addCard({ id: 'tcgdex-en-30th-003', name: 'Mewtwo', setId: '30th', setName: 'Celebrations: Classic Collection', number: '003', price: 4, source: 'carddex-tcgplayer', currency: 'USD' });
    await db.run(`UPDATE card_cache SET price_normal = 3 WHERE id = ?`, ['tcgdex-en-30th-003']);
    const sameCurrency = await db.get(`SELECT * FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-003']);
    assert.strictEqual((await api.priceFallback(sameCurrency)).updated, 1);
    assert.strictEqual((await db.get(`SELECT price_normal FROM card_cache WHERE id = ?`, [sameCurrency.id])).price_normal, 3);

    await reset();
    await addCard({ id: 'tcgdex-en-30th-003', name: 'Mewtwo', setId: '30th', setName: 'Celebrations: Classic Collection', number: '003', price: 4, source: 'pokewallet-cardmarket', currency: 'EUR' });
    const changedCurrency = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(changedCurrency.updated, 1);
    assert.deepStrictEqual(await db.get(`SELECT price_trend, price_currency, price_source FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-003']),
      { price_trend: 12.5, price_currency: 'USD', price_source: 'pokewallet-tcgplayer' });

    await reset();
    await addCard({ id: 'tcgdex-en-cbb3c-4', name: 'Cubone', setId: 'CBB3C', setName: 'Gem Pack', number: '4' });
    const ambiguous = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(ambiguous.ambiguous, 1);
    assert.strictEqual(ambiguous.updated, 0);
    assert.strictEqual(hits.n, 1, 'a page of results is not searched a second time');
    assert.deepStrictEqual(hits.queries, ['Cubone CBB3C']);
    assert.strictEqual((await db.get(`SELECT price_trend, price_source FROM card_cache WHERE id = ?`, ['tcgdex-en-cbb3c-4'])).price_source, 'tcgdex');
    const state = await api.status();
    assert.strictEqual(state.issues.length, 1);
    assert.strictEqual(state.issues[0].candidates.length, 2);
    assertNoSecret(state);
    await db.run(`UPDATE card_cache SET price_holofoil = 12, price_source = 'tcgcsv', price_currency = 'USD' WHERE id = ?`, ['tcgdex-en-cbb3c-4']);
    assert.strictEqual((await api.status()).issues_total, 0, 'a price from another source resolves the visible issue');
    assert.strictEqual((await api.mapManually('tcgdex-en-cbb3c-4', manualCard.id, false)).statusCode, 409);
    assert.strictEqual((await db.get(`SELECT status FROM pokewallet_map WHERE card_id = ?`, ['tcgdex-en-cbb3c-4'])).status, 'ambiguous', 'the historical mapping is retained');
    await db.run(`UPDATE card_cache SET price_holofoil = NULL WHERE id = ?`, ['tcgdex-en-cbb3c-4']);
    assert.strictEqual((await api.status()).issues_total, 1, 'the issue reappears if the price is removed');
    await db.run(`UPDATE collection SET list_type = 'sold' WHERE card_id = ?`, ['tcgdex-en-cbb3c-4']);
    assert.strictEqual((await api.status()).issues_total, 0, 'sold-only cards are not actionable');
    const deck = await db.run(`INSERT INTO decks (user_id, name) VALUES (1, 'Pricing issue deck')`);
    await db.run(`INSERT INTO deck_cards (deck_id, card_id) VALUES (?, ?)`, [deck.lastID, 'tcgdex-en-cbb3c-4']);
    assert.strictEqual((await api.status()).issues_total, 1, 'cards in decks remain actionable');
    await db.run('DELETE FROM decks WHERE id = ?', [deck.lastID]);

    await reset();
    for (let i = 0; i < 23; i++) {
      const id = `tcgdex-en-queue-${String(i).padStart(2, '0')}`;
      await addCard({ id, name: `Queue ${String(i).padStart(2, '0')}`, setId: 'queue', setName: 'Queue', number: String(i) });
      await db.run(`INSERT INTO pokewallet_map (card_id, status, reason, candidates_json, updated_at) VALUES (?, 'unmatched', 'not_found', '[]', CURRENT_TIMESTAMP)`, [id]);
    }
    const firstPage = await api.status();
    const secondPage = await api.status(10);
    const lastPage = await api.status(100);
    assert.strictEqual(firstPage.issues_total, 23);
    assert.strictEqual(firstPage.issues.length, 10);
    assert.strictEqual(secondPage.issues.length, 10);
    assert.strictEqual(lastPage.issues_offset, 20);
    assert.strictEqual(lastPage.issues.length, 3);
    assert.notStrictEqual(firstPage.issues[0].card_id, secondPage.issues[0].card_id);

    // Set code "MISSING" is not a PokéWallet code, so the first search is empty
    // and one name-only search is allowed. The number is read from the result.
    await reset();
    await addCard({ id: 'tcgdex-en-30th-151', name: 'Mewtwo ex', setId: 'MISSING', setName: '30th Celebration', number: '151' });
    const celebration = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(celebration.updated, 1);
    assert.strictEqual(celebration.requests, 2);
    assert.deepStrictEqual(hits.queries, ['Mewtwo ex MISSING', 'Mewtwo ex']);
    const sir = await db.get(`SELECT id, number, set_id, price_trend, price_source FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-151']);
    assert.strictEqual(sir.id, 'tcgdex-en-30th-151');
    assert.strictEqual(sir.number, '151');
    assert.strictEqual(sir.set_id, 'MISSING');
    assert.strictEqual(sir.price_trend, 40);
    assert.strictEqual(sir.price_source, 'pokewallet-tcgplayer');

    await reset();
    await addCard({ id: 'tcgdex-en-30th-003', name: 'Mewtwo', setId: '30th', setName: 'Celebrations: Classic Collection', number: '003', userId: 1 });
    const member = await db.get(`SELECT id FROM users WHERE username = 'member'`);
    const memberId = member ? member.id : (await db.run(
      `INSERT INTO users (username, password_hash, role, share_token, api_key) VALUES ('member', 'x', 'member', 'member-share', 'member-api-key')`
    )).lastID;
    if (!member) {
      await db.run(`INSERT INTO sessions (token, user_id, expires_at) VALUES ('member-token', ?, '2099-01-01')`, [memberId]);
      await db.run(`INSERT INTO sessions (token, user_id, expires_at) VALUES ('admin-token', 1, '2099-01-01')`);
    }
    await addCard({ id: 'tcgdex-en-cel-7', name: 'Pikachu', setId: 'CEL25', setName: 'Celebrations', number: '7', userId: memberId });
    mode = 'remaining-zero';
    const limited = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(limited.updated, 1);
    assert.strictEqual(limited.status, 'rate_limited');
    assert.strictEqual(hits.n, 1, 'the second card waits when the provider has no remaining requests');
    assert.strictEqual((await db.get(`SELECT user_id FROM collection WHERE card_id = ?`, ['tcgdex-en-cel-7'])).user_id, memberId);

    await reset();
    await addCard({ id: 'tcgdex-en-30th-003', name: 'Mewtwo', setId: '30th', setName: 'Celebrations: Classic Collection', number: '003' });
    await addCard({ id: 'tcgdex-en-cel-7', name: 'Pikachu', setId: 'CEL25', setName: 'Celebrations', number: '7' });
    mode = '429';
    const paused = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(paused.status, 'rate_limited');
    assert.strictEqual(hits.n, 1);
    const held = hits.n;
    mode = 'search';
    const whilePaused = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(whilePaused.status, 'rate_limited');
    assert.strictEqual(hits.n, held, 'Retry-After holds the next refresh');

    await reset();
    for (let i = 0; i < 89; i++) {
      await db.run(`INSERT INTO pokewallet_request (created_at) VALUES (?)`, [Date.now()]);
    }
    const simultaneous = await Promise.allSettled([
      api.searchCatalog('Alpha'),
      api.searchCatalog('Beta'),
    ]);
    assert.strictEqual(simultaneous.filter(result => result.status === 'fulfilled').length, 1);
    assert.strictEqual(simultaneous.filter(result => result.status === 'rejected' && result.reason.code === 'rate_limited').length, 1);
    assert.strictEqual(hits.n, 1, 'concurrent reservations must share the same request budget');

    await reset();
    await addCard({ id: 'tcgdex-en-30th-003', name: 'Mewtwo', setId: '30th', setName: 'Celebrations: Classic Collection', number: '003' });
    mode = '401';
    const rejected = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(rejected.status, 'key_rejected');
    assert.strictEqual((await db.get(`SELECT price_source, price_trend FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-003'])).price_trend, 0);
    assertNoSecret(rejected);
    const cachedSecrets = await db.get(`SELECT COUNT(*) AS n FROM pokewallet_cache WHERE body LIKE '%SHOULD_NOT_LEAK%'`);
    assert.strictEqual(cachedSecrets.n, 0);

    await reset();
    await db.run(`UPDATE app_settings SET price_refresh_days = 0 WHERE id = 1`);
    await addCard({ id: 'tcgdex-en-30th-003', name: 'Mewtwo', setId: '30th', setName: 'Celebrations: Classic Collection', number: '003' });
    const automatic = await api.updateCollectionPrices();
    assert.strictEqual(automatic.status, 'not_due');
    assert.strictEqual(hits.n, 0);
    const manual = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(manual.updated, 1);
    assert.ok(hits.n > 0);

    await reset();
    delete process.env.POKEWALLET_API_KEY;
    await addCard({ id: 'tcgdex-en-30th-003', name: 'Mewtwo', setId: '30th', setName: 'Celebrations: Classic Collection', number: '003' });
    const missing = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(missing.status, 'key_missing');
    assert.strictEqual(hits.n, 0);
    process.env.POKEWALLET_API_KEY = KEY;

    await reset();
    await addCard({ id: 'tcgdex-en-30th-003', name: 'Mewtwo', setId: '30th', setName: 'Celebrations: Classic Collection', number: '003' });
    delayPromise = new Promise(resolve => { releaseDelay = resolve; });
    mode = 'delay';
    const first = api.updateCollectionPrices({ force: true });
    const started = Date.now();
    while (hits.n < 1 && Date.now() - started < 2000) await new Promise(resolve => setTimeout(resolve, 10));
    assert.strictEqual(hits.n, 1);
    const second = await api.updateCollectionPrices({ force: true });
    assert.strictEqual(second.status, 'already_running');
    releaseDelay();
    const finished = await first;
    assert.strictEqual(finished.updated, 1);
    assert.strictEqual(hits.n, 1);

    await reset();
    await addCard({ id: 'tcgdex-en-cel-7', name: 'Pikachu', setId: 'CEL25', setName: 'Celebrations', number: '7', userId: memberId });
    const sealed = await api.mapManually('tcgdex-en-cel-7', sealedCard.id, false);
    assert.strictEqual(sealed.statusCode, 409);
    assert.strictEqual((await db.get(`SELECT price_trend, id FROM card_cache WHERE id = ?`, ['tcgdex-en-cel-7'])).price_trend, 0);
    const bad = await api.mapManually('tcgdex-en-cel-7', 'https://evil.example/card', false);
    assert.strictEqual(bad.statusCode, 400);
    const linked = await api.mapManually('tcgdex-en-cel-7', manualCard.id, false);
    assert.strictEqual(linked.applied, true);
    assert.strictEqual(linked.quote_currency, 'USD');
    const pikachu = await db.get(`SELECT * FROM card_cache WHERE id = ?`, ['tcgdex-en-cel-7']);
    assert.strictEqual(pikachu.id, 'tcgdex-en-cel-7');
    assert.strictEqual(pikachu.price_trend, 4.5);
    assert.strictEqual(pikachu.price_normal, 1.25);
    assert.strictEqual(pikachu.price_holofoil, 4.5);
    assert.strictEqual(pikachu.price_currency, 'USD');
    assert.strictEqual(pikachu.price_avg1, null);
    assert.strictEqual((await db.get(`SELECT user_id, position FROM collection WHERE card_id = ?`, ['tcgdex-en-cel-7'])).user_id, memberId);
    const cleared = await api.mapManually('tcgdex-en-cel-7', '', true);
    assert.strictEqual(cleared.applied, false);
    const restored = await db.get(`SELECT id, price_trend, price_source FROM card_cache WHERE id = ?`, ['tcgdex-en-cel-7']);
    assert.strictEqual(restored.id, 'tcgdex-en-cel-7');
    assert.strictEqual(restored.price_source, 'tcgdex');
    assert.strictEqual(restored.price_trend, null);

    await db.run(
      `INSERT INTO card_cache (id, name, set_id, set_name, number, game, language, price_trend, price_currency, price_source)
       VALUES ('tcgdex-en-30th-add', 'Mewtwo', '30th', 'Celebrations: Classic Collection', '003', 'pokemon', 'English', 0, 'EUR', 'tcgdex')`
    );
    hits.n = 0;
    hits.queries = [];
    const onAdd = await api.priceUnpricedCard(await db.get(`SELECT * FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-add']));
    assert.strictEqual(onAdd.updated, 1);
    assert.strictEqual((await db.get(`SELECT price_trend, price_source FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-add'])).price_trend, 12.5);
    const already = await api.priceUnpricedCard(await db.get(`SELECT * FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-add']));
    assert.strictEqual(already, null);
    const savedKey = process.env.POKEWALLET_API_KEY;
    process.env.POKEWALLET_API_KEY = '';
    await db.run(`UPDATE card_cache SET price_trend = 0, price_holofoil = NULL, price_normal = NULL, price_reverse_holofoil = NULL, price_1st_edition = NULL, price_source = 'tcgdex' WHERE id = ?`, ['tcgdex-en-30th-add']);
    const storedKey = await db.get(`SELECT pokewallet_api_key FROM app_settings WHERE id = 1`);
    await db.run(`UPDATE app_settings SET pokewallet_api_key = '' WHERE id = 1`);
    assert.strictEqual(await api.priceUnpricedCard(await db.get(`SELECT * FROM card_cache WHERE id = ?`, ['tcgdex-en-30th-add'])), null);
    process.env.POKEWALLET_API_KEY = savedKey;
    await db.run(`UPDATE app_settings SET pokewallet_api_key = ? WHERE id = 1`, [storedKey.pokewallet_api_key || '']);

    const express = require('express');
    const { authenticateToken } = require('../src/middleware/auth');
    const app = express();
    app.use(express.json());
    app.use('/api', authenticateToken);
    app.use('/api/settings', require('../src/routes/settings'));
    const web = await new Promise(resolve => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${web.address().port}`;
    const call = (token, method, urlPath, body) => fetch(base + urlPath, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    try {
      assert.strictEqual((await call(null, 'POST', '/api/settings/pokewallet/refresh')).status, 401);
      assert.strictEqual((await call('member-token', 'POST', '/api/settings/pokewallet/refresh', { user_id: 1 })).status, 403);
      assert.strictEqual((await call('member-api-key', 'POST', '/api/settings/pokewallet/refresh')).status, 403);
      assert.strictEqual((await call('member-token', 'GET', '/api/settings/pokewallet')).status, 403);
      const adminStatus = await call('admin-token', 'GET', '/api/settings/pokewallet');
      assert.strictEqual(adminStatus.status, 200);
      assert.strictEqual((await call('admin-token', 'GET', '/api/settings/pokewallet?offset=-1')).status, 400);
      assert.strictEqual((await call('admin-token', 'GET', '/api/settings/pokewallet?offset=10&offset=20')).status, 400);
      assert.strictEqual((await call('admin-token', 'GET', '/api/settings/pokewallet?offset=9007199254740992')).status, 400);
      const adminBody = await adminStatus.json();
      assert.strictEqual(adminBody.configured, true);
      assert.strictEqual(adminBody.key_source, 'environment');
      assert.strictEqual(adminBody.api_key, '');
      assertNoSecret(adminBody);
      const memberSettings = await call('member-token', 'GET', '/api/settings');
      assert.strictEqual(memberSettings.status, 200);
      assertNoSecret(await memberSettings.json());
      assert.strictEqual((await call('member-token', 'PUT', '/api/settings', { pokewallet_api_key: 'pk_test_MEMBER' })).status, 403);
      const rejected = await call('admin-token', 'PUT', '/api/settings', { pokewallet_api_key: 'not a key' });
      assert.strictEqual(rejected.status, 400);
      const saved = await call('admin-token', 'PUT', '/api/settings', { pokewallet_api_key: 'pk_test_STORED_KEY_abc' });
      assert.strictEqual(saved.status, 200);
      assertNoSecret(await saved.json());
      const storedStatus = await call('admin-token', 'GET', '/api/settings/pokewallet');
      const storedBody = await storedStatus.json();
      assert.strictEqual(storedBody.api_key, 'pk_test_STORED_KEY_abc');
      assert.strictEqual(storedBody.key_source, 'database');
      assert.ok(!JSON.stringify(await (await call('member-token', 'GET', '/api/settings')).json()).includes('STORED_KEY'));
      hits.keys = [];
      const adminRefresh = await call('admin-token', 'POST', '/api/settings/pokewallet/refresh', { user_id: 999 });
      assert.strictEqual(adminRefresh.status, 200);
      assertNoSecret(await adminRefresh.json());
      assert.ok(hits.keys.includes('pk_test_STORED_KEY_abc'), `stored key was not sent: ${hits.keys.join(',')}`);
      assert.ok(!hits.keys.includes(KEY));
      assert.strictEqual((await db.get(`SELECT user_id FROM collection WHERE card_id = ?`, ['tcgdex-en-cel-7'])).user_id, memberId);
    } finally {
      await new Promise(resolve => web.close(resolve));
    }

    assert.ok(logs.every(line => !line.includes('SHOULD_NOT_LEAK')), `log leaked the key: ${logs.join('\n')}`);
    console.log('pokewallet.test.js: all assertions passed');
  } finally {
    console.warn = warn;
    console.error = error;
    await new Promise(resolve => server.close(resolve));
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + suffix, { force: true });
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
