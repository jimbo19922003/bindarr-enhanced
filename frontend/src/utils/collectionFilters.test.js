import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateCardIds, missingArtwork } from './collectionFilters.js';

test('duplicates count copies of the same card across rows and quantities', () => {
  const cards = [
    { card_id: 'a', quantity: 1, printing: 'Normal' },
    { card_id: 'a', quantity: 1, printing: 'Holofoil' },
    { card_id: 'b', quantity: 3 },
    { card_id: 'c', quantity: 1 },
    { card_id: 'd', quantity: 0 },
    { quantity: 3 },
  ];
  assert.deepEqual([...duplicateCardIds(cards)].sort(), ['a', 'b']);
});

test('missing artwork excludes provider references and locally supplied artwork', () => {
  const local = new Set(['local']);
  assert.equal(missingArtwork({ card_id: 'missing', image_url: null }, local), true);
  assert.equal(missingArtwork({ card_id: 'missing', image_url: '   ' }, local), true);
  assert.equal(missingArtwork({ card_id: 'local', image_url: '' }, local), false);
  assert.equal(missingArtwork({ card_id: 'provider', image_url: 'https://example.com/image' }, local), false);
});
