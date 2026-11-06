'use strict';

const assert = require('node:assert/strict');
const { summarizePerformance } = require('../src/utils/openingPerformance');

const rows = [
  {
    opening_id: 1, product_id: 10, units: 1, cost_cents: 5500, currency: 'USD', entry_complete: 1,
    set_name: '30th Celebration', product_type: 'etb',
    pull_quantity: 2, current_unit_cents: 1500, current_line_cents: null, opened_unit_cents: 1400, opened_line_cents: null,
  },
  {
    opening_id: 1, product_id: 10, units: 1, cost_cents: 5500, currency: 'USD', entry_complete: 1,
    set_name: '30th Celebration', product_type: 'etb',
    pull_quantity: 1, current_unit_cents: null, current_line_cents: null, opened_unit_cents: null, opened_line_cents: null,
  },
  {
    opening_id: 2, product_id: 11, units: 1, cost_cents: 4000, currency: 'USD', entry_complete: 0,
    set_name: '30th celebration', product_type: 'booster_box',
    pull_quantity: 1, current_unit_cents: 5000, current_line_cents: null, opened_unit_cents: 4800, opened_line_cents: null,
  },
  {
    opening_id: 3, product_id: 12, units: 1, cost_cents: 10000, currency: 'USD', entry_complete: 1,
    set_name: 'Prismatic Evolutions', product_type: 'booster_box',
    pull_quantity: 4, current_unit_cents: 2000, current_line_cents: null, opened_unit_cents: null, opened_line_cents: null,
  },
  {
    opening_id: 4, product_id: 13, units: 1, cost_cents: 2000, currency: 'EUR', entry_complete: 1,
    set_name: '30th Celebration', product_type: 'etb',
    pull_quantity: 1, current_unit_cents: 2500, current_line_cents: null, opened_unit_cents: 2500, opened_line_cents: null,
  },
];

const report = summarizePerformance(rows);
assert.deepEqual(report.currencies, ['EUR', 'USD']);

const usd = report.reports.find(item => item.currency === 'USD');
assert.equal(usd.overall.openings, 3);
assert.equal(usd.overall.units, 3);
assert.equal(usd.overall.products, 3);
assert.equal(usd.overall.cost, 195);
assert.equal(usd.overall.knownValue, 160);
assert.equal(usd.overall.difference, -35);
assert.equal(usd.overall.recoveryPercent, 82.1);
assert.equal(usd.overall.openedValue, 76);
assert.equal(usd.overall.sinceOpen, 4);
assert.equal(usd.overall.recordedPulls, 8);
assert.equal(usd.overall.unpricedPulls, 1);
assert.equal(usd.overall.missingSnapshots, 5);
assert.equal(usd.overall.completeEntries, 2);
assert.equal(usd.overall.incompleteEntries, 1);
assert.equal(usd.overall.emptyOpenings, 0);

const celebration = usd.sets.find(item => item.name === '30th Celebration');
assert.equal(celebration.openings, 2);
assert.equal(celebration.products, 2);
assert.equal(celebration.cost, 95);
assert.equal(celebration.knownValue, 80);
assert.equal(celebration.difference, -15);
assert.equal(celebration.sinceOpen, 4);
assert.ok(usd.sets.find(item => item.name === 'Prismatic Evolutions'));
assert.equal(usd.sets[0].name, 'Prismatic Evolutions');

const etb = usd.productTypes.find(item => item.name === 'etb');
const box = usd.productTypes.find(item => item.name === 'booster_box');
assert.equal(etb.cost, 55);
assert.equal(etb.knownValue, 30);
assert.equal(box.openings, 2);
assert.equal(box.cost, 140);
assert.equal(box.knownValue, 130);

const eur = report.reports.find(item => item.currency === 'EUR');
assert.equal(eur.overall.cost, 20);
assert.equal(eur.overall.knownValue, 25);
assert.equal(eur.overall.difference, 5);
assert.equal(eur.overall.sinceOpen, 0);
assert.equal(eur.sets.length, 1);

const blank = summarizePerformance([]);
assert.deepEqual(blank, { currencies: [], reports: [] });

const unlisted = summarizePerformance([{
  opening_id: 9, product_id: 1, units: 1, cost_cents: 1000, currency: 'USD', entry_complete: 0,
  set_name: '', product_type: 'tin', pull_quantity: null,
}]);
assert.equal(unlisted.reports[0].overall.emptyOpenings, 1);
assert.equal(unlisted.reports[0].overall.knownValue, 0);
assert.equal(unlisted.reports[0].overall.difference, -10);
assert.equal(unlisted.reports[0].overall.openedValue, null);
assert.equal(unlisted.reports[0].overall.sinceOpen, null);
assert.equal(unlisted.reports[0].sets[0].name, '');

console.log('openingPerformance.test.js: all assertions passed');
