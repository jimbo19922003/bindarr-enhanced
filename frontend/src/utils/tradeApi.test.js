import test from 'node:test';
import assert from 'node:assert/strict';
import { amountToCents, centsToAmount, tradeEntryId, tradeItemDetails } from './tradeApi.js';

test('amounts parse to exact cents and reject invalid input', () => {
  assert.equal(amountToCents(''), 0);
  assert.equal(amountToCents('12.345'), 1235);
  assert.equal(amountToCents('0.1'), 10);
  assert.equal(amountToCents('-1'), null);
  assert.equal(amountToCents('abc'), null);
  assert.equal(amountToCents('11', 10), null);
  assert.equal(centsToAmount(1850), '18.50');
  assert.equal(centsToAmount(null), '');
});

test('sealed item identity survives selection serialization without colliding with card IDs', () => {
  const selected = { 7: 1, 'sealed:7': 3 };
  assert.deepEqual(Object.entries(selected).map(([id, quantity]) => ({ entry_id: tradeEntryId(id), quantity })),
    [{ entry_id: 7, quantity: 1 }, { entry_id: 'sealed:7', quantity: 3 }]);
  assert.deepEqual(tradeItemDetails({ kind: 'sealed', set_name: '151', language: 'English' }), ['151', 'English']);
});
