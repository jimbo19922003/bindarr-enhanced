import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownedEntriesForSetCard, inspectorCardForSetCard, standardSetCompletion, standardSetCards, printingUpgrade, setPrintingQuality } from './setCardEntries.js';

const card = { id: 'sv1-007', game: 'pokemon', set_id: 'sv1', number: '7' };
const entry = (over) => ({ entry_id: 1, game: 'pokemon', set_id: 'sv1', number: '007', quantity: 1, ...over });

test('base grid hides secrets and special numbers; full mode restores them without changing the source', () => {
  const set = { game: 'pokemon', printed_total: 84 };
  const cards = ['001', ' 84 ', '85', '120', 'TG01', '1a', '0', '', null].map(number => ({ number, owned: false, wishlisted: false }));
  const base = standardSetCards(cards, set);
  assert.deepEqual(base.map(card => card.number), ['001', ' 84 ']);
  assert.equal(base.filter(card => !card.owned && !card.wishlisted).length, 2);
  assert.equal(standardSetCards(cards, set, true), cards);
  assert.equal(cards.length, 9);
  assert.deepEqual(standardSetCards(cards, { ...set, game: 'lorcana' }), base);
});

test('grid does not guess a base range for missing totals or non-contiguous Magic numbers', () => {
  const cards = ['1', '500', '123a'].map(number => ({ number }));
  assert.equal(standardSetCards(cards, { game: 'mtg', printed_total: 3 }), cards);
  for (const printed_total of [null, 0, undefined]) {
    assert.equal(standardSetCards(cards, { game: 'pokemon', printed_total }), cards);
  }
  assert.equal(standardSetCards(cards, null), cards);
});

test('standard set completion uses catalogue totals, not the loaded checklist or copy count', () => {
  const set = { id: 'sv1', game: 'pokemon', printed_total: 84, total: 120 };
  const cards = [
    entry({ number: '001' }), entry({ number: '1', printing: 'Reverse Holofoil' }),
    entry({ number: '84' }), entry({ number: '85' }), entry({ number: '120' }),
    entry({ number: '2', game: 'mtg' }), entry({ number: '3', set_id: 'other' }),
    entry({ number: '' }), entry({ number: null }),
  ];
  assert.deepEqual(standardSetCompletion(set, cards), { owned: 2, total: 84, percent: 2 });
  assert.deepEqual(standardSetCompletion(set, cards, true), { owned: 4, total: 120, percent: 3 });
  assert.equal(standardSetCompletion({ ...set, total: null }, cards, true), null);
  assert.equal(standardSetCompletion(null, cards), null);
});

test('promo sets use their full total; sets without totals use the loaded card list', () => {
  const promos = { id: 'sv1', game: 'pokemon', printed_total: 0, total: 112 };
  assert.deepEqual(standardSetCompletion(promos, [entry({ number: '001' })]), { owned: 1, total: 112, percent: 1 });
  const lorcana = { id: 'sv1', game: 'pokemon', printed_total: null, total: null };
  const listed = ['1', '2', '3', '4'].map(number => ({ number }));
  assert.deepEqual(standardSetCompletion(lorcana, [entry({ number: '002' }), entry({ number: '99' })], false, listed), { owned: 1, total: 4, percent: 25 });
  assert.equal(standardSetCompletion(lorcana, [entry({})]), null);
});

test('standard Magic completion preserves suffixes and non-contiguous collector numbers', () => {
  const set = { id: 'sv1', game: 'mtg', printed_total: 3, total: 3 };
  const cards = ['1', '500', '123a'].map(number => entry({ game: 'mtg', number }));
  assert.deepEqual(standardSetCompletion(set, cards), { owned: 3, total: 3, percent: 100 });
});

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

test('printing upgrades follow Normal < Reverse Holo < Holo < 1st Edition using the best owned copy', () => {
  const setCard = printings => ({ ...card, available_printings: JSON.stringify(printings) });
  const holoRare = setCard(['Holofoil', 'Reverse Holofoil']);
  assert.deepEqual(printingUpgrade(holoRare, [entry({ printing: 'Reverse Holofoil' })]), { upgradeAvailable: true, better: ['Holofoil'] });
  assert.equal(printingUpgrade(holoRare, [entry({ printing: 'Reverse Holofoil' }), entry({ printing: 'Holofoil' })]).upgradeAvailable, false);
  assert.deepEqual(printingUpgrade(setCard(['Normal', 'Holofoil', 'Reverse Holofoil']), [entry({ printing: null })]).better, ['Holofoil', 'Reverse Holofoil']);
  assert.deepEqual(printingUpgrade(setCard(['Normal', '1st Edition']), [entry({ printing: 'Normal' })]).better, ['1st Edition']);
  assert.equal(printingUpgrade(setCard(['Normal']), [entry({ printing: 'Normal' })]).upgradeAvailable, false);
});

test('unowned cards and unknown printings are not judged, and max quality covers judged owned cards only', () => {
  const owned = [entry({ number: '7', printing: 'Normal' }), entry({ number: '8', printing: 'Holofoil' }), entry({ number: '9', printing: 'Normal' })];
  const cards = [
    { ...card, number: '7', available_printings: '["Normal","Reverse Holofoil"]' },
    { ...card, number: '8', available_printings: '["Holofoil","Reverse Holofoil"]' },
    { ...card, number: '9', available_printings: null },
    { ...card, number: '10', available_printings: '["Normal","Reverse Holofoil"]' },
  ];
  assert.equal(printingUpgrade(cards[2], owned), null);
  assert.equal(printingUpgrade(cards[3], owned), null);
  assert.deepEqual(setPrintingQuality(cards, owned), { maxed: 1, owned: 2, upgrades: 1, percent: 50 });
  assert.equal(setPrintingQuality(cards.slice(2), owned), null);
});
