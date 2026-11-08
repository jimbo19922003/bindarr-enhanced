'use strict';

const DAY = 86400000;
const RETRY = 900000;
const MAX_RATE_AGE = 7 * DAY;
const ENDPOINT = 'https://api.frankfurter.dev/v2/providers/ecb/rates';
const ECB_ENDPOINT = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

function currency(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new TypeError('Currency must be a three-letter code');
  return code;
}

function validateRows(rows, now) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('FX_EMPTY_RESPONSE');
  const rates = {};
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !/^[A-Z]{3}$/.test(row.quote || '')) continue;
    const timestamp = Date.parse(`${row.date}T00:00:00Z`);
    if (row.base !== 'USD' || row.quote === 'USD' || !Number.isFinite(row.rate) || row.rate <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') || !Number.isFinite(timestamp) ||
        new Date(timestamp).toISOString().slice(0, 10) !== row.date ||
        timestamp > now || now - timestamp > MAX_RATE_AGE) continue;
    rates[row.quote] = { rate: row.rate, date: row.date, source: row.source || 'frankfurter-ecb' };
  }
  if (!Object.keys(rates).length) throw new Error('FX_NO_FRESH_VALID_RATES');
  return rates;
}

function parseEcb(xml) {
  if (typeof xml !== 'string') throw new Error('ECB_INVALID_RESPONSE');
  const date = xml.match(/\btime=['"](\d{4}-\d{2}-\d{2})['"]/);
  if (!date) throw new Error('ECB_DATE_MISSING');
  const euroRates = { EUR: 1 };
  for (const tag of xml.matchAll(/<(?:[A-Za-z]+:)?Cube\b([^>]*)>/g)) {
    const code = tag[1].match(/\bcurrency=['"]([A-Z]{3})['"]/);
    const amount = tag[1].match(/\brate=['"]([0-9.eE+\-]+)['"]/);
    if (!code || !amount) continue;
    const rate = Number(amount[1]);
    if (Number.isFinite(rate) && rate > 0) euroRates[code[1]] = rate;
  }
  if (!(euroRates.USD > 0)) throw new Error('ECB_USD_MISSING');
  return Object.entries(euroRates).filter(([code]) => code !== 'USD').map(([quote, rate]) => ({
    base: 'USD', quote, rate: rate / euroRates.USD, date: date[1], source: 'ecb',
  }));
}

function createCurrencyService({ db, get, now = Date.now }) {
  let schema;
  let cache;
  let pending;
  let retryAfter = 0;
  let refreshFailed = false;

  async function load() {
    if (!schema) schema = db.run(`CREATE TABLE IF NOT EXISTS fx_rate_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1), fetched_at INTEGER NOT NULL, payload TEXT NOT NULL
    )`).catch(error => { schema = null; throw error; });
    await schema;
    if (cache) return;
    const row = await db.get('SELECT fetched_at, payload FROM fx_rate_cache WHERE id = 1');
    if (!row) return;
    try {
      const rates = validateRows(JSON.parse(row.payload), now());
      const fetchedAt = Number(row.fetched_at);
      if (Number.isFinite(fetchedAt) && fetchedAt <= now()) cache = { rates, fetchedAt };
    } catch { /* Retry an invalid or expired persisted cache from the network. */ }
  }

  async function requestRates() {
    const options = { timeout: 8000, maxContentLength: 1048576,
      headers: { Accept: 'application/json', 'User-Agent': 'Bindarr-FX' } };
    try {
      const response = await get(ENDPOINT, { ...options, params: { base: 'USD', quotes: 'EUR,GBP,CAD,AUD,JPY' } });
      const rates = validateRows(response.data, now());
      return { rows: response.data, rates };
    } catch {
      // An invalid or stale primary response is a failure too, not a reason to
      // repeatedly cache an unusable response and skip the fallback.
      const response = await get(ECB_ENDPOINT, { ...options, responseType: 'text',
        headers: { ...options.headers, Accept: 'application/xml,text/xml' } });
      const rows = parseEcb(response.data);
      return { rows, rates: validateRows(rows, now()) };
    }
  }

  async function refreshIfDue() {
    await load();
    if (cache && now() - cache.fetchedAt < DAY) return;
    if (pending) return pending;
    if (now() < retryAfter) return;
    pending = (async () => {
      try {
        const { rows, rates } = await requestRates();
        const fetchedAt = now();
        await db.run(`INSERT INTO fx_rate_cache (id, fetched_at, payload) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload`,
        [fetchedAt, JSON.stringify(rows)]);
        cache = { rates, fetchedAt };
        refreshFailed = false;
        retryAfter = 0;
      } catch {
        refreshFailed = true;
        retryAfter = now() + RETRY;
        console.warn('FX_REFRESH_FAILED: primary/ECB retrieval or cache persistence failed; retaining any usable cached rates, retrying in 15 minutes.');
      }
    })();
    try { await pending; } finally { pending = null; }
  }

  async function convertCents(amountCents, from, to = 'USD') {
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new TypeError('Amount must be nonnegative integer cents');
    from = currency(from);
    to = currency(to);
    const original = { originalCents: amountCents, originalCurrency: from, currency: to };
    if (from === to) return { ...original, convertedCents: amountCents, rate: 1, rateDates: [], stale: false, source: 'identity' };
    await refreshIfDue();
    const base = { rate: 1, date: null, source: 'identity' };
    const left = from === 'USD' ? base : cache && cache.rates[from];
    const right = to === 'USD' ? base : cache && cache.rates[to];
    const dates = [left && left.date, right && right.date].filter(Boolean);
    if (!left || !right || dates.some(date => now() - Date.parse(`${date}T00:00:00Z`) > MAX_RATE_AGE)) {
      return { ...original, convertedCents: null, rate: null, rateDates: dates, stale: true,
        source: 'unavailable', reason: 'rate_unavailable' };
    }
    const rate = right.rate / left.rate;
    const convertedCents = Math.round(amountCents * rate);
    if (!Number.isSafeInteger(convertedCents)) throw new RangeError('Converted amount is too large');
    return { ...original, convertedCents, rate, rateDates: [...new Set(dates)].sort(),
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
      source: from === 'USD' ? right.source : left.source,
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
module.exports = { createCurrencyService, parseEcb,
  convertCents: (...args) => service().convertCents(...args),
  refreshIfDue: () => service().refreshIfDue(),
};
