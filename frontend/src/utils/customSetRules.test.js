import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPendingRules } from './customSetRules.js';

test('saving includes typed name and selected set without requiring Add rule', () => {
  const rules = { names: [], illustrators: [], set_ids: [], rarities: [] };
  assert.deepEqual(withPendingRules(rules, { names: ' pikachu ', set_ids: '30th' }), {
    names: ['pikachu'], illustrators: [], set_ids: ['30th'], rarities: [],
  });
  assert.deepEqual(rules.names, []);
  assert.deepEqual(rules.set_ids, []);
});

test('pending rules preserve existing chips, ignore blanks and avoid duplicate terms', () => {
  const rules = { names: ['Pikachu'], illustrators: ['Arita'], set_ids: ['30th'], rarities: [] };
  assert.deepEqual(withPendingRules(rules, {
    names: ' pikachu ', illustrators: ' PLANETA ', set_ids: '30th', rarities: '  ',
  }), {
    names: ['Pikachu'], illustrators: ['Arita', 'PLANETA'], set_ids: ['30th'], rarities: [],
  });
  assert.deepEqual(withPendingRules(rules, { rarities: 'Pikachu Rare' }).rarities, ['Pikachu Rare']);
});
