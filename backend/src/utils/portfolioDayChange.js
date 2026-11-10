'use strict';
const { dayAt } = require('./performanceHistory');
const { readTimeZone } = require('./portfolioTimeZone');

async function portfolioDayChange(db, userId, game, valuation, currentValue, now = Date.now()) {
  const timeZone = await readTimeZone(db);
  const today = dayAt(now, timeZone);
  const table = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'portfolio_daily_performance'");
  if (!table) return null;
  const previous = await db.get(`SELECT day, value_cents, stale_rates, unpriced_cards, unpriced_sealed
    FROM portfolio_daily_performance WHERE user_id = ? AND game = ? AND currency = 'USD'
    AND time_zone = ? AND day < ? ORDER BY day DESC LIMIT 1`, [userId, game || '', timeZone, today]);
  if (!previous) return null;
  const priorCents = await valuation.cents(previous.value_cents, 'USD');
  return {
    amount: (Math.round(currentValue * 100) - priorCents) / 100,
    since: previous.day,
    timeZone,
    incomplete: !!(previous.stale_rates || previous.unpriced_cards || previous.unpriced_sealed),
  };
}
module.exports = { portfolioDayChange };
