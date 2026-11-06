'use strict';

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

// Allocate from the remaining lot cost, not a rounded per-unit price.
// The final opening receives the remainder, preserving the original cost exactly.
function allocateOpening({ remainingQuantity, remainingCostCents, quantity }) {
  integer(remainingQuantity, 'remainingQuantity', 1);
  integer(remainingCostCents, 'remainingCostCents');
  integer(quantity, 'quantity', 1);
  if (quantity > remainingQuantity) throw new RangeError('Insufficient sealed quantity');
  const costCents = Number(
    BigInt(remainingCostCents) * BigInt(quantity) / BigInt(remainingQuantity)
  );
  return {
    quantity,
    costCents,
    remainingQuantity: remainingQuantity - quantity,
    remainingCostCents: remainingCostCents - costCents,
  };
}

// Values must already be in the session currency. No implicit FX conversion.
// null means unpriced; zero is an explicitly known zero value.
function summarizeOpening({ costCents, currency, pulls }) {
  integer(costCents, 'costCents');
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError('currency must be an uppercase three-letter code');
  }
  if (!Array.isArray(pulls)) throw new TypeError('pulls must be an array');
  let knownValueCents = 0;
  let recordedQuantity = 0;
  let unpricedQuantity = 0;
  for (const pull of pulls) {
    if (!pull || typeof pull !== 'object') throw new TypeError('Invalid pull');
    integer(pull.quantity, 'pull.quantity', 1);
    recordedQuantity = integer(recordedQuantity + pull.quantity, 'recordedQuantity');
    const lineValue = knownPullCents(pull);
    if (lineValue == null) {
      unpricedQuantity = integer(unpricedQuantity + pull.quantity, 'unpricedQuantity');
      continue;
    }
    if (pull.currency !== currency) throw new RangeError('Pull currency differs from session currency');
    knownValueCents = integer(knownValueCents + lineValue, 'knownValueCents');
  }
  return {
    currency,
    costCents,
    recordedQuantity,
    unpricedQuantity,
    knownValueCents,
    // True when every supplied pull has a known unit value. An empty list is
    // therefore true: nothing supplied was unpriced. It does not mean the
    // opener recorded every card that came out of the product.
    valuationComplete: unpricedQuantity === 0,
    valueDifferenceCents: knownValueCents - costCents,
    costRecoveryPercent: costCents === 0 ? null : knownValueCents / costCents * 100,
  };
}

// A known current value is either one unit price times quantity, or one line
// total for a bulk entry. It is never both. Null is unpriced. Zero is known.
function knownPullCents(pull) {
  const line = pull.lineValueCents;
  const unit = pull.unitValueCents;
  if (line != null && unit != null) throw new TypeError('A pull has either a line value or a unit value');
  if (line == null && unit == null) return null;
  if (line != null) return integer(line, 'pull.lineValueCents');
  integer(unit, 'pull.unitValueCents');
  return integer(unit * pull.quantity, 'lineValueCents');
}

function snapshotCents(pull) {
  const line = pull.openedLineValueCents;
  const unit = pull.openedUnitValueCents;
  if (line != null && unit != null) throw new TypeError('A snapshot has either a line value or a unit value');
  if (line == null && unit == null) return null;
  if (line != null) return integer(line, 'pull.openedLineValueCents');
  integer(unit, 'pull.openedUnitValueCents');
  return integer(unit * pull.quantity, 'openedLineValueCents');
}

// Current value and the optional value-at-opening snapshot are separate.
// entryComplete is the opener saying the list is finished. valuationComplete
// only means every pull that was supplied has a current value.
function openingReport({ costCents, currency, entryComplete, pulls }) {
  if (typeof entryComplete !== 'boolean') throw new TypeError('entryComplete must be a boolean');
  const current = summarizeOpening({ costCents, currency, pulls });
  let openedValueCents = 0;
  let snapshottedQuantity = 0;
  let missingSnapshotQuantity = 0;
  let anySnapshot = false;
  for (const pull of pulls) {
    const snap = snapshotCents(pull);
    if (snap == null) {
      missingSnapshotQuantity = integer(missingSnapshotQuantity + pull.quantity, 'missingSnapshotQuantity');
      continue;
    }
    const code = pull.openedCurrency || pull.currency;
    if (code !== currency) throw new RangeError('Pull currency differs from session currency');
    anySnapshot = true;
    snapshottedQuantity = integer(snapshottedQuantity + pull.quantity, 'snapshottedQuantity');
    openedValueCents = integer(openedValueCents + snap, 'openedValueCents');
  }
  return {
    ...current,
    entryComplete,
    openedValueCents: anySnapshot ? openedValueCents : null,
    snapshottedQuantity,
    missingSnapshotQuantity,
    // The difference is an estimate of unrealized value. It is not money made.
    valueDifferenceKind: 'estimated_unrealized',
  };
}

// Quantity-weighted share of one opening's cost, for a later per-card basis.
// Division is toward zero and the last pull keeps the leftover cent, so the
// shares add back to the opening cost. An unpriced pull still receives a share,
// because a value-weighted split would dump the whole cost onto the priced
// cards. A pull receives the whole cost only when it is the only pull. The
// cost is never copied onto every pull, and nothing here writes a collection
// purchase price.
function allocatePullCost({ costCents, pulls }) {
  integer(costCents, 'costCents');
  if (!Array.isArray(pulls) || pulls.length === 0) throw new TypeError('pulls must be a non-empty array');
  let totalQuantity = 0;
  for (const pull of pulls) {
    if (!pull || typeof pull !== 'object') throw new TypeError('Invalid pull');
    totalQuantity = integer(totalQuantity + integer(pull.quantity, 'pull.quantity', 1), 'totalQuantity');
  }
  let spent = 0;
  return pulls.map((pull, index) => {
    const share = index === pulls.length - 1
      ? costCents - spent
      : Number(BigInt(costCents) * BigInt(pull.quantity) / BigInt(totalQuantity));
    spent += share;
    return { quantity: pull.quantity, costCents: share };
  });
}

module.exports = { allocateOpening, allocatePullCost, openingReport, summarizeOpening };
