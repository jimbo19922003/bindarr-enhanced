import assert from 'node:assert/strict';
import test from 'node:test';
import { sealedPackGroups } from './sealedPackGroups.js';

const pack = (id, changes = {}) => ({
  id, product_id: 2, parent_opening_id: 7, quantity: 1, remaining_quantity: 1,
  total_cost_cents: 701, remaining_cost_cents: 701, currency: 'USD',
  purchased_at: '2026-11-12', ...changes,
});

test('thirty packs become one display group while retaining exact action targets and cent totals', () => {
  const lots = Array.from({ length: 30 }, (_, index) => pack(index + 1, index === 29 ? { total_cost_cents: 721, remaining_cost_cents: 721 } : {}));
  const [group] = sealedPackGroups(lots);
  assert.equal(sealedPackGroups(lots).length, 1);
  assert.equal(group.quantity, 30);
  assert.equal(group.remaining, 30);
  assert.equal(group.costCents, 21050);
  assert.equal(group.remainingCostCents, 21050);
  assert.deepEqual(group.lots, lots);
  assert.equal(group.lots[0], lots[0]);
});

test('ripped packs reduce remaining quantities without losing their individual history', () => {
  const lots = [pack(1, { remaining_quantity: 0, remaining_cost_cents: 0 }), pack(2)];
  const [group] = sealedPackGroups(lots);
  assert.equal(group.quantity, 2);
  assert.equal(group.remaining, 1);
  assert.equal(group.remainingCostCents, 701);
  assert.equal(group.lots.find(lot => lot.remaining_quantity > 0).id, 2);
});

test('different source openings, products, locations, archived lots and purchased lots stay separate', () => {
  const lots = [
    pack(1), pack(2, { parent_opening_id: 8 }), pack(3, { product_id: 3 }),
    pack(4, { location_id: 4 }), pack(5, { archived_at: '2026-11-12' }),
    pack(6, { parent_opening_id: null }), pack(7, { parent_opening_id: null }),
  ];
  assert.equal(sealedPackGroups(lots).length, lots.length);
});
