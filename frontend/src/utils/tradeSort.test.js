import assert from 'node:assert';
import test from 'node:test';
import { filterTradeCards, tradeFacetValues, tradeGames } from './tradeSort.js';

const cards = [
  { entry_id: 1, name: 'Pikachu', set_name: '151', number: '25', game: 'pokemon', unit_cents: 300, quantity: 1 },
  { entry_id: 2, name: 'Mew', set_name: '151', number: '151', game: 'pokemon', unit_cents: null, quantity: 4 },
  { entry_id: 3, name: 'Bulbasaur', set_name: '151', number: '1', game: 'pokemon', unit_cents: 50, quantity: 2 },
  { entry_id: 4, name: 'Lightning Bolt', set_name: 'Alpha', number: '161', game: 'mtg', unit_cents: 900, quantity: 1 },
];
const ids = list => list.map(card => card.entry_id);

test('value sorts keep unpriced cards last in both directions', () => {
  assert.deepStrictEqual(ids(filterTradeCards(cards, { sort: 'value_desc' })), [4, 1, 3, 2]);
  assert.deepStrictEqual(ids(filterTradeCards(cards, { sort: 'value_asc' })), [3, 1, 4, 2]);
});

test('set sort orders collector numbers numerically, and filters combine with sorting', () => {
  assert.deepStrictEqual(ids(filterTradeCards(cards, { sort: 'set' })), [3, 1, 2, 4]);
  assert.deepStrictEqual(ids(filterTradeCards(cards, { sort: 'quantity_desc', game: 'pokemon' })), [2, 3, 1]);
  assert.deepStrictEqual(ids(filterTradeCards(cards, { search: '151', sort: 'name' })), [3, 2, 1]);
  assert.deepStrictEqual(tradeGames(cards, [{ game: 'lorcana' }]), ['lorcana', 'mtg', 'pokemon']);
});

test('filtering does not reorder the caller\'s array', () => {
  const before = ids(cards);
  filterTradeCards(cards, { sort: 'value_desc' });
  assert.deepStrictEqual(ids(cards), before);
});

test('facet filters match exactly and combine with search', () => {
  const graded = [
    { entry_id: 1, name: 'Mew', set_name: '151', condition: 'NM', printing: 'Holofoil', rarity: 'Rare' },
    { entry_id: 2, name: 'Mew', set_name: '151', condition: 'LP', printing: 'Holofoil', rarity: 'Rare' },
    { entry_id: 3, name: 'Mew', set_name: 'Promo', condition: 'NM', printing: 'Normal', rarity: null },
  ];
  assert.deepStrictEqual(ids(filterTradeCards(graded, { facets: { condition: 'NM' } })), [1, 3]);
  assert.deepStrictEqual(ids(filterTradeCards(graded, { search: 'mew', facets: { set_name: '151', printing: 'Holofoil', condition: '' } })), [1, 2]);
  assert.deepStrictEqual(tradeFacetValues('rarity', graded, [{ rarity: 'Common' }]), ['Common', 'Rare']);
  assert.deepStrictEqual(tradeFacetValues('set_name', graded), ['151', 'Promo']);
});

test('sealed products can be found alongside cards or filtered separately', () => {
  const items = [...cards.map(card => ({ ...card, kind: 'card' })),
    { entry_id: 'sealed:1', kind: 'sealed', game: 'sealed', name: '151 UPC', set_name: '151', quantity: 2, unit_cents: 27000 }];
  assert.deepStrictEqual(ids(filterTradeCards(items, { search: '151', facets: { kind: 'sealed' } })), ['sealed:1']);
  assert.deepStrictEqual(tradeGames(items), ['mtg', 'pokemon']);
});
