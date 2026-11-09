'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveTimeZone, isValidTimeZone, readTimeZone } = require('../src/utils/portfolioTimeZone');
const { dayAt } = require('../src/utils/performanceHistory');

test('timezone defaults to Chicago, respects environment and saved setting, and rejects invalid values', async () => {
  assert.equal(effectiveTimeZone(null, ''), 'America/Chicago');
  assert.equal(effectiveTimeZone(null, 'UTC'), 'UTC');
  assert.equal(effectiveTimeZone('America/Chicago', 'UTC'), 'America/Chicago');
  assert.equal(await readTimeZone({ get: async () => ({ portfolio_time_zone: 'Europe/London' }) }), 'Europe/London');
  for (const value of ['', 'Mars/Olympus', ' America/Chicago', 42, null]) assert.equal(isValidTimeZone(value), false);
  assert.throws(() => effectiveTimeZone('invalid-zone', ''), /Invalid portfolio timezone/);
});

test('Chicago date follows daylight saving at midnight UTC boundaries', () => {
  assert.equal(dayAt(Date.parse('2026-11-09T03:22:24Z'), 'America/Chicago'), '2026-11-08');
  assert.equal(dayAt(Date.parse('2026-11-09T06:00:00Z'), 'America/Chicago'), '2026-11-09');
  assert.equal(dayAt(Date.parse('2026-07-01T04:59:59Z'), 'America/Chicago'), '2026-06-30');
  assert.equal(dayAt(Date.parse('2026-07-01T05:00:00Z'), 'America/Chicago'), '2026-07-01');
});
