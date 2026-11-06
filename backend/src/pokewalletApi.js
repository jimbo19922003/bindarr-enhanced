'use strict';

// PokéWallet prices for cards this install already has.
//
// The card_cache id is the collection's identity (tcgdex-en-30th-003 and the
// rest). This module never updates that id, the set, the number, or any
// collection row. It stores a separate mapping and, only when that mapping is
// unambiguous, copies one currency's quote onto the existing price columns.
//
// A positive price from another source is left alone. TCGCSV still runs first
// and keeps a quote it managed to write. PokéWallet fills the zeros that a
// blocked or empty upstream left behind, and it can refresh a quote it wrote
// itself. Missing data does not replace a number that is already there.
//
// Docs checked 2026-11-06: https://pokewallet.io/api-docs
// Auth is X-API-Key. Free tier is 100 requests/hour and 1,000/day. Search and
// card detail are the endpoints this uses; both are on the free tier. Bulk
// set prices are a paid endpoint and are not called.

const axios = require('axios');
const { createHash } = require('crypto');
const db = require('./db');
const { parseSqliteUtc, recordPrice, shouldSweepPrices, markPricesSwept, priceRefreshDays } = require('./utils/priceHelpers');
const match = require('./utils/pokewalletMatch');

const BASE = 'https://api.pokewallet.io';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CACHE_TTL_MS = DAY_MS;
// Stay under the published free tier until a response tells us the real remaining
// allowance. A paid plan's own remaining-hour header replaces this fallback.
const LOCAL_HOUR_CAP = 90;
const LOCAL_DAY_CAP = 900;
const MAX_REQUESTS_PER_RUN = 25;
const OPEN_STATUSES = ['ambiguous', 'unmatched', 'unpriced', 'failed', 'currency_conflict', 'variant_unconfirmed'];

const client = axios.create({
  baseURL: BASE,
  timeout: 12000,
  maxRedirects: 0,
  headers: {
    Accept: 'application/json',
    'User-Agent': `Bindarr-Enhanced/${require('../package.json').version} (self-hosted collection manager)`,
  },
  // Never throw Axios errors. Their config object carries X-API-Key, and a
  // route that logged the rejection would write the credential out.
  validateStatus: () => true,
});

const pending = new Map();
let inflight = false;

const hasKey = () => !!(process.env.POKEWALLET_API_KEY || '').trim();

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function emptyReport() {
  return {
    at: new Date().toISOString(),
    status: 'complete',
    examined: 0,
    updated: 0,
    skipped_priced: 0,
    skipped_language: 0,
    unmatched: 0,
    ambiguous: 0,
    unpriced: 0,
    variant_unconfirmed: 0,
    currency_conflict: 0,
    failed: 0,
    cached: 0,
    requests: 0,
    waiting: 0,
    issues: [],
  };
}

function headerInt(headers, name) {
  if (!headers) return null;
  const raw = headers[name];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function retryDelayMs(header) {
  if (header == null || header === '') return HOUR_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 1), DAY_MS / 1000) * 1000;
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 1000), DAY_MS);
  return HOUR_MS;
}

function cacheKeyFor(key, path, params) {
  const scope = createHash('sha256').update(key).digest('hex').slice(0, 16);
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params || {}).sort()) {
    if (value != null && value !== '') query.set(name, String(value));
  }
  return `${scope} GET ${path}?${query.toString()}`;
}

async function allowance() {
  const now = Date.now();
  const budget = await db.get(
    `SELECT remaining_hour, remaining_day, observed_at, paused_until FROM pokewallet_budget WHERE id = 1`
  );
  if (budget && budget.paused_until && now < budget.paused_until) {
    return { ok: false, reason: 'rate_limited', retryAt: new Date(budget.paused_until).toISOString() };
  }
  const hourCount = (await db.get(
    `SELECT COUNT(*) AS n FROM pokewallet_request WHERE created_at > ?`, [now - HOUR_MS]
  )).n;
  const dayCount = (await db.get(
    `SELECT COUNT(*) AS n FROM pokewallet_request WHERE created_at > ?`, [now - DAY_MS]
  )).n;
  let hourLeft = LOCAL_HOUR_CAP - hourCount;
  let dayLeft = LOCAL_DAY_CAP - dayCount;
  if (budget && budget.observed_at != null && (budget.remaining_hour != null || budget.remaining_day != null)) {
    const since = (await db.get(
      `SELECT COUNT(*) AS n FROM pokewallet_request WHERE created_at > ?`, [budget.observed_at]
    )).n;
    if (budget.remaining_hour != null) hourLeft = budget.remaining_hour - since;
    if (budget.remaining_day != null) dayLeft = budget.remaining_day - since;
  }
  if (hourLeft <= 0 || dayLeft <= 0) return { ok: false, reason: 'rate_limited', retryAt: null };
  return { ok: true };
}

