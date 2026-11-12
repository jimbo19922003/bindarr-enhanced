'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize } = require('../src/utils/pokemonLocalCatalog');

const snapshot = illustrator => ({
  commit: 'a'.repeat(40),
  language: 'en',
  sets: [{ id: 'base1', name: 'Base Set', serie: { id: 'base', name: 'Base' }, cardCount: { official: 102 } }],
  cards: [{ id: 'base1-58', localId: '58', name: 'Pikachu', category: 'Pokemon', set: { id: 'base1' }, ...(illustrator === undefined ? {} : { illustrator }) }],
});

test('local catalogue captures the illustrator without changing the content hash', () => {
  const without = normalize(snapshot(undefined));
  const withArtist = normalize(snapshot('  Mitsuhiro Arita '));
  assert.equal(without.cards[0].illustrator, null);
  assert.equal(withArtist.cards[0].illustrator, 'Mitsuhiro Arita');
  // Same commit re-imported with illustrators must not look like different content.
  assert.equal(withArtist.contentHash, without.contentHash);
  assert.equal(withArtist.scanHash, without.scanHash);
  assert.equal(normalize(snapshot('   ')).cards[0].illustrator, null);
});
