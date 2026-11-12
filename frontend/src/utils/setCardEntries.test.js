import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownedEntriesForSetCard, inspectorCardForSetCard } from './setCardEntries.js';

const card = { id: 'sv1-007', game: 'pokemon', set_id: 'sv1', number: '7' };
const entry = (over) => ({ entry_id: 1, game: 'pokemon', set_id: 'sv1', number: '007', quantity: 1, ...over });

test('matches the server owned rule: game, set and number without leading zeros', () => {
  const collection = [
    entry({ entry_id: 1 }),
    entry({ entry_id: 2, number: ' 7 ', language: 'Japanese' }),
    entry({ entry_id: 3, number: '17' }),
    entry({ entry_id: 4, set_id: 'sv2', number: '7' }),
    entry({ entry_id: 5, game: 'mtg', number: '7' }),
  ];
  assert.deepEqual(ownedEntriesForSetCard(card, collection).map(e => e.entry_id), [1, 2]);
});

test('letter suffixes compare case-insensitively; blank numbers fall back to the exact card id', () => {
  assert.equal(ownedEntriesForSetCard({ ...card, number: 'TG05' }, [entry({ number: 'tg05' })]).length, 1);
  assert.equal(ownedEntriesForSetCard({ ...card, number: '' }, [entry({ number: '', card_id: 'other' })]).length, 0);
  assert.equal(ownedEntriesForSetCard({ ...card, number: '' }, [entry({ number: '', card_id: 'sv1-007' })]).length, 1);
  assert.equal(ownedEntriesForSetCard(card, [entry({ number: '' })]).length, 0);
});

test('a per-printing slot only matches copies of that printing (missing printing is Normal)', () => {
  const collection = [
    entry({ entry_id: 1, printing: 'Reverse Holofoil' }),
    entry({ entry_id: 2, printing: null }),
  ];
  assert.deepEqual(ownedEntriesForSetCard({ ...card, slot_printing: 'Reverse Holofoil' }, collection).map(e => e.entry_id), [1]);
  assert.deepEqual(ownedEntriesForSetCard({ ...card, slot_printing: 'Normal' }, collection).map(e => e.entry_id), [2]);
  assert.deepEqual(ownedEntriesForSetCard({ ...card, slot_printing: null }, collection).map(e => e.entry_id), [1, 2]);
});

test('one copy opens directly; several open as a stack for the print picker', () => {
  assert.equal(inspectorCardForSetCard(card, []), null);
  assert.equal(inspectorCardForSetCard(card, undefined), null);
  const single = entry({ entry_id: 9 });
  assert.equal(inspectorCardForSetCard(card, [single]), single);
  const stacked = inspectorCardForSetCard(card, [
    entry({ entry_id: 1, printing: 'Normal', quantity: 2 }),
    entry({ entry_id: 2, printing: 'Reverse Holofoil', quantity: 1 }),
  ]);
  assert.equal(stacked.entry_id, 1);
  assert.equal(stacked.quantity, 3);
  assert.deepEqual(stacked.stack_entries.map(e => e.entry_id), [1, 2]);
});
