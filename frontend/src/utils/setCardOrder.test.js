import test from 'node:test';
import assert from 'node:assert/strict';
import { sortCardsBySetNumber } from './setCardOrder.js';

test('set cards sort by natural collector number without mutating the source', () => {
  const cards = [
    { number: '10', name: 'Ten' },
    { number: '2', name: 'Two' },
    { number: 'TG10', name: 'Gallery ten' },
    { number: 'TG2', name: 'Gallery two' },
  ];

  assert.deepEqual(sortCardsBySetNumber(cards).map(card => card.number), ['2', '10', 'TG2', 'TG10']);
  assert.equal(cards[0].number, '10');
});
