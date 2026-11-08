'use strict';

const DAY = 86400000;
const RETRY = 900000;
const MAX_RATE_AGE = 7 * DAY;
const ENDPOINT = 'https://api.frankfurter.dev/v2/rates';

function currency(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new TypeError('Currency must be a three-letter code');
  return code;
}

function validateRows(rows, now) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Empty FX response');
  const rates = {};
  for (const row of rows) {
    const quote = currency(row.quote);
    const timestamp = Date.parse(`${row.date}T00:00:00Z`);
    if (row.base !== 'USD' || quote === 'USD' || !Number.isFinite(row.rate) || row.rate <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(timestamp) ||
        timestamp > now + DAY || now - timestamp > MAX_RATE_AGE) continue;
    rates[quote] = { rate: row.rate, date: row.date };
  }
  if (!Object.keys(rates).length) throw new Error('No valid FX rates');
  return rates;
}

function createCurrencyService({ db, get, now = Date.now }) {
  let schema;
  let cache;
  let pending;
  let retryAfter = 0;
  let refreshFailed = false;

  async function load() {
    if (!schema) {
      schema = db.run(`CREATE TABLE IF NOT EXISTS fx_rate_cache (
        id INTEGER PRIMARY KEY CHECK (id = 1), fetched_at INTEGER NOT NULL, payload TEXT NOT NULL
      )`).catch(error => { schema = null; throw error; });
    }
    await schema;
    if (cache) return;
    const row = await db.get('SELECT fetched_at, payload FROM fx_rate_cache WHERE id = 1');
    if (!row) return;
    try {
      const rows = JSON.parse(row.payload);
      const rates = validateRows(rows, now());
      const fetchedAt = Number(row.fetched_at);
      if (Number.isFinite(fetchedAt) && fetchedAt <= now()) cache = { rates, fetchedAt };
    } catch { /* Invalid persisted data is replaced only by a validated response. */ }
  }

  async function refreshIfDue() {
    await load();
    if (cache && now() - cache.fetchedAt < DAY) return;
    if (pending) return pending;
    if (now() < retryAfter) return;
    pending = (async () => {
      try {
        const response = await get(ENDPOINT, {
          params: { base: 'USD' }, timeout: 8000,
          headers: { Accept: 'application/json', 'User-Agent': 'Bindarr-FX' },
        });
        const rates = validateRows(response.data, now());
        const fetchedAt = now();
        await db.run(`INSERT INTO fx_rate_cache (id, fetched_at, payload) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload`,
        [fetchedAt, JSON.stringify(response.data)]);
        cache = { rates, fetchedAt };
        refreshFailed = false;
        retryAfter = 0;
      } catch {
        refreshFailed = true;
        retryAfter = now() + RETRY;
      }
    })();
    try { await pending; } finally { pending = null; }
  }

  async function convertCents(amountCents, from, to = 'USD') {
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
      throw new TypeError('Amount must be nonnegative integer cents');
    }
    from = currency(from);
    to = currency(to);
    const original = { originalCents: amountCents, originalCurrency: from, currency: to };
    if (from === to) {
      return { ...original, convertedCents: amountCents, rate: 1, rateDates: [], stale: false, source: 'identity' };
    }
    await refreshIfDue();
    const base = { rate: 1, date: null };
    const left = from === 'USD' ? base : cache && cache.rates[from];
    const right = to === 'USD' ? base : cache && cache.rates[to];
    const dates = [left && left.date, right && right.date].filter(Boolean);
    if (!left || !right || dates.some(date => now() - Date.parse(`${date}T00:00:00Z`) > MAX_RATE_AGE)) {
      return { ...original, convertedCents: null, rate: null, rateDates: dates, stale: true,
        source: 'frankfurter', reason: 'rate_unavailable' };
    }
    const rate = right.rate / left.rate;
    const convertedCents = Math.round(amountCents * rate);
    if (!Number.isSafeInteger(convertedCents)) throw new RangeError('Converted amount is too large');
    return { ...original, convertedCents, rate, rateDates: [...new Set(dates)].sort(),
      fetchedAt: new Date(cache.fetchedAt).toISOString(), source: 'frankfurter',
      stale: refreshFailed || now() - cache.fetchedAt >= DAY ||
        dates.some(date => now() - Date.parse(`${date}T00:00:00Z`) > 4 * DAY) };
  }

  return { convertCents, refreshIfDue };
}

let singleton;
function service() {
  if (!singleton) singleton = createCurrencyService({
    db: require('../db'), get: (...args) => require('axios').get(...args),
  });
  return singleton;
}

module.exports = { createCurrencyService,
  convertCents: (...args) => service().convertCents(...args),
  refreshIfDue: () => service().refreshIfDue(),
};
