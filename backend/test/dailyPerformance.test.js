const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollector } = require('../src/utils/dailyPerformance');
test('background samples normalized cost ROI without browser requests and does not overlap', async () => {
  const records = []; let calls = 0;
  const db = { run: async () => {}, all: async () => [{ id: 1 }] };
  const reader = { run: async (sql, params) => { if (sql.startsWith('INSERT')) records.push(params); }, get: async sql => sql.includes('investment_event') ? { ledger_id: 42 } : undefined, all: async sql => sql.includes('FROM collection c JOIN card_cache') ? [{ id: 1, quantity: 1, purchase_price: 100 }] : [], close: async () => {} };
  const collector = createCollector({ db, scopes: [''], timeZone: 'America/Chicago', now: () => Date.parse('2026-11-07T14:00:00Z'),
    createValuation: () => ({ metadata: () => ({ staleRates: false }) }), connectRead: async () => reader,
    getPortfolio: async (user, game, valuation, connection) => { calls++; assert.equal(user, 1); assert.equal(game, ''); assert.equal(connection, reader); return { totalValue: 140, totalSpent: 100, cardValue: 120, cards: [], sealed: { holdings: { marketValue: 20, unpricedUnits: 0 } } }; } });
  const first = collector.tick(), duplicate = collector.tick();
  assert.equal(first, duplicate); const result = await first;
  assert.equal(calls, 1); assert.equal(result.captured, 1); assert.equal(result.errors.length, 0);
  assert.deepEqual(records[0].slice(0, 5), [1, '', 'USD', 'America/Chicago', '2026-11-07']);
  assert.deepEqual(records[0].slice(6, 13), [14000, 12000, 2000, 10000, 4000, 40, 42]);
  const accounting = JSON.parse(records[1][6]);
  assert.equal(accounting.version, 3);
  assert.equal(accounting.recordedRemainingCents, 10000);
  assert.equal(accounting.unrealizedGainCents, 4000);
});
test('failed valuation does not save a fake daily value', async () => {
  const writes = [];
  const connection = { run: async sql => { writes.push(sql); }, get: async () => ({ ledger_id: 0 }), close: async () => {} };
  const collector = createCollector({ db: { run: async () => {}, all: async () => [{ id: 1 }] }, scopes: [''], createValuation: () => ({}), connectRead: async () => connection, getPortfolio: async () => { throw new Error('FX unavailable'); } });
  const result = await collector.tick();
  assert.equal(result.captured, 0); assert.equal(result.errors.length, 1);
  assert.equal(writes.some(sql => sql.startsWith('INSERT')), false); assert.ok(writes.includes('ROLLBACK'));
});
test('timezone changes apply to the next sample without restarting', async () => {
  const records = [];
  let zone = 'America/Chicago';
  const connection = { run: async (sql, params) => { if (sql.startsWith('INSERT INTO portfolio_daily_performance')) records.push(params); }, get: async sql => sql.includes('investment_event') ? { ledger_id: 0 } : undefined, all: async () => [], close: async () => {} };
  const collector = createCollector({
    db: { run: async () => {}, all: async () => [{ id: 1 }] }, scopes: [''],
    getTimeZone: async () => zone, now: () => Date.parse('2026-11-09T03:22:24Z'),
    connectRead: async () => connection, createValuation: () => ({ metadata: () => ({ staleRates: false }) }),
    getPortfolio: async () => ({ totalValue: 20, totalSpent: 10, cardValue: 0, cards: [], sealed: { holdings: { marketValue: 20, unpricedUnits: 0 } } }),
  });
  assert.equal((await collector.tick()).captured, 1);
  zone = 'UTC';
  assert.equal((await collector.tick()).captured, 1);
  assert.deepEqual(records.map(row => row.slice(3, 5)), [['America/Chicago', '2026-11-08'], ['UTC', '2026-11-09']]);
});
