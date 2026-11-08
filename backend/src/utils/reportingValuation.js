'use strict';
const { resolveCardPrice } = require('./priceHelpers');
const fx = require('./currencyConversion');
const SUPPORTED = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']);
const PRICE_FIELDS = ['price_trend', 'price_normal', 'price_holofoil', 'price_reverse_holofoil', 'price_1st_edition'];

function createReportingValuation(target = 'USD') {
  target = String(target).toUpperCase();
  if (!SUPPORTED.has(target)) { const error = new TypeError('Unsupported reporting currency'); error.status = 400; throw error; }
  const pending = new Map();
  const sourceCurrencies = new Set();
  let stale = false;
  async function cents(amount, source = 'USD') {
    if (amount == null) return null;
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('Invalid monetary amount');
    source = String(source || 'USD').toUpperCase();
    sourceCurrencies.add(source);
    if (!amount || source === target) return amount;
    const key = `${source}:${amount}`;
    if (!pending.has(key)) pending.set(key, fx.convertCents(amount, source, target));
    const result = await pending.get(key);
    if (result.convertedCents == null) {
      const error = new Error(`Cannot calculate ${target} totals: ${source} exchange rate is unavailable`);
      error.status = 503; error.code = 'VALUATION_FX_UNAVAILABLE'; throw error;
    }
    stale = stale || result.stale;
    return result.convertedCents;
  }
  async function money(amount, source = 'USD') {
    if (amount == null || amount === '') return null;
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid monetary value');
    return (await cents(Math.round(value * 100), source)) / 100;
  }
  async function card(row) {
    const source = row.price_currency || 'USD';
    const quote = { currency: source, price: resolveCardPrice(row), source: row.price_source || null };
    const normalized = { ...row, source_quote: quote, price_currency: target };
    for (const field of PRICE_FIELDS) normalized[field] = await money(row[field], source);
    // Existing copy overrides have no independent currency column. Preserve
    // their existing displayed interpretation (the card's quote currency).
    if (row.market_value != null) normalized.market_value = await money(row.market_value, source);
    normalized.price_trend = await money(resolveCardPrice(row), source);
    normalized.valuation_currency = target;
    return normalized;
  }
  return { target, cents, money, card,
    metadata: () => ({ currency: target, sourceCurrencies: [...sourceCurrencies].sort(), staleRates: stale }),
  };
}
module.exports = { createReportingValuation };