async function rememberResponse(createdAt, headers) {
  const hour = headerInt(headers, 'x-ratelimit-remaining-hour');
  const day = headerInt(headers, 'x-ratelimit-remaining-day');
  await db.run(
    `INSERT INTO pokewallet_budget (id, remaining_hour, remaining_day, observed_at, paused_until)
     VALUES (1, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       remaining_hour = COALESCE(excluded.remaining_hour, pokewallet_budget.remaining_hour),
       remaining_day = COALESCE(excluded.remaining_day, pokewallet_budget.remaining_day),
       observed_at = excluded.observed_at,
       paused_until = NULL`,
    [hour, day, createdAt]
  );
}

async function pauseFor(ms) {
  const until = Date.now() + ms;
  await db.run(
    `INSERT INTO pokewallet_budget (id, paused_until) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET paused_until = excluded.paused_until`,
    [until]
  );
  return new Date(until).toISOString();
}

async function request(path, params) {
  const key = (process.env.POKEWALLET_API_KEY || '').trim();
  if (!key) throw fail('key_missing');
  const cacheKey = cacheKeyFor(key, path, params);
  if (pending.has(cacheKey)) return pending.get(cacheKey);
  const work = (async () => {
    const cached = await db.get(`SELECT body, fetched_at FROM pokewallet_cache WHERE request = ?`, [cacheKey]);
    if (cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
      return { body: JSON.parse(cached.body), cached: true };
    }
    const allowed = await allowance();
    if (!allowed.ok) {
      const err = fail('rate_limited');
      err.retryAt = allowed.retryAt || null;
      throw err;
    }
    const createdAt = Date.now();
    await db.run(`INSERT INTO pokewallet_request (created_at) VALUES (?)`, [createdAt]);
    await db.run(`DELETE FROM pokewallet_request WHERE created_at < ?`, [createdAt - 2 * DAY_MS]);
    let response;
    try {
      response = await client.get(path, { params, headers: { 'X-API-Key': key } });
    } catch {
      throw fail('upstream');
    }
    const status = response.status;
    if (status >= 300 && status < 400) throw fail('upstream');
    if (status === 401) throw fail('key_rejected');
    if (status === 403) throw fail('plan_required');
    if (status === 404) throw fail('not_found');
    if (status === 429 || status === 503) {
      const retryAt = await pauseFor(retryDelayMs(response.headers && response.headers['retry-after']));
      const err = fail('rate_limited');
      err.retryAt = retryAt;
      throw err;
    }
    if (status !== 200 || !response.data || typeof response.data !== 'object') throw fail('upstream');
    const body = response.data;
    if (JSON.stringify(body).includes(key)) throw fail('upstream');
    await rememberResponse(createdAt, response.headers);
    await db.run(
      `INSERT INTO pokewallet_cache (request, body, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(request) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
      [cacheKey, JSON.stringify(body), Date.now()]
    );
    await db.run(`DELETE FROM pokewallet_cache WHERE request IN (
      SELECT request FROM pokewallet_cache ORDER BY fetched_at DESC LIMIT -1 OFFSET 512)`);
    return { body, cached: false };
  })();
  pending.set(cacheKey, work);
  try { return await work; } finally { pending.delete(cacheKey); }
}

function hasPositivePrice(row) {
  return ['price_trend', 'price_normal', 'price_holofoil', 'price_reverse_holofoil', 'price_1st_edition']
    .some(column => Number(row[column]) > 0);
}

function ownedByPokewallet(row) {
  return typeof row.price_source === 'string' && row.price_source.startsWith('pokewallet');
}

async function saveMap(row) {
  await db.run(
    `INSERT INTO pokewallet_map (
       card_id, provider_card_id, status, reason, product_type, quote_currency, quote_amount,
       quote_updated_at, candidates_json, manual, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(card_id) DO UPDATE SET
       provider_card_id = excluded.provider_card_id,
       status = excluded.status,
       reason = excluded.reason,
       product_type = excluded.product_type,
       quote_currency = excluded.quote_currency,
       quote_amount = excluded.quote_amount,
       quote_updated_at = excluded.quote_updated_at,
       candidates_json = excluded.candidates_json,
       manual = excluded.manual,
       updated_at = excluded.updated_at`,
    [
      row.card_id, row.provider_card_id || null, row.status, row.reason || null, row.product_type || null,
      row.quote_currency || null, row.quote_amount ?? null, row.quote_updated_at || null,
      row.candidates_json || null, row.manual ? 1 : 0, new Date().toISOString(),
    ]
  );
}

// The WHERE clause is the precedence rule: another source's positive quote
// cannot be replaced, including by a request that raced ahead of TCGCSV.
async function applyQuote(card, quote) {
  if (ownedByPokewallet(card) && hasPositivePrice(card) && card.price_currency && card.price_currency !== quote.currency) {
    return false;
  }
  const result = await db.run(
    `UPDATE card_cache
        SET price_trend = ?, price_normal = ?, price_holofoil = ?, price_reverse_holofoil = ?,
            price_1st_edition = ?, price_avg1 = ?, price_avg7 = ?, price_avg30 = ?,
            price_currency = ?, price_source = ?,
            tcgplayer_url = COALESCE(tcgplayer_url, ?),
            cardmarket_url = COALESCE(cardmarket_url, ?),
            tcgplayer_product_id = COALESCE(tcgplayer_product_id, ?),
            last_updated = CURRENT_TIMESTAMP
      WHERE id = ?
        AND (
          price_source LIKE 'pokewallet%'
          OR (
            COALESCE(price_trend, 0) <= 0
            AND COALESCE(price_normal, 0) <= 0
            AND COALESCE(price_holofoil, 0) <= 0
            AND COALESCE(price_reverse_holofoil, 0) <= 0
            AND COALESCE(price_1st_edition, 0) <= 0
          )
        )`,
    [
      quote.price_trend, quote.price_normal, quote.price_holofoil, quote.price_reverse_holofoil,
      quote.price_1st_edition, quote.price_avg1, quote.price_avg7, quote.price_avg30,
      quote.currency, quote.source, quote.tcgplayer_url, quote.cardmarket_url, quote.tcgplayer_product_id,
      card.id,
    ]
  );
  if (!result || result.changes !== 1) return false;
  await recordPrice(card.id, quote.price_trend);
  return true;
}

async function clearPokewalletPrice(cardId) {
  await db.run(
    `UPDATE card_cache
        SET price_trend = NULL, price_normal = NULL, price_holofoil = NULL,
            price_reverse_holofoil = NULL, price_1st_edition = NULL,
            price_avg1 = NULL, price_avg7 = NULL, price_avg30 = NULL,
            price_source = 'tcgdex', price_currency = 'EUR', last_updated = CURRENT_TIMESTAMP
      WHERE id = ? AND price_source LIKE 'pokewallet%'`,
    [cardId]
  );
}

function pushIssue(report, card, status, reason, candidates) {
  if (report.issues.length >= 40) return;
  report.issues.push({
    card_id: card.id,
    name: card.name || '',
    number: card.number || '',
    set_name: card.set_name || '',
    status,
    reason: reason || null,
    candidates: candidates || [],
  });
}

async function ownedCards() {
  return db.all(
    `SELECT cc.id, cc.name, cc.set_id, cc.set_name, cc.number, cc.language,
            cc.price_trend, cc.price_normal, cc.price_holofoil, cc.price_reverse_holofoil,
            cc.price_1st_edition, cc.price_currency, cc.price_source, cc.last_updated
       FROM card_cache cc
      WHERE cc.game = 'pokemon'
        AND cc.id LIKE 'tcgdex-%'
        AND cc.id IN (SELECT card_id FROM collection UNION SELECT card_id FROM deck_cards)
      ORDER BY cc.id`
  );
}

async function note(card, status, reason, extra) {
  await saveMap({
    card_id: card.id,
    provider_card_id: extra && extra.provider_card_id,
    status,
    reason,
    product_type: extra && extra.product_type,
    quote_currency: extra && extra.quote_currency,
    quote_amount: extra && extra.quote_amount,
    quote_updated_at: extra && extra.quote_updated_at,
    candidates_json: JSON.stringify((extra && extra.candidates) || []),
    manual: extra && extra.manual,
  });
}

async function priceOne(card, report, force) {
  report.examined += 1;
  const mapping = await db.get(`SELECT provider_card_id, manual FROM pokewallet_map WHERE card_id = ?`, [card.id]);
  const manual = !!(mapping && mapping.manual && mapping.provider_card_id);
  if (!manual && card.language !== 'English') {
    report.skipped_language += 1;
    await note(card, 'skipped_language', 'english_only', {
      provider_card_id: mapping && mapping.provider_card_id,
      manual: mapping && mapping.manual,
    });
    return 'ok';
  }
  if (!manual && hasPositivePrice(card) && !ownedByPokewallet(card)) {
    report.skipped_priced += 1;
    await note(card, 'skipped_priced', 'existing_quote', {
      provider_card_id: mapping && mapping.provider_card_id,
      manual: mapping && mapping.manual,
    });
    return 'ok';
  }
  if (!force && ownedByPokewallet(card) && hasPositivePrice(card)) {
    const age = Date.now() - parseSqliteUtc(card.last_updated).getTime();
    if (age >= 0 && age < 20 * HOUR_MS) {
      report.cached += 1;
      return 'ok';
    }
  }
  let fetched;
  try {
    if (mapping && mapping.manual && mapping.provider_card_id) {
      fetched = await request('/cards/' + encodeURIComponent(mapping.provider_card_id));
    } else {
      const query = match.searchQuery(card);
      if (query.length < 2) {
        report.unmatched += 1;
        await note(card, 'unmatched', 'query_too_short');
        pushIssue(report, card, 'unmatched', 'query_too_short', []);
        return 'ok';
      }
      fetched = await request('/search', { q: query, limit: 20, page: 1 });
    }
  } catch (err) {
    if (err.code === 'not_found') {
      report.unmatched += 1;
      await note(card, 'unmatched', 'not_found');
      pushIssue(report, card, 'unmatched', 'not_found', []);
      return 'ok';
    }
    if (err.code === 'rate_limited' || err.code === 'key_rejected' || err.code === 'key_missing' || err.code === 'plan_required') {
      throw err;
    }
    report.failed += 1;
    await note(card, 'failed', 'upstream');
    pushIssue(report, card, 'failed', 'upstream', []);
    console.warn(`PokéWallet ${card.id}: upstream`);
    return 'failed';
  }
  if (!fetched.cached) report.requests += 1;
  else report.cached += 1;
  const manualFetch = !!(mapping && mapping.manual && mapping.provider_card_id);
  return settle(card, report, fetched.body, manualFetch, mapping && mapping.provider_card_id);
}

async function settle(card, report, body, manual, providerCardId) {
  const direct = body && body.card_info ? [body] : null;
  const results = direct || (Array.isArray(body && body.results) ? body.results : null);
  if (!results) {
    report.failed += 1;
    await note(card, 'failed', 'upstream');
    pushIssue(report, card, 'failed', 'upstream', []);
    return 'failed';
  }
  const decision = manual
    ? { status: 'matched', matches: results, candidates: results.slice(0, 1).map(match.summarizeCandidate), reason: null }
    : match.matchSearchResults(card, results, body && body.pagination && body.pagination.total);
  if (decision.status !== 'matched') {
    report[decision.status] = (report[decision.status] || 0) + 1;
    await note(card, decision.status, decision.reason, { candidates: decision.candidates, manual: false });
    pushIssue(report, card, decision.status, decision.reason, decision.candidates);
    return 'ok';
  }
  const quote = match.extractQuote(decision.matches[0]);
  if (!quote.ok) {
    const status = quote.reason === 'variant_unconfirmed' ? 'variant_unconfirmed'
      : quote.reason === 'not_a_card' ? 'failed' : 'unpriced';
    report[status] += 1;
    await note(card, status, quote.reason, {
      provider_card_id: decision.matches[0] && decision.matches[0].id,
      candidates: decision.candidates,
      manual,
    });
    pushIssue(report, card, status, quote.reason, decision.candidates);
    return 'ok';
  }
  if (ownedByPokewallet(card) && hasPositivePrice(card) && card.price_currency && card.price_currency !== quote.currency) {
    report.currency_conflict += 1;
    await note(card, 'currency_conflict', 'currency_differs', {
      provider_card_id: decision.matches[0].id,
      quote_currency: quote.currency,
      quote_amount: quote.price_trend,
      quote_updated_at: quote.updated_at,
      manual,
    });
    pushIssue(report, card, 'currency_conflict', 'currency_differs', decision.candidates);
    return 'ok';
  }
  const applied = await applyQuote(card, quote);
  if (!applied) {
    report.skipped_priced += 1;
    await note(card, 'skipped_priced', 'existing_quote', {
      provider_card_id: decision.matches[0].id,
      quote_currency: quote.currency,
      quote_amount: quote.price_trend,
      manual,
    });
    return 'ok';
  }
  report.updated += 1;
  await note(card, manual ? 'manual' : 'matched', null, {
    provider_card_id: providerCardId || decision.matches[0].id,
    product_type: 'card',
    quote_currency: quote.currency,
    quote_amount: quote.price_trend,
    quote_updated_at: quote.updated_at,
    candidates: decision.candidates,
    manual,
  });
  return 'ok';
}

async function saveReport(report) {
  await db.run(`UPDATE app_settings SET pokewallet_last_report = ? WHERE id = 1`, [JSON.stringify(report)]);
}

async function runRefresh(force) {
  if (!hasKey()) {
    console.log('Skipping PokéWallet price update: POKEWALLET_API_KEY is not set.');
    const report = emptyReport();
    report.status = 'key_missing';
    if (force) await saveReport(report);
    return report;
  }
  if (!force && !(await shouldSweepPrices('pokewallet'))) return { status: 'not_due' };

  const report = emptyReport();
  const cards = await ownedCards();
  let stop = null;
  let upstreamStreak = 0;
  for (let i = 0; i < cards.length; i++) {
    if (report.requests >= MAX_REQUESTS_PER_RUN) {
      report.waiting = cards.length - i;
      report.status = 'partial';
      break;
    }
    try {
      const outcome = await priceOne(cards[i], report, force);
      if (outcome === 'failed') {
        upstreamStreak += 1;
        if (upstreamStreak >= 3) {
          report.waiting = cards.length - i - 1;
          stop = 'upstream';
          break;
        }
      } else {
        upstreamStreak = 0;
      }
    } catch (err) {
      report.waiting = cards.length - i;
      stop = err.code || 'upstream';
      if (err.retryAt) report.retry_at = err.retryAt;
      console.warn(`PokéWallet refresh stopped: ${stop}`);
      break;
    }
  }
  if (stop) report.status = stop;
  else if (report.status !== 'partial') report.status = 'complete';
  if (report.status === 'complete') await markPricesSwept('pokewallet');
  await saveReport(report);
  return report;
}

async function updateCollectionPrices(opts = {}) {
  const force = !!(opts && opts.force);
  if (inflight) {
    const current = await status();
    return { status: 'already_running', last_report: current.last_report, issues: current.issues };
  }
  inflight = true;
  try {
    return await runRefresh(force);
  } finally {
    inflight = false;
  }
}

function parseCandidates(text) {
  try {
    const parsed = JSON.parse(text || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

async function openIssues() {
  const rows = await db.all(
    `SELECT m.card_id, m.status, m.reason, m.candidates_json,
            cc.name, cc.number, cc.set_name
       FROM pokewallet_map m
       JOIN card_cache cc ON cc.id = m.card_id
      WHERE m.status IN (${OPEN_STATUSES.map(() => '?').join(', ')})
      ORDER BY cc.name
      LIMIT 40`,
    OPEN_STATUSES
  );
  return rows.map(row => ({
    card_id: row.card_id,
    name: row.name || '',
    number: row.number || '',
    set_name: row.set_name || '',
    status: row.status,
    reason: row.reason || null,
    candidates: parseCandidates(row.candidates_json),
  }));
}

async function recentQuotes() {
  return db.all(
    `SELECT cc.id AS card_id, cc.name, cc.number, cc.set_name, cc.price_trend, cc.price_currency,
            m.provider_card_id, m.manual
       FROM card_cache cc
       LEFT JOIN pokewallet_map m ON m.card_id = cc.id
      WHERE cc.price_source LIKE 'pokewallet%'
      ORDER BY m.updated_at DESC
      LIMIT 15`
  );
}

async function status() {
  const days = await priceRefreshDays();
  const budget = await db.get(
    `SELECT remaining_hour, remaining_day, paused_until FROM pokewallet_budget WHERE id = 1`
  );
  const row = await db.get(`SELECT pokewallet_last_report FROM app_settings WHERE id = 1`);
  let last = null;
  try { last = row && row.pokewallet_last_report ? JSON.parse(row.pokewallet_last_report) : null; }
  catch { last = null; }
  if (last && last.issues) delete last.issues;
  return {
    configured: hasKey(),
    automatic_enabled: days !== 0,
    paused_until: budget && budget.paused_until && budget.paused_until > Date.now()
      ? new Date(budget.paused_until).toISOString() : null,
    remaining_hour: budget ? budget.remaining_hour : null,
    remaining_day: budget ? budget.remaining_day : null,
    last_report: last,
    issues: await openIssues(),
    recent: await recentQuotes(),
  };
}

async function mapManually(cardId, providerCardId, clear) {
  if (inflight) return { error: 'A PokéWallet refresh is already running.', statusCode: 409 };
  const card = await db.get(
    `SELECT id, name, set_id, set_name, number, language, game,
            price_trend, price_normal, price_holofoil, price_reverse_holofoil, price_1st_edition,
            price_currency, price_source
       FROM card_cache WHERE id = ?`,
    [cardId]
  );
  if (!card || card.game !== 'pokemon' || !String(card.id).startsWith('tcgdex-')) {
    return { error: 'That card is not a TCGdex Pokémon entry on this instance.', statusCode: 404 };
  }
  inflight = true;
  try {
    if (clear) {
      await clearPokewalletPrice(card.id);
      await note(card, 'unmatched', 'cleared', { manual: false, candidates: [] });
      return { ok: true, card_id: card.id, status: 'unmatched', applied: false };
    }
    if (!match.isProviderCardId(providerCardId)) {
      return { error: 'provider_card_id must be a PokéWallet card id.', statusCode: 400 };
    }
    if (!hasKey()) return { error: 'POKEWALLET_API_KEY is not set on the server.', statusCode: 400 };
    if (hasPositivePrice(card) && !ownedByPokewallet(card)) {
      return { error: 'This card already has a price from another source. It was left unchanged.', statusCode: 409 };
    }
    let fetched;
    try {
      fetched = await request('/cards/' + encodeURIComponent(providerCardId));
    } catch (err) {
      const reason = err.code || 'upstream';
      await note(card, 'failed', reason, { provider_card_id: providerCardId, manual: true });
      return { error: 'PokéWallet could not load that product.', statusCode: reason === 'not_found' ? 404 : 502 };
    }
    const body = fetched.body;
    if (!body || body.card_info?.product_type !== 'card') {
      await note(card, 'failed', 'not_a_card', { provider_card_id: providerCardId, manual: true });
      return { error: 'That PokéWallet product is not a single card, so no price was written.', statusCode: 409 };
    }
    const quote = match.extractQuote(body);
    if (!quote.ok) {
      await note(card, quote.reason === 'variant_unconfirmed' ? 'variant_unconfirmed' : 'unpriced', quote.reason, {
        provider_card_id: providerCardId, manual: true,
      });
      return { error: 'That product has no usable single-card price, so nothing was written.', statusCode: 409 };
    }
    const applied = await applyQuote(card, quote);
    await note(card, applied ? 'manual' : 'skipped_priced', applied ? null : 'existing_quote', {
      provider_card_id: providerCardId,
      product_type: 'card',
      quote_currency: quote.currency,
      quote_amount: quote.price_trend,
      quote_updated_at: quote.updated_at,
      manual: true,
    });
    return {
      ok: true,
      card_id: card.id,
      status: applied ? 'manual' : 'skipped_priced',
      applied,
      quote_currency: quote.currency,
      quote_amount: quote.price_trend,
    };
  } finally {
    inflight = false;
  }
}

function resetForTests() {
  inflight = false;
  pending.clear();
}

module.exports = {
  BASE,
  MAX_REQUESTS_PER_RUN,
  client,
  hasKey,
  updateCollectionPrices,
  status,
  mapManually,
  resetForTests,
};
