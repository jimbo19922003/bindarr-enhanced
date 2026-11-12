import assert from 'node:assert';
import test from 'node:test';
import { defaultPromoSet, promoSets } from './promoSets.js';

const sets = [
  { id: 'svp', name: 'SVP Black Star Promos', series: 'Scarlet & Violet', release_date: '2023/03/31' },
  { id: 'sv3pt5', name: '151', series: 'Scarlet & Violet', release_date: '2023/09/22' },
  { id: 'P-A', name: 'Promos-A', series: 'Pokémon TCG Pocket', release_date: '2024/10/30' },
  { id: 'mep', name: 'MEP Black Star Promos', series: 'Mega Evolution', release_date: '2025/09/26' },
  { id: 'me1', name: 'Mega Evolution', series: 'Mega Evolution', release_date: '2025/09/26' },
];

test('promo sets are Black Star sets, newest first', () => {
  assert.deepStrictEqual(promoSets(sets).map(set => set.id), ['mep', 'svp']);
});

test('the product series picks its promo set', () => {
  assert.strictEqual(defaultPromoSet(sets, 'sv3pt5').id, 'svp');
  assert.strictEqual(defaultPromoSet(sets, 'me1').id, 'mep');
});

test('an unknown product set falls back to the newest promo set', () => {
  assert.strictEqual(defaultPromoSet(sets, '').id, 'mep');
  assert.strictEqual(defaultPromoSet(sets.map(({ id, name }) => ({ id, name })), 'sv3pt5').id, 'mep');
  assert.strictEqual(defaultPromoSet([{ id: 'me1', name: 'Mega Evolution' }], 'me1'), null);
});
