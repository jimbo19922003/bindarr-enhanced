'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { providerId, extractCarddexQuote } = require('../src/utils/carddexPrices');

const card = { id: 'tcgdex-en-base1-4', game: 'pokemon', language: 'English',
  name: 'Charizard', number: '4', set_id: 'base1', set_name: 'Base Set' };
const now = Date.parse('2026-11-09T12:00:00Z');
const body = { data: { id: 'base1-4', set_id: 'base1', set_name: 'Base Set',
  name: 'Charizard', number: '4', base_finish: 'holo',
  prices: [{ card_id: 'base1-4', variant_id: null, source: 'cardmarket',
    currency: 'EUR', trend_price: 402.26, recorded_at: '2026-11-09T07:00:00Z' }] } };

test('accepts a fresh exact base printing without changing the local identity', () => {
  const quote = extractCarddexQuote(card, body, now);
  assert.equal(providerId(card), 'base1-4');
  assert.equal(quote.amount, 402.26);
  assert.equal(quote.finish, 'price_holofoil');
  assert.equal(quote.source, 'carddex-cardmarket');
});

test('refuses mismatched, stale, unpriced or unconfirmed quotes', () => {
  for (const change of [{ id: 'base1-5' }, { name: 'Blastoise' },
    { number: '5' }, { set_name: 'Other' }, { base_finish: null }]) {
    assert.equal(extractCarddexQuote(card, { data: { ...body.data, ...change } }, now), null);
  }
  for (const change of [{ trend_price: 0 }, { recorded_at: '2026-10-01T00:00:00Z' },
    { variant_id: 'base1-4::holo' }, { currency: 'USD' }]) {
    assert.equal(extractCarddexQuote(card, { data: { ...body.data,
      prices: [{ ...body.data.prices[0], ...change }] } }, now), null);
  }
  assert.equal(extractCarddexQuote({ ...card, price_trend: 3, price_currency: 'USD' }, body, now).currency, 'EUR');
  assert.equal(providerId({ ...card, language: 'Japanese' }), null);
});

test('prefers the existing quote currency when available, otherwise accepts another source currency', () => {
  const usd = { ...body.data.prices[0], source: 'tcgplayer', currency: 'USD', trend_price: 50 };
  const both = { data: { ...body.data, prices: [usd, body.data.prices[0]] } };
  assert.equal(extractCarddexQuote({ ...card, price_trend: 3, price_currency: 'EUR' }, both, now).currency, 'EUR');
  assert.equal(extractCarddexQuote({ ...card, price_trend: 3, price_currency: 'USD' }, both, now).currency, 'USD');
  assert.equal(extractCarddexQuote(card, both, now).currency, 'USD');
  assert.equal(extractCarddexQuote({ ...card, price_trend: 3, price_currency: 'EUR' },
    { data: { ...body.data, prices: [usd] } }, now).currency, 'USD');
});

test('maps the 30th Celebration set only when its identity is confirmed', () => {
  const anniversary = { ...card, id: 'tcgdex-en-30th-037', set_id: '30th',
    set_name: '30th Celebration', name: 'Pikachu', number: '037' };
  const mapped = { data: { ...body.data, id: '30c-037', set_id: '30c',
    set_name: '30th Celebration', name: 'Pikachu', number: '037',
    prices: [{ ...body.data.prices[0], card_id: '30c-037' }] } };
  assert.equal(providerId(anniversary), '30c-037');
  assert.equal(extractCarddexQuote(anniversary, mapped, now).amount, 402.26);
  assert.equal(extractCarddexQuote(anniversary, { data: { ...mapped.data, set_name: 'Other' } }, now), null);
  assert.equal(extractCarddexQuote(anniversary, { data: { ...mapped.data, number: '038' } }, now), null);
  assert.equal(providerId({ ...anniversary, set_name: 'Other' }), '30th-037');
  assert.equal(providerId({ ...anniversary, id: 'tcgdex-en-other-037' }), null);
  assert.equal(providerId({ ...anniversary, language: 'Japanese' }), null);
});
