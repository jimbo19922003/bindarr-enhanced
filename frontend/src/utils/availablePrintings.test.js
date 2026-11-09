import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availablePrintings, preferredPrinting, exactPrintingPrice } from './availablePrintings.js';

test('verified printings limit the choices and select a valid default', () => {
  const card = { game: 'pokemon', available_printings: '["Holofoil","Reverse Holofoil"]' };
  assert.deepEqual(availablePrintings(card).options.map(option => option.value), ['Holofoil', 'Reverse Holofoil']);
  assert.equal(preferredPrinting(card), 'Holofoil');
  assert.equal(preferredPrinting(card, 'Reverse Holofoil'), 'Reverse Holofoil');
});

test('missing or malformed metadata leaves choices unverified', () => {
  for (const available_printings of [null, 'bad', '[]', '["invalid"]']) {
    assert.equal(availablePrintings({ available_printings }).verified, false);
    assert.equal(preferredPrinting({ available_printings }), 'Normal');
  }
});

test('a different finish or trend cannot supply the selected finish price', () => {
  const card = { price_trend: 30, price_normal: 5, price_holofoil: 10 };
  assert.equal(exactPrintingPrice(card, 'Holofoil'), 10);
  assert.equal(exactPrintingPrice(card, 'Reverse Holofoil'), null);
});
