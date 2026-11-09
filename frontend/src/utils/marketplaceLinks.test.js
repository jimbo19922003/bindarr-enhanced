import test from 'node:test';
import assert from 'node:assert/strict';
import { priceSource } from './marketplaceLinks.js';

test('PokéWallet prices name the marketplace and the quote currency', () => {
  assert.deepEqual(priceSource({ price_trend: 12.5, price_currency: 'USD', price_source: 'pokewallet-tcgplayer' }), {
    name: 'PokéWallet · TCGplayer',
    currency: 'USD',
  });

  assert.deepEqual(priceSource({ price_trend: 0.4, price_currency: 'EUR', price_source: 'pokewallet-cardmarket' }), {
    name: 'PokéWallet · Cardmarket',
    currency: 'EUR',
  });

  assert.equal(priceSource({ price_trend: 0, price_currency: 'USD', price_source: 'pokewallet-tcgplayer' }), null);
  assert.equal(priceSource({ price_trend: 3, price_currency: 'USD', price_source: 'tcgcsv' }), null);
});

test('CardDex prices identify the underlying marketplace', () => {
  assert.deepEqual(priceSource({ price_trend: 12, price_currency: 'USD', price_source: 'carddex-tcgplayer' }),
    { name: 'CardDex · TCGplayer', currency: 'USD' });
  assert.deepEqual(priceSource({ price_trend: 4, price_currency: 'EUR', price_source: 'carddex-cardmarket' }),
    { name: 'CardDex · Cardmarket', currency: 'EUR' });
});
