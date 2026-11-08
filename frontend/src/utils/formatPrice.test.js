import test from 'node:test';
import assert from 'node:assert/strict';

// Seed deterministic rates before the module reads its browser-cache snapshot.
// These are test fixtures, not current market exchange rates.
const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
  clear: () => storage.clear(),
};
const rates = { USD: 1, EUR: 0.8, GBP: 0.75, CAD: 1.25, AUD: 1.5, JPY: 150 };
const quotes = Object.fromEntries(Object.entries(rates).map(([code, rate]) => [code, { rate, stale: false }]));
localStorage.setItem('bindarr_fx_rates_v1', JSON.stringify({ at: Date.now(), quotes }));
const {
  CURRENCIES, DEFAULT_CURRENCY, SYMBOLS, getCurrency, setCurrency,
  currencySymbol, activeCurrencySymbol, formatPrice, priceText, convertDisplayAmount,
} = await import('./formatPrice.js');

test('formatPrice: formats numbers and handles legacy edge cases', () => {
  assert.equal(formatPrice(12.5), '12.50');
  assert.equal(formatPrice(0), '0.00');
  assert.equal(formatPrice('4.5'), '4.50');
  assert.equal(formatPrice('12.50 USD'), '12.50');
  assert.equal(formatPrice(null), '0.00');
  assert.equal(formatPrice(undefined), '0.00');
  assert.equal(formatPrice(''), '0.00');
  assert.equal(formatPrice('invalid'), '0.00');
});

test('currency defaults and conversion into the reporting currency', () => {
  localStorage.clear();
  assert.equal(DEFAULT_CURRENCY, 'USD');
  assert.equal(getCurrency(), 'USD');
  assert.equal(currencySymbol(), '$');
  assert.equal(activeCurrencySymbol(), '$');
  assert.equal(priceText(5), '$5.00');
  assert.equal(priceText(5, 'USD'), '$5.00');
  assert.equal(priceText(5, 'EUR'), '$6.25');
});

test('currency selection uses reporting symbols, conversion and JPY precision', () => {
  localStorage.clear();
  setCurrency('EUR');
  assert.equal(getCurrency(), 'EUR');
  assert.equal(currencySymbol(), '€');
  assert.equal(activeCurrencySymbol(), '€');
  assert.equal(priceText(19.99), '€19.99');
  assert.equal(priceText(19.99, 'USD'), '€15.99');
  assert.equal(priceText(19.99, 'EUR'), '€19.99');
  setCurrency('GBP');
  assert.equal(getCurrency(), 'GBP');
  assert.equal(currencySymbol(), '£');
  assert.equal(priceText(7.5), '£7.50');
  setCurrency('JPY');
  assert.equal(getCurrency(), 'JPY');
  assert.equal(currencySymbol(), '¥');
  assert.equal(priceText(500), '¥500');
  setCurrency('CAD');
  assert.equal(getCurrency(), 'CAD');
  assert.equal(currencySymbol(), 'C$');
  assert.equal(priceText(10), 'C$10.00');
  setCurrency('AUD');
  assert.equal(getCurrency(), 'AUD');
  assert.equal(currencySymbol(), 'A$');
  assert.equal(priceText(10), 'A$10.00');
  setCurrency('INVALID');
  assert.equal(getCurrency(), 'USD');
  assert.equal(currencySymbol(), '$');
  assert.equal(priceText(10), '$10.00');
  localStorage.clear();
});

test('omitted quote currency means reporting currency; explicit unknown stays unavailable', () => {
  localStorage.clear();
  setCurrency('GBP');
  assert.equal(priceText(3), '£3.00');
  assert.equal(priceText(3, null), '£3.00');
  assert.equal(priceText(3, undefined), '£3.00');
  assert.equal(priceText(3, ''), '£3.00');
  assert.equal(priceText(3, 'XYZ'), '— (FX unavailable)');
  assert.equal(priceText(150, 'JPY'), '£0.75');
  assert.equal(priceText(4, 'usd'), '£3.00');
  localStorage.clear();
});

test('unknown prices are distinct from known zero prices', () => {
  localStorage.clear();
  for (const value of [null, undefined, '', 'not-a-price', NaN, Infinity]) {
    assert.equal(priceText(value, 'USD'), '—');
  }
  assert.equal(priceText(0, 'USD'), '$0.00');
});

test('conversion requires both positive rates and does not modify quotes', () => {
  const before = JSON.stringify(quotes);
  assert.equal(convertDisplayAmount(5, 'EUR', 'USD', quotes), 6.25);
  assert.equal(convertDisplayAmount(150, 'JPY', 'GBP', quotes), 0.75);
  assert.equal(convertDisplayAmount(3, 'GBP', 'GBP', null), 3);
  assert.equal(convertDisplayAmount(3, 'USD', 'GBP', { USD: { rate: 1 } }), null);
  assert.equal(convertDisplayAmount(3, 'USD', 'GBP', { USD: { rate: 1 }, GBP: { rate: 0 } }), null);
  assert.equal(convertDisplayAmount('invalid', 'USD', 'GBP', quotes), null);
  assert.equal(JSON.stringify(quotes), before);
});

test('CURRENCIES list has valid codes, symbols and labels', () => {
  assert.ok(CURRENCIES.length >= 6);
  for (const currency of CURRENCIES) {
    assert.ok(currency.code && typeof currency.code === 'string');
    assert.ok(currency.symbol && typeof currency.symbol === 'string');
    assert.ok(currency.label && typeof currency.label === 'string');
    assert.equal(SYMBOLS[currency.code], currency.symbol);
  }
});
