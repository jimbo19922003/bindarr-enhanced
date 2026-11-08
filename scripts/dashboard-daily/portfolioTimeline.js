'use strict';

// Retained as a compatibility helper; the live history handler below obtains
// its values from the same normalized currentPortfolio service as /stats.
function currentValues(cards, sealed, resolveCardPrice, summarizeHoldings) {
  const cardsValue = cards.reduce((sum, row) => sum + (row.quantity || 1) * resolveCardPrice(row), 0);
  const sealedValue = summarizeHoldings(sealed).marketValue;
  return { cardsCents: Math.round(cardsValue * 100), sealedCents: Math.round(sealedValue * 100), totalCents: Math.round((cardsValue + sealedValue) * 100) };
}
function dayFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
}
function dayKey(timestamp, formatter) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function timelinePoints(rows, timeZone = 'UTC', currency = 'USD') {
  const formatter = dayFormatter(timeZone), daily = new Map();
  for (const row of rows) {
    const timestamp = Number(row.recorded_at);
    if (!Number.isFinite(timestamp)) continue;
    const day = dayKey(timestamp, formatter), previous = daily.get(day);
    if (!previous || timestamp >= Number(previous.recorded_at)) daily.set(day, row);
  }
  return [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => ({
    date, recorded_at: new Date(Number(row.recorded_at)).toISOString(), currency,
    value: row.total_cents / 100, cardsValue: row.cards_cents / 100, sealedValue: row.sealed_cents / 100,
  }));
}
function createHistoryHandler({ db, getPortfolio, now = Date.now }) {
  let ready;
  return async (req, res) => {
    try {
      const timeZone = String(req.query.timezone || 'UTC');
      if (timeZone.length > 80) return res.status(400).json({ error: 'Invalid timeline timezone' });
      let formatter;
      try { formatter = dayFormatter(timeZone); } catch { return res.status(400).json({ error: 'Invalid timeline timezone' }); }
      const { createReportingValuation } = require('./reportingValuation');
      const valuation = createReportingValuation(req.query.currency || 'USD');
      const game = String(req.query.game || ''), userId = req.user.id;
      if (!ready) ready = db.run(`CREATE TABLE IF NOT EXISTS portfolio_valuation_snapshot (
        user_id INTEGER NOT NULL, game TEXT NOT NULL, currency TEXT NOT NULL, recorded_at INTEGER NOT NULL,
        cards_cents INTEGER NOT NULL, sealed_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
        PRIMARY KEY(user_id, game, currency, recorded_at)
      )`).catch(error => { ready = null; throw error; });
      await ready;
      const portfolio = await (getPortfolio || require('./currentPortfolio').currentPortfolio)(userId, game, valuation);
      const cards = Math.round(portfolio.cardValue * 100), sealed = Math.round(portfolio.sealed.holdings.marketValue * 100);
      const total = Math.round(portfolio.totalValue * 100);
      if (![cards, sealed, total].every(value => Number.isSafeInteger(value) && value >= 0) || cards + sealed !== total) throw new Error('Invalid normalized portfolio snapshot');
      const timestamp = now();
      await db.run(`INSERT OR REPLACE INTO portfolio_valuation_snapshot
        (user_id, game, currency, recorded_at, cards_cents, sealed_cents, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, game, valuation.target, timestamp, cards, sealed, total]);
      const days = { '7d': 7, '30d': 30, '1y': 365, '5y': 1826 }[req.query.period] || 30;
      const today = dayKey(timestamp, formatter);
      const startDay = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
      const rows = await db.all(`SELECT recorded_at, cards_cents, sealed_cents, total_cents FROM portfolio_valuation_snapshot
        WHERE user_id = ? AND game = ? AND currency = ? AND recorded_at >= ? AND recorded_at <= ? ORDER BY recorded_at ASC`,
      [userId, game, valuation.target, timestamp - (days + 2) * 86400000, timestamp]);
      res.set('Cache-Control', 'no-store');
      res.set('X-Portfolio-History-Version', '2');
      res.json(timelinePoints(rows, timeZone, valuation.target).filter(point => point.date >= startDay && point.date <= today));
    } catch (error) {
      console.error('Portfolio timeline failed:', error.code || error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to compute normalized portfolio timeline' });
    }
  };
}
module.exports = { currentValues, timelinePoints, createHistoryHandler };
