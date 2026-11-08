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
function point(row) {
  const gain = row.value_cents - row.invested_cents;
  return { date: row.day, value: row.value_cents / 100, cardsValue: row.cards_cents / 100, sealedValue: row.sealed_cents / 100, invested: row.invested_cents / 100, gain: gain / 100, gainPct: row.invested_cents > 0 ? gain / row.invested_cents * 100 : null, recordedAt: row.recorded_at, isLive: !!row.is_live, staleRates: !!row.stale_rates, unpricedCards: row.unpriced_cards, unpricedSealed: row.unpriced_sealed };
}
function createPerformanceHandler({ db, now = Date.now, timeZone = process.env.PORTFOLIO_TIMEZONE || 'UTC', loadCurrent = null, loadBenchmark = null }) {
  try { dayAt(now(), timeZone); } catch { timeZone = 'UTC'; }
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user || req.user.id == null) return res.status(401).json({ error: 'Authentication required' });
    const range = String(req.query.range || '30d'), game = String(req.query.game || '');
    if (!['', 'pokemon', 'mtg', 'lorcana'].includes(game)) return res.status(400).json({ error: 'Unsupported game' });
    if (req.query.currency && String(req.query.currency).toUpperCase() !== 'USD') return res.status(400).json({ error: 'Stored performance history is available in USD only' });
    let window;
    try { window = bounds(range, now(), timeZone); } catch { return res.status(400).json({ error: 'Unsupported range' }); }
    try {
      const { dailySchema } = require('../../../shared/investmentLedgerSchema.json');
      await db.run(dailySchema);
      const rows = await db.all('SELECT * FROM portfolio_daily_performance WHERE user_id = ? AND game = ? AND currency = ? AND time_zone = ? AND day BETWEEN ? AND ? ORDER BY day', [req.user.id, game, 'USD', timeZone, window.from, window.to]);
      const params = { db, userId: req.user.id, game, timeZone, now };
      const live = loadCurrent ? await loadCurrent(params) : db.dbPath ? await require('./livePerformance').readCurrentPoint(params) : null;
      const combined = require('./livePerformance').mergeCurrent(rows, live, window.from, window.to);
      const portfolio = combined.map(point);
      const result = { currency: 'USD', timeZone, range, ...window, basis: 'gain-vs-recorded-cost', portfolio };
      if (req.query.benchmark === 'sp500') {
        try { result.sp500 = await (loadBenchmark || require('./sp500Benchmark').loadBenchmark)(portfolio); }
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
