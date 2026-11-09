export const CURRENCIES = [
  { code: 'USD', symbol: '$', label: 'USD ($)' },
  { code: 'EUR', symbol: '€', label: 'EUR (€)' },
  { code: 'GBP', symbol: '£', label: 'GBP (£)' },
  { code: 'CAD', symbol: 'C$', label: 'CAD (C$)' },
  { code: 'AUD', symbol: 'A$', label: 'AUD (A$)' },
  { code: 'JPY', symbol: '¥', label: 'JPY (¥)' },
];
export const DEFAULT_CURRENCY = 'USD';
export const SYMBOLS = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$', JPY: '¥' };
export const getCurrency = () => {
  try {
    const code = typeof localStorage !== 'undefined' ? localStorage.getItem('bindarr_currency') : null;
    return SYMBOLS[code] ? code : DEFAULT_CURRENCY;
  } catch { return DEFAULT_CURRENCY; }
};
export const setCurrency = code => {
  const next = SYMBOLS[code] ? code : DEFAULT_CURRENCY;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem('bindarr_currency', next); } catch { /* Storage may be unavailable. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bindarr_currency_change', { detail: next }));
};
export const currencySymbol = currency => SYMBOLS[currency] || SYMBOLS[getCurrency()] || '$';
export const activeCurrencySymbol = () => currencySymbol(getCurrency());
export const formatPrice = p => (parseFloat(p) || 0).toFixed(2);

const CACHE_KEY = 'bindarr_fx_rates_v1';
const TTL = 15 * 60 * 1000;
const listeners = new Set();
let revision = 0;
let cached = null;
let inflight = null;
let retryAfter = 0;
let failed = false;

function validCache(value) {
  return value && Number.isFinite(value.at) && value.at <= Date.now() &&
    Date.now() - value.at < 86400000 && value.quotes && value.quotes.USD?.rate === 1;
}
try {
  const saved = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') : null;
  if (validCache(saved)) cached = saved;
} catch { /* Ignore an invalid browser cache. */ }
const notify = () => { revision++; for (const listener of listeners) listener(); };
if (typeof window !== 'undefined') window.addEventListener('bindarr_currency_change', notify);
export const subscribeCurrency = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const currencyRevision = () => revision;
export const getFxStatus = () => ({
  currency: getCurrency(), available: !!cached, failed,
  stale: !!cached && (Date.now() - cached.at >= 86400000 || Object.values(cached.quotes).some(quote => quote.stale)),
});

export async function ensureExchangeRates() {
  if (inflight) return inflight;
  if (cached && Date.now() - cached.at < TTL) return;
  if (Date.now() < retryAfter) return;
  try { if (typeof localStorage === 'undefined' || !localStorage.getItem('bindarr_token')) return; } catch { return; }
  inflight = (async () => {
    try {
      const response = await fetch('/api/sets/exchange-rates', { cache: 'no-store' });
      if (!response.ok) throw new Error('FX unavailable');
      const data = await response.json();
      if (!data.quotes || data.quotes.USD?.rate !== 1) throw new Error('Invalid FX response');
      const quotes = {};
      for (const [code, quote] of Object.entries(data.quotes)) {
        if (SYMBOLS[code] && Number.isFinite(quote.rate) && quote.rate > 0) quotes[code] = quote;
      }
      cached = { at: Date.now(), quotes };
      failed = Object.keys(quotes).length < CURRENCIES.length;
      retryAfter = 0;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cached)); } catch { /* In-memory cache still works. */ }
    } catch { failed = true; retryAfter = Date.now() + TTL; }
    finally { inflight = null; notify(); }
  })();
  return inflight;
}

export function convertDisplayAmount(amount, from, to, quotes) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  if (from === to) return value;
  const left = quotes?.[from]?.rate;
  const right = quotes?.[to]?.rate;
  if (!(left > 0) || !(right > 0)) return null;
  const converted = value / left * right;
  return Number.isFinite(converted) ? converted : null;
}

export function reportingAmount(amount, currency) {
  const to = getCurrency();
  const from = currency ? String(currency).toUpperCase() : to;
  if (amount == null || amount === '') return null;
  if (from !== to) void ensureExchangeRates();
  const quotes = cached && Date.now() - cached.at < 86400000 ? cached.quotes : null;
  return convertDisplayAmount(amount, from, to, quotes);
}

export function reportingTotal(cards) {
  let total = 0;
  for (const card of cards) {
    if (card.price_trend == null || card.price_trend === '') continue;
    const amount = reportingAmount(card.price_trend, card.price_currency);
    if (amount == null) return null;
    total += amount * (card.quantity || 1);
  }
  return total;
}

// Explicit currency is the quote currency; omitted currency means an amount
// already entered in the reporting currency. Never overwrite stored quotes.
export const priceText = (p, currency) => {
  const to = getCurrency();
  if (p == null || p === '' || !Number.isFinite(Number(p))) return '—';
  const amount = reportingAmount(p, currency);
  if (amount == null) return inflight ? '…' : '— (FX unavailable)';
  return `${currencySymbol(to)}${amount.toFixed(to === 'JPY' ? 0 : 2)}`;
};

export const reportingTotalText = total =>
  total == null ? (inflight ? '…' : '— (FX unavailable)') : priceText(total);
