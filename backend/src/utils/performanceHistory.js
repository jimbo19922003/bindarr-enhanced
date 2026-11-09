// sale-aware-timeline-v1
// sp500-comparison-v1
// live-performance-v1
'use strict';
const DAYS = Object.freeze({ '7d': 7, '30d': 30, '90d': 90, '1y': 365, '5y': 1826 });
function dayAt(timestamp, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function bounds(range, timestamp, timeZone) {
  const to = dayAt(timestamp, timeZone);
  if (range === 'all') return { from: '0001-01-01', to };
  if (range === 'ytd') return { from: `${to.slice(0, 4)}-01-01`, to };
  if (!Object.hasOwn(DAYS, range)) throw new RangeError('Unsupported range');
  return { from: new Date(Date.parse(`${to}T00:00:00Z`) - (DAYS[range] - 1) * 86400000).toISOString().slice(0, 10), to };
}
function legacyPoint(row) {
  const gain = row.value_cents - row.invested_cents;
  return { date: row.day, value: row.value_cents / 100, cardsValue: row.cards_cents / 100, sealedValue: row.sealed_cents / 100, invested: row.invested_cents / 100, gain: gain / 100, gainPct: row.invested_cents > 0 ? gain / row.invested_cents * 100 : null, recordedAt: row.recorded_at, isLive: !!row.is_live, staleRates: !!row.stale_rates, unpricedCards: row.unpriced_cards, unpricedSealed: row.unpriced_sealed };
}
function point(row) { return require('./timelineAccounting').decoratePoint(legacyPoint(row),row); }
function createPerformanceHandler({ db, now = Date.now, timeZone, loadCurrent = null, loadBenchmark = null }) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user || req.user.id == null) return res.status(401).json({ error: 'Authentication required' });
    const range = String(req.query.range || '30d'), game = String(req.query.game || '');
    if (!['', 'pokemon', 'mtg', 'lorcana'].includes(game)) return res.status(400).json({ error: 'Unsupported game' });
    if (req.query.currency && String(req.query.currency).toUpperCase() !== 'USD') return res.status(400).json({ error: 'Stored performance history is available in USD only' });
    if (!Object.hasOwn(DAYS, range) && range !== 'all' && range !== 'ytd') return res.status(400).json({ error: 'Unsupported range' });
    try {
      const zone = timeZone ?? await require('./portfolioTimeZone').readTimeZone(db);
      const window = bounds(range, now(), zone);
      const { dailySchema } = require('../../../shared/investmentLedgerSchema.json');
      await db.run(dailySchema);
      await db.run(require('./timelineAccounting').schema);
      const rows = await db.all('SELECT p.*, a.accounting_json FROM portfolio_daily_performance p LEFT JOIN portfolio_accounting_daily a ON a.user_id=p.user_id AND a.game=p.game AND a.currency=p.currency AND a.time_zone=p.time_zone AND a.day=p.day AND a.recorded_at=p.recorded_at WHERE p.user_id = ? AND p.game = ? AND p.currency = ? AND p.time_zone = ? AND p.day BETWEEN ? AND ? ORDER BY p.day', [req.user.id, game, 'USD', zone, window.from, window.to]);
      const params = { db, userId: req.user.id, game, timeZone: zone, now };
      const live = loadCurrent ? await loadCurrent(params) : db.dbPath ? await require('./livePerformance').readCurrentPoint(params) : null;
      const combined = require('./livePerformance').mergeCurrent(rows, live, window.from, window.to);
      const portfolio = combined.map(point);
      const result = { currency: 'USD', timeZone: zone, range, ...window, basis: portfolio.some(p=>p.accountingVersion===2)?'realized-plus-unrealized-v2':'gain-vs-recorded-cost', portfolio };
      if (req.query.benchmark === 'sp500') {
        if (portfolio.some(p=>p.accountingVersion===2)) result.sp500={unavailable:true,data:[],reason:'cash-flow-aware-return-required'};
        else try { result.sp500 = await (loadBenchmark || require('./sp500Benchmark').loadBenchmark)(portfolio); }
        catch { result.sp500 = { unavailable: true, data: [] }; }
      }
      return res.json(result);
    } catch (error) {
      console.error('Performance history failed:', error.code || error.message);
      return res.status(500).json({ error: 'Could not retrieve performance history' });
    }
  };
}
module.exports = { dayAt, bounds, point, createPerformanceHandler };
