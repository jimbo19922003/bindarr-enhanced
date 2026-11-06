'use strict';

const { openingReport } = require('./openingAccounting');

// What came out of opened sealed product, in one currency.
//
// Cost is the share taken off each lot when the unit was opened. Known value is
// the current price of the pulls that have one. A pull with no price adds nothing
// and is counted as unpriced, not as zero. Value at opening is the snapshot taken
// when the pull was recorded. Since-open compares only pulls that have both, so a
// missing snapshot cannot look like the cards moved. Nothing is converted: each
// currency is its own report.

function money(cents) {
  return parseFloat((cents / 100).toFixed(2));
}

function add(total, extra, name) {
  if (!Number.isSafeInteger(extra) || !Number.isSafeInteger(total + extra)) {
    throw new RangeError(`${name} is too large`);
  }
  return total + extra;
}

function emptyBucket() {
  return {
    openings: 0,
    units: 0,
    productIds: new Set(),
    costCents: 0,
    knownCents: 0,
    openedCents: 0,
    anySnapshot: false,
    pairedCurrent: 0,
    pairedOpened: 0,
    anyPaired: false,
    recorded: 0,
    unpriced: 0,
    missingSnapshots: 0,
    complete: 0,
    incomplete: 0,
    emptyOpenings: 0,
  };
}

function lineCents(unit, line, quantity) {
  if (line != null && unit != null) throw new TypeError('A pull has either a line value or a unit value');
  if (line == null && unit == null) return null;
  if (line != null) return line;
  return unit * quantity;
}

function addOpening(bucket, opening) {
  const report = openingReport({
    costCents: opening.costCents,
    currency: opening.currency,
    entryComplete: opening.entryComplete,
    pulls: opening.pulls.map(pull => ({
      quantity: pull.quantity,
      unitValueCents: pull.unit,
      lineValueCents: pull.line,
      currency: opening.currency,
      openedUnitValueCents: pull.openedUnit,
      openedLineValueCents: pull.openedLine,
    })),
  });
  bucket.openings += 1;
  bucket.units = add(bucket.units, opening.units, 'Opened units');
  bucket.productIds.add(opening.productId);
  bucket.costCents = add(bucket.costCents, report.costCents, 'Opened cost');
  bucket.knownCents = add(bucket.knownCents, report.knownValueCents, 'Known pull value');
  bucket.recorded = add(bucket.recorded, report.recordedQuantity, 'Recorded pulls');
  bucket.unpriced = add(bucket.unpriced, report.unpricedQuantity, 'Unpriced pulls');
  bucket.missingSnapshots = add(bucket.missingSnapshots, report.missingSnapshotQuantity, 'Missing snapshots');
  if (report.openedValueCents != null) {
    bucket.anySnapshot = true;
    bucket.openedCents = add(bucket.openedCents, report.openedValueCents, 'Value at opening');
  }
  if (report.recordedQuantity === 0) bucket.emptyOpenings += 1;
  if (opening.entryComplete) bucket.complete += 1;
  else bucket.incomplete += 1;
  for (const pull of opening.pulls) {
    const current = lineCents(pull.unit, pull.line, pull.quantity);
    const snap = lineCents(pull.openedUnit, pull.openedLine, pull.quantity);
    if (current == null || snap == null) continue;
    bucket.anyPaired = true;
    bucket.pairedCurrent = add(bucket.pairedCurrent, current, 'Paired current value');
    bucket.pairedOpened = add(bucket.pairedOpened, snap, 'Paired opening value');
  }
}

function present(bucket) {
  const recovery = bucket.costCents > 0
    ? parseFloat(((bucket.knownCents / bucket.costCents) * 100).toFixed(1))
    : null;
  return {
    openings: bucket.openings,
    units: bucket.units,
    products: bucket.productIds.size,
    cost: money(bucket.costCents),
    knownValue: money(bucket.knownCents),
    openedValue: bucket.anySnapshot ? money(bucket.openedCents) : null,
    difference: money(bucket.knownCents - bucket.costCents),
    recoveryPercent: recovery,
    sinceOpen: bucket.anyPaired ? money(bucket.pairedCurrent - bucket.pairedOpened) : null,
    recordedPulls: bucket.recorded,
    unpricedPulls: bucket.unpriced,
    missingSnapshots: bucket.missingSnapshots,
    completeEntries: bucket.complete,
    incompleteEntries: bucket.incomplete,
    emptyOpenings: bucket.emptyOpenings,
  };
}

function openingsFrom(rows) {
  const openings = new Map();
  for (const row of rows || []) {
    let opening = openings.get(row.opening_id);
    if (!opening) {
      opening = {
        productId: row.product_id,
        setName: String(row.set_name || '').trim(),
        productType: row.product_type || 'other',
        currency: row.currency,
        costCents: row.cost_cents,
        units: row.units,
        entryComplete: row.entry_complete === 1 || row.entry_complete === true,
        pulls: [],
      };
      openings.set(row.opening_id, opening);
    }
    if (row.pull_quantity != null) {
      opening.pulls.push({
        quantity: row.pull_quantity,
        unit: row.current_unit_cents,
        line: row.current_line_cents,
        openedUnit: row.opened_unit_cents,
        openedLine: row.opened_line_cents,
      });
    }
  }
  return [...openings.values()];
}

function summarizePerformance(rows) {
  const byCurrency = new Map();
  for (const opening of openingsFrom(rows)) {
    if (!byCurrency.has(opening.currency)) {
      byCurrency.set(opening.currency, { overall: emptyBucket(), sets: new Map(), types: new Map() });
    }
    const bag = byCurrency.get(opening.currency);
    addOpening(bag.overall, opening);
    const setKey = opening.setName.toLowerCase();
    if (!bag.sets.has(setKey)) bag.sets.set(setKey, { name: opening.setName, bucket: emptyBucket() });
    addOpening(bag.sets.get(setKey).bucket, opening);
    const typeKey = opening.productType || 'other';
    if (!bag.types.has(typeKey)) bag.types.set(typeKey, emptyBucket());
    addOpening(bag.types.get(typeKey), opening);
  }
  const currencies = [...byCurrency.keys()].sort();
  return {
    currencies,
    reports: currencies.map(currency => {
      const bag = byCurrency.get(currency);
      const byDifference = (a, b) => a.difference - b.difference || b.cost - a.cost || a.name.localeCompare(b.name);
      const sets = [...bag.sets.values()]
        .map(entry => ({ name: entry.name, ...present(entry.bucket) }))
        .sort(byDifference);
      const productTypes = [...bag.types.entries()]
        .map(([name, bucket]) => ({ name, ...present(bucket) }))
        .sort(byDifference);
      return { currency, overall: present(bag.overall), sets, productTypes };
    }),
  };
}

module.exports = { summarizePerformance };
