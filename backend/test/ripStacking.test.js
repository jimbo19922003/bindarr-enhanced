'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
async function load(name) {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils', name), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
async function main() {
  const { stackRipCard } = await load('ripStacking.js');
  const { draftOwnership } = await load('ripOwnership.js');
  const card = { key: 'new-1', card_id: 'set-a-1', name: 'Pikachu', quantity: '1', printing: 'Normal', language: 'English', current_value: '5.00', bulk: false, lineMode: false };
  let pulls = [];
  for (let i = 1; i <= 4; i++) pulls = stackRipCard(pulls, { ...card, key: `new-${i}` });
  assert.strictEqual(pulls.length, 1); assert.strictEqual(pulls[0].quantity, '4'); assert.strictEqual(pulls[0].key, 'new-1');
  assert.strictEqual(pulls[0].current_value, '5.00'); assert.strictEqual(card.quantity, '1');
  assert.ok(draftOwnership(pulls, { 'set-a-1': 0 })['new-1'].text.includes('3 extra copies'));
  assert.strictEqual(stackRipCard(pulls, { ...card, card_id: 'set-b-1' }).length, 2);
  assert.strictEqual(stackRipCard(pulls, { ...card, printing: 'Reverse Holofoil' }).length, 2);
  assert.strictEqual(stackRipCard(pulls, { ...card, language: 'Japanese' }).length, 2);
  const saved = { ...card, key: 'saved-1', id: 1, quantity: '3' };
  pulls = stackRipCard([saved], { ...card, key: 'new-5' });
  pulls = stackRipCard(pulls, { ...card, key: 'new-6' });
  assert.strictEqual(pulls.length, 2); assert.strictEqual(pulls.find(row => row.id === 1).quantity, '3');
  assert.strictEqual(pulls.find(row => !row.id).quantity, '2');
  assert.strictEqual(stackRipCard([{ ...card, bulk: true }], card).length, 2);
  const max = [{ ...card, quantity: '5000' }]; assert.strictEqual(stackRipCard(max, card), max);
  console.log('ripStacking.test.js: all assertions passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
