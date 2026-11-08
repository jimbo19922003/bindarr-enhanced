// sale-aware-timeline-v1
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dayAt, bounds, point, createPerformanceHandler } = require('./performanceHistory');
const instant = Date.parse('2026-11-08T03:38:00Z');
test('snapshot day uses collector timezone, not browser timezone', () => {
  assert.equal(dayAt(instant, 'UTC'), '2026-11-08');
  assert.equal(dayAt(instant, 'America/Chicago'), '2026-11-07');
  assert.deepEqual(bounds('7d', instant, 'UTC'), { from: '2026-11-02', to: '2026-11-08' });
  assert.equal(bounds('all', instant, 'UTC').from, '0001-01-01');
  assert.throws(() => bounds('invalid', instant, 'UTC'));
});
test('gain uses each observation cost; zero cost has no percentage', () => {
  assert.equal(point({ value_cents: 15000, invested_cents: 10000 }).legacyGainPct, 50);
  assert.equal(point({ value_cents: 30000, invested_cents: 20000 }).legacyGainPct, 50);
  assert.equal(point({ value_cents: 100, invested_cents: 0 }).gainPct, null);
});
test('handler scopes reads to authenticated owner and canonical snapshot dimensions', async () => {
  let parameters, body;
  const db = { run: async () => {}, all: async (sql, params) => { parameters = params; return []; } };
  const res = { set() {}, status(code) { this.code = code; return this; }, json(value) { body = value; return this; } };
  const handler = createPerformanceHandler({ db, now: () => instant, timeZone: 'UTC' });
  await handler({ user: { id: 42 }, query: { range: '7d' } }, res);
  assert.deepEqual(parameters, [42, '', 'USD', 'UTC', '2026-11-02', '2026-11-08']);
  assert.equal(body.basis, 'gain-vs-recorded-cost');
  await handler({ user: { id: 42 }, query: { currency: 'EUR' } }, res);
  assert.equal(res.code, 400);
  await handler({ query: {} }, res);
  assert.equal(res.code, 401);
});
