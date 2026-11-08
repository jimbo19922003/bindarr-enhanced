const test = require('node:test');
const assert = require('node:assert/strict');
const { currentValues, timelinePoints, createHistoryHandler } = require('../src/utils/portfolioTimeline');

test('combined values do not count an opened unit twice', () => {
  const price = row => row.price_trend || 0;
  const holdings = rows => ({ marketValue: rows.reduce((sum, row) => sum + row.remainingQuantity * row.marketPriceCents / 100, 0) });
  assert.equal(currentValues([], [{ remainingQuantity: 1, marketPriceCents: 4999 }], price, holdings).totalCents, 4999);
  assert.equal(currentValues([{ quantity: 1, price_trend: 0 }], [], price, holdings).totalCents, 0);
});
test('one latest observation per local calendar day, without mutating observations', () => {
  const rows = [
    { recorded_at: Date.parse('2026-11-07T08:00:00Z'), cards_cents: 300, sealed_cents: 0, total_cents: 300 },
    { recorded_at: Date.parse('2026-11-07T05:30:00Z'), cards_cents: 100, sealed_cents: 0, total_cents: 100 },
    { recorded_at: Date.parse('2026-11-07T06:30:00Z'), cards_cents: 200, sealed_cents: 0, total_cents: 200 },
  ];
  const original = JSON.stringify(rows);
  const points = timelinePoints(rows, 'America/Chicago', 'USD');
  assert.deepEqual(points.map(point => [point.date, point.value]), [['2026-11-06', 1], ['2026-11-07', 3]]);
  assert.equal(JSON.stringify(rows), original);
  assert.deepEqual(timelinePoints([]), []);
});
test('history stores normalized values and scopes by user, game, currency', async () => {
  const writes = [], queries = [], stored = [];
  const db = {
    run: async (sql, params) => { writes.push({ sql, params }); if (sql.startsWith('INSERT')) stored.push({ recorded_at: params[3], cards_cents: params[4], sealed_cents: params[5], total_cents: params[6] }); },
    all: async (sql, params) => { queries.push({ sql, params }); return stored; },
  };
  let timestamp = Date.parse('2026-11-07T14:00:00Z'), cardValue = 68.56, result;
  const getPortfolio = async (user, game, valuation) => {
    assert.equal(user, 7); assert.equal(game, 'pokemon'); assert.equal(valuation.target, 'USD');
    return { cardValue, totalValue: Number((cardValue + 9.99).toFixed(2)), sealed: { holdings: { marketValue: 9.99 } } };
  };
  const handler = createHistoryHandler({ db, getPortfolio, now: () => timestamp });
  const req = { user: { id: 7 }, query: { game: 'pokemon', period: '7d', currency: 'USD', timezone: 'America/Chicago' } };
  const res = { set() {}, json(value) { result = value; }, status(code) { throw new Error(`Unexpected ${code}`); } };
  await handler(req, res);
  assert.equal(result.length, 1); assert.equal(result[0].value, 78.55);
  assert.deepEqual(writes[1].params.slice(0, 3), [7, 'pokemon', 'USD']);
  assert.deepEqual(writes[1].params.slice(4), [6856, 999, 7855]);
  timestamp += 3600000; cardValue = 70; await handler(req, res);
  assert.equal(stored.length, 2); assert.equal(result.length, 1); assert.equal(result[0].value, 79.99);
  assert.deepEqual(queries[0].params.slice(0, 3), [7, 'pokemon', 'USD']);
  assert.ok(queries.every(query => query.sql.includes('FROM portfolio_valuation_snapshot')));
});
test('failed conversion does not record an unconverted snapshot', async () => {
  const writes = []; let status;
  const handler = createHistoryHandler({ db: { run: async sql => { writes.push(sql); } }, getPortfolio: async () => { throw Object.assign(new Error('FX unavailable'), { status: 503 }); } });
  await handler({ user: { id: 1 }, query: {} }, { set() {}, status(code) { status = code; return this; }, json() {} });
  assert.equal(status, 503); assert.equal(writes.some(sql => sql.startsWith('INSERT')), false);
});
