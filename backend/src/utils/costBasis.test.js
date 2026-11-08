'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateOpeningCost, calculateSale } = require('./costBasis');
test('opening allocates by frozen line value and conserves cents', () => {
  const result = allocateOpeningCost(1000, [{ id: 'chase', openingValueCents: 9000 }, { id: 'bulk', openingValueCents: 1000 }], { complete: true });
  assert.deepEqual(result.allocations, [{ id: 'bulk', costCents: 100 }, { id: 'chase', costCents: 900 }]);
  assert.equal(result.pendingCents, 0);
});
test('rounding is deterministic regardless of input order', () => {
  const lines = ['a', 'b', 'c'].map(id => ({ id, openingValueCents: 1 }));
  const result = allocateOpeningCost(100, lines, { complete: true });
  assert.deepEqual(result, allocateOpeningCost(100, [...lines].reverse(), { complete: true }));
  assert.deepEqual(result.allocations.map(line => line.costCents), [34, 33, 33]);
});
test('incomplete and entirely unpriced openings retain pending basis', () => {
  assert.equal(allocateOpeningCost(1000, [{ id: 'a', openingValueCents: 100 }]).pendingCents, 1000);
  assert.equal(allocateOpeningCost(1000, [{ id: 'a', openingValueCents: 0 }], { complete: true }).status, 'pending');
});
test('allocation rejects duplicate IDs and unsafe inputs', () => {
  assert.throws(() => allocateOpeningCost(10, [{ id: 'a', openingValueCents: 1 }, { id: 'a', openingValueCents: 1 }]));
  assert.throws(() => allocateOpeningCost(-1, []));
  assert.throws(() => allocateOpeningCost(10, [{ id: 'a', openingValueCents: 0.5 }]));
});
test('sale subtracts fees and allocated basis; fees can exceed proceeds', () => {
  const result = calculateSale({ proceedsCents: 10000, feesCents: 1000, remainingBasisCents: 900, remainingQuantity: 1, quantity: 1 });
  assert.equal(result.realizedGainCents, 8100);
  assert.equal(result.remainingBasisCents, 0);
  assert.equal(calculateSale({ proceedsCents: 0, feesCents: 100, remainingBasisCents: 0, remainingQuantity: 1, quantity: 1 }).realizedGainCents, -100);
});
test('partial sales conserve basis and the final unit receives residual cents', () => {
  let basis = 100, units = 3, consumed = 0;
  while (units) {
    const sale = calculateSale({ proceedsCents: 100, remainingBasisCents: basis, remainingQuantity: units, quantity: 1 });
    consumed += sale.soldBasisCents; basis = sale.remainingBasisCents; units = sale.remainingQuantity;
  }
  assert.equal(consumed, 100); assert.equal(basis, 0);
});
test('unknown basis is not zero basis and overselling is rejected', () => {
  const sale = { proceedsCents: 1000, remainingQuantity: 1, quantity: 1 };
  assert.equal(calculateSale(sale).realizedGainCents, null);
  assert.equal(calculateSale({ ...sale, remainingBasisCents: 0 }).realizedGainCents, 1000);
  assert.throws(() => calculateSale({ ...sale, quantity: 2 }));
});
