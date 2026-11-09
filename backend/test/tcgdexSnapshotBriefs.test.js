'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cardFromBrief, trustedImage } = require('../src/utils/tcgdexSnapshotLoader');
const { normalize } = require('../src/utils/pokemonLocalCatalog');
const { isEnabled } = require('../src/utils/catalogAutoSync');

test('set briefs keep trusted TCGdex images and omit a missing image', () => {
  const set = { id: '30th-c', name: '30th Classic Collection' };
  const pictured = cardFromBrief(set, {
    id: 'sv03.5-001',
    localId: '001',
    name: 'Bulbasaur',
    image: 'https://assets.tcgdex.net/en/sv/sv03.5/001',
  });
  const missing = cardFromBrief(set, { id: '30th-c-012', localId: '012', name: 'Raikou', image: null });
  assert.equal(pictured.image, 'https://assets.tcgdex.net/en/sv/sv03.5/001');
  assert.equal(pictured.set.id, '30th-c');
  assert.equal(Object.hasOwn(missing, 'image'), false);
  assert.equal(trustedImage('http://assets.tcgdex.net/en/sv/sv03.5/001'), '');
  assert.equal(trustedImage('https://images.carddex.dev/cards/30ccc/30ccc-012.webp'), '');
  assert.equal(cardFromBrief(set, { id: '30th-c-012', name: 'Raikou' }), null);
});

test('a brief without an image can be imported for later artwork recovery', () => {
  const commit = 'a'.repeat(40);
  const snapshot = normalize({
    commit,
    language: 'en',
    sets: [{ id: '30th-c', name: '30th Classic Collection', serie: { id: 'me', name: 'Mega Evolution' }, cardCount: { official: 30 } }],
    cards: [cardFromBrief(
      { id: '30th-c', name: '30th Classic Collection' },
      { id: '30th-c-012', localId: '012', name: 'Raikou' },
    )],
  });
  assert.equal(snapshot.cards[0].id, 'tcgdex-en-30th-c-012');
  assert.equal(snapshot.cards[0].image_url, '');
  assert.equal(snapshot.cards[0].number, '012');
});

test('catalogue sync is on unless explicitly disabled', () => {
  const previous = process.env.POKEMON_CATALOG_AUTOSYNC;
  delete process.env.POKEMON_CATALOG_AUTOSYNC;
  assert.equal(isEnabled(), true);
  process.env.POKEMON_CATALOG_AUTOSYNC = '0';
  assert.equal(isEnabled(), false);
  if (previous === undefined) delete process.env.POKEMON_CATALOG_AUTOSYNC;
  else process.env.POKEMON_CATALOG_AUTOSYNC = previous;
});
