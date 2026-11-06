'use strict';
const assert = require('node:assert/strict');
const { allocateOpening, allocatePullCost, openingReport, summarizeOpening } = require('../src/utils/openingAccounting');

let lot = { remainingQuantity: 3, remainingCostCents: 1000 };
let allocated = 0;
for (const expected of [333, 333, 334]) {
  const result = allocateOpening({ ...lot, quantity: 1 });
  assert.equal(result.costCents, expected);
  allocated += result.costCents;
  lot = result;
}
assert.equal(allocated, 1000);
assert.equal(lot.remainingQuantity, 0);
assert.equal(lot.remainingCostCents, 0);
assert.throws(() => allocateOpening({ remainingQuantity: 1, remainingCostCents: 500, quantity: 2 }), RangeError);
assert.throws(() => allocateOpening({ remainingQuantity: 2, remainingCostCents: 500, quantity: 0 }), TypeError);
assert.throws(() => allocateOpening({ remainingQuantity: 2, remainingCostCents: 1.5, quantity: 1 }), TypeError);
assert.equal(allocateOpening({ remainingQuantity: 2, remainingCostCents: 0, quantity: 1 }).costCents, 0);

const result = summarizeOpening({
  costCents: 5500,
  currency: 'USD',
  pulls: [
    { quantity: 2, unitValueCents: 1500, currency: 'USD' },
    { quantity: 1, unitValueCents: null },
    { quantity: 3, unitValueCents: 0, currency: 'USD' },
  ],
});
assert.equal(result.knownValueCents, 3000);
assert.equal(result.recordedQuantity, 6);
assert.equal(result.unpricedQuantity, 1);
assert.equal(result.valuationComplete, false);
assert.equal(result.valueDifferenceCents, -2500);
assert.ok(Math.abs(result.costRecoveryPercent - 54.54545454545454) < 1e-10);
assert.equal(summarizeOpening({ costCents: 0, currency: 'USD', pulls: [] }).costRecoveryPercent, null);
assert.throws(() => summarizeOpening({ costCents: 100, currency: 'USD', pulls: [{ quantity: 1, unitValueCents: 100, currency: 'EUR' }] }), RangeError);
assert.throws(() => summarizeOpening({ costCents: 100, currency: 'USD', pulls: [{ quantity: 2, unitValueCents: Number.MAX_SAFE_INTEGER, currency: 'USD' }] }), TypeError);
assert.equal(summarizeOpening({
  costCents: 5500,
  currency: 'USD',
  pulls: [{ quantity: 4, lineValueCents: 3000, currency: 'USD' }],
}).knownValueCents, 3000);
assert.throws(() => summarizeOpening({
  costCents: 100,
  currency: 'USD',
  pulls: [{ quantity: 1, unitValueCents: 100, lineValueCents: 100, currency: 'USD' }],
}), TypeError);

const shares = allocatePullCost({ costCents: 5500, pulls: [{ quantity: 1 }, { quantity: 1 }] });
assert.deepEqual(shares.map(share => share.costCents), [2750, 2750]);
assert.equal(shares.reduce((sum, share) => sum + share.costCents, 0), 5500);
assert.ok(shares.every(share => share.costCents !== 5500));
const remainder = allocatePullCost({ costCents: 100, pulls: [{ quantity: 1 }, { quantity: 1 }, { quantity: 1 }] });
assert.deepEqual(remainder.map(share => share.costCents), [33, 33, 34]);
assert.deepEqual(allocatePullCost({ costCents: 5500, pulls: [{ quantity: 1 }] }), [{ quantity: 1, costCents: 5500 }]);
assert.throws(() => allocatePullCost({ costCents: 100, pulls: [] }), TypeError);

const report = openingReport({
  costCents: 5500,
  currency: 'USD',
  entryComplete: false,
  pulls: [
    { quantity: 2, unitValueCents: 1500, currency: 'USD' },
    { quantity: 1, unitValueCents: null, openedUnitValueCents: 400, currency: 'USD' },
    { quantity: 3, unitValueCents: 0, currency: 'USD' },
  ],
});
assert.equal(report.knownValueCents, 3000);
assert.equal(report.valueDifferenceCents, -2500);
assert.ok(Math.abs(report.costRecoveryPercent - 54.54545454545454) < 1e-10);
assert.equal(report.unpricedQuantity, 1);
assert.equal(report.valuationComplete, false);
assert.equal(report.entryComplete, false);
assert.equal(report.openedValueCents, 400);
assert.equal(report.missingSnapshotQuantity, 5);
assert.equal(report.valueDifferenceKind, 'estimated_unrealized');
assert.equal(openingReport({
  costCents: 5500,
  currency: 'USD',
  entryComplete: true,
  pulls: [{ quantity: 1, unitValueCents: 1000, currency: 'USD', openedUnitValueCents: 900 }],
}).entryComplete, true);
assert.throws(() => openingReport({ costCents: 0, currency: 'USD', entryComplete: 1, pulls: [] }), TypeError);
console.log('openingAccounting tests passed');
