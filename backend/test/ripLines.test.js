'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
async function load(name) {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils', name), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
async function main() {
  const { splitRipLine, canSplitRipLine, MAX_RIP_LINES } = await load('ripLines.js');
  const { draftOwnership } = await load('ripOwnership.js');
  const card = { key: 'new-1', added_order: 1, card_id: 'set-a-1', name: 'Pikachu', quantity: '3', printing: 'Normal', language: 'English', current_value: '', bulk: false, lineMode: false };
  let next = 10;
  const other = { ...card, key: 'new-2', added_order: 2, card_id: 'set-b-1', quantity: '1' };
  const split = splitRipLine([other, card], 'new-1', () => ++next);
  assert.strictEqual(split.length, 4);
  assert.strictEqual(split[0], other);
  assert.deepStrictEqual(split.slice(1).map(row => [row.key, row.quantity]), [['new-1', '1'], ['new-11', '1'], ['new-12', '1']]);
  assert.ok(split.slice(1).every(row => row.card_id === 'set-a-1' && row.printing === 'Normal'));
  assert.strictEqual(card.quantity, '3');
  // Separate lines can now take separate finishes, and ownership still counts them as one card.
  split[2] = { ...split[2], printing: 'Reverse Holofoil' };
  const statuses = draftOwnership(split, { 'set-a-1': 0 });
  assert.strictEqual(statuses['new-1'].kind, 'new');
  assert.strictEqual(statuses['new-11'].kind, 'extra');
  assert.ok(!canSplitRipLine({ ...card, id: 4 }), 'recorded pulls stay as recorded');
  assert.ok(!canSplitRipLine({ ...card, bulk: true }));
  assert.ok(!canSplitRipLine({ ...card, quantity: '1' }));
  const full = Array.from({ length: MAX_RIP_LINES - 1 }, (_, i) => ({ ...other, key: `x-${i}` }));
  const crowded = [...full, card];
  assert.strictEqual(splitRipLine(crowded, 'new-1', () => ++next), crowded, 'never exceeds the per-opening line cap');
  console.log('ripLines.test.js: all assertions passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
