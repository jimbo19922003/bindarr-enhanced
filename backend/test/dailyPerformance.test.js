const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollector } = require('../src/utils/dailyPerformance');
test('background samples normalized cost ROI without browser requests and does not overlap', async () => {
  const records = []; let calls = 0;
  const db = { run: async () => {}, all: async () => [{ id: 1 }] };
  const reader = { run: async (sql, params) => { if (sql.startsWith('INSERT')) records.push(params); }, get: async () => ({ ledger_id: 42 }), close: async () => {} };
  const collector = createCollector({ db, scopes: [''], timeZone: 'America/Chicago', now: () => Date.parse('2026-11-07T14:00:00Z'),
    createValuation: () => ({ metadata: () => ({ staleRates: false }) }), connectRead: async () => reader,
    getPortfolio: async (user, game, valuation, connection) => { calls++; assert.equal(user, 1); assert.equal(game, ''); assert.equal(connection, reader); return { totalValue: 140, totalSpent: 100, cardValue: 120, cards: [], sealed: { holdings: { marketValue: 20, unpricedUnits: 0 } } }; } });
  const first = collector.tick(), duplicate = collector.tick();
  assert.equal(first, duplicate); const result = await first;
  assert.equal(calls, 1); assert.equal(result.captured, 1); assert.equal(result.errors.length, 0);
  assert.deepEqual(records[0].slice(0, 5), [1, '', 'USD', 'America/Chicago', '2026-11-07']);
  assert.deepEqual(records[0].slice(6, 13), [14000, 12000, 2000, 10000, 4000, 40, 42]);
});
test('failed valuation does not save a fake daily value', async () => {
  const writes = [];
  const connection = { run: async sql => { writes.push(sql); }, get: async () => ({ ledger_id: 0 }), close: async () => {} };
  const collector = createCollector({ db: { run: async () => {}, all: async () => [{ id: 1 }] }, scopes: [''], createValuation: () => ({}), connectRead: async () => connection, getPortfolio: async () => { throw new Error('FX unavailable'); } });
  const result = await collector.tick();
  assert.equal(result.captured, 0); assert.equal(result.errors.length, 1);
  assert.equal(writes.some(sql => sql.startsWith('INSERT')), false); assert.ok(writes.includes('ROLLBACK'));
});
