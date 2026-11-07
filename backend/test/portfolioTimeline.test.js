const test = require('node:test');
const assert = require('node:assert/strict');
const { currentValues, timelinePoints, createHistoryHandler } = require('../src/utils/portfolioTimeline');
const price = row => row.market_value ?? row.price_trend ?? 0;
const holdings = rows => ({ marketValue: rows.reduce((sum, row) => sum + (row.marketPriceCents ?? 0) * row.remainingQuantity / 100, 0) });

test('combined value, rip, zero-dollar pull and unrip do not double count', () => {
  const sealed = [{ remainingQuantity: 1, marketPriceCents: 4999 }];
  assert.equal(currentValues([], sealed, price, holdings).totalCents, 4999);
  assert.equal(currentValues([{ quantity: 1, price_trend: 0 }], [], price, holdings).totalCents, 0);
  assert.equal(currentValues([], sealed, price, holdings).totalCents, 4999);
  assert.equal(currentValues([{ quantity: 2, price_trend: 10 }], sealed, price, holdings).totalCents, 6999);
  assert.equal(currentValues([], [], price, holdings).totalCents, 0);
});
test('only recorded observations are returned; historical values are not rewritten', () => {
  const rows = [
    { recorded_at: 1000, cards_cents: 2000, sealed_cents: 4999, total_cents: 6999 },
    { recorded_at: 2000, cards_cents: 0, sealed_cents: 4999, total_cents: 4999 },
    { recorded_at: 3000, cards_cents: 0, sealed_cents: 0, total_cents: 0 },
  ];
  assert.deepEqual(timelinePoints(rows).map(row => row.value), [69.99, 49.99, 0]);
  assert.deepEqual(timelinePoints([]), []);
});
test('empty portfolios still record zero and history queries are scoped by user and game', async () => {
  const writes = [];
  const queries = [];
  const db = {
    run: async (sql, params) => { writes.push({ sql, params }); },
    all: async (sql, params) => { queries.push({ sql, params }); return []; },
  };
  let result;
  const res = { set() {}, json(value) { result = value; }, status() { throw new Error('Unexpected error response'); } };
  await createHistoryHandler({ db, resolveCardPrice: price, summarizeHoldings: holdings })({ user: { id: 7 }, query: { game: 'mtg', period: '7d' } }, res);
  assert.equal(writes[1].params[0], 7);
  assert.equal(writes[1].params[1], 'mtg');
  assert.deepEqual(writes[1].params.slice(3), [0, 0, 0]);
  assert.deepEqual(queries[queries.length - 1].params.slice(0, 2), [7, 'mtg']);
  assert.equal(queries.some(query => query.sql.includes('FROM sealed_lot')), false);
  assert.deepEqual(result, []);
});
