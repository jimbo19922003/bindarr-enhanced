'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDashboardSetTotals, setKey } = require('../src/utils/dashboardSetTotals');

test('set value merges capitalization, Unicode and whitespace variants before selecting top sets', () => {
  const totals = createDashboardSetTotals();
  totals.add({ game: 'pokemon', id: 'M6a', name: '30th CELEBRATION', count: 1, value: 12.25 });
  totals.add({ game: 'pokemon', id: '30th', name: ' 30th  Celebration ', count: 11, value: 20.50 });
  const cards = totals.list();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].name, '30th Celebration');
  assert.equal(cards[0].count, 12);
  assert.equal(cards[0].value, 32.75);
  totals.add({ game: 'pokemon', id: 'sealed-other-id', name: '３０ｔｈ Celebration', value: 17.25 });
  assert.equal(totals.list()[0].value, 50);
  assert.equal(cards[0].value, 32.75);
  for (let index = 0; index < 8; index++) totals.add({ game: 'pokemon', id: `other-${index}`, name: `Other ${index}`, value: 40 });
  assert.equal(totals.list().length, 8);
  assert.equal(totals.list()[0].value, 50);
});

test('same labels in different games and distinct missing-name IDs remain separate', () => {
  const totals = createDashboardSetTotals();
  totals.add({ game: 'pokemon', id: '1', name: 'Shared', value: 3 });
  totals.add({ game: 'mtg', id: '1', name: 'SHARED', value: 4 });
  totals.add({ game: 'pokemon', id: 'unknown-1', name: '', value: 5 });
  totals.add({ game: 'pokemon', id: 'unknown-2', name: null, value: 6 });
  totals.add({ game: 'pokemon', id: '', name: '', value: 7 });
  assert.equal(totals.list().length, 5);
  assert.notEqual(setKey('pokemon', '1', 'Shared'), setKey('mtg', '1', 'Shared'));
  assert.notEqual(setKey('pokemon', 'unknown-1', ''), setKey('pokemon', 'unknown-2', ''));
});

test('invalid input fails explicitly rather than producing a misleading total', () => {
  const totals = createDashboardSetTotals();
  assert.throws(() => totals.add({ game: 'pokemon', name: {}, value: 1 }), /Invalid set name/);
  assert.throws(() => totals.add({ game: 'pokemon', name: 'Test', value: NaN }), /Invalid count or value/);
  assert.throws(() => totals.add({ game: 'pokemon', name: 'Test', count: 1.5, value: 1 }), /Invalid count or value/);
});

test('conflicting names for the same game and ID remain separate and are reported once', () => {
  const conflicts = [];
  const totals = createDashboardSetTotals({ onConflict: conflict => conflicts.push(conflict) });
  totals.add({ game: 'pokemon', id: 'same', name: 'First', value: 1 });
  totals.add({ game: 'pokemon', id: 'same', name: 'FIRST', value: 2 });
  totals.add({ game: 'pokemon', id: 'same', name: 'Second', value: 3 });
  totals.add({ game: 'pokemon', id: 'same', name: 'Second', value: 4 });
  totals.add({ game: 'mtg', id: 'same', name: 'Different game', value: 5 });
  assert.deepEqual(conflicts, [{ game: 'pokemon', id: 'same' }]);
  assert.equal(totals.list().length, 3);
  assert.equal(totals.list().reduce((sum, row) => sum + row.value, 0), 15);
});
