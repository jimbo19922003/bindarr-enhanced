// sale-aware-timeline-v1
'use strict';
function mergeCurrent(rows, live, from, to) {
  const days = new Map(rows.map(row => [row.day, row]));
  if (live && live.day >= from && live.day <= to) days.set(live.day, live);
  return [...days.values()].sort((a,b) => a.day.localeCompare(b.day));
}
async function readCurrentPoint({ db, userId, game, timeZone, now = Date.now, connectRead, getPortfolio, createValuation }) {
  const connect = connectRead || (() => require('./salesRepository').openConnection(db.dbPath));
  const portfolioFor = getPortfolio || require('./currentPortfolio').currentPortfolio;
  const valueFor = createValuation || require('./reportingValuation').createReportingValuation;
  const connection = await connect(); let reading = false;
  try {
    await connection.run('BEGIN'); reading = true;
    const timestamp = now(), valuation = valueFor('USD');
    const portfolio = await portfolioFor(userId, game, valuation, connection);
    const accounting = typeof connection.get === 'function' && typeof connection.all === 'function' ? (await require('./dashboardAccounting').readDashboardAccounting(connection,userId,game,valuation,portfolio,require('./performanceHistory').dayAt(timestamp,timeZone))).accounting : null;
    await connection.run('COMMIT'); reading = false;
    const value = Math.round(portfolio.totalValue * 100), cost = Math.round(portfolio.totalSpent * 100);
    const cards = Math.round(portfolio.cardValue * 100), sealed = Math.round(portfolio.sealed.holdings.marketValue * 100);
    if (![value,cost,cards,sealed].every(n => Number.isSafeInteger(n) && n >= 0) || cards + sealed !== value) throw new RangeError('Invalid current portfolio totals');
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp)).map(p => [p.type,p.value]));
    return { accounting, day: `${parts.year}-${parts.month}-${parts.day}`, value_cents: value, cards_cents: cards, sealed_cents: sealed, invested_cents: cost, recorded_at: timestamp, stale_rates: valuation.metadata().staleRates ? 1 : 0, unpriced_cards: (portfolio.cards || []).reduce((n,card) => n + (card.price_trend > 0 ? 0 : card.quantity || 1),0), unpriced_sealed: portfolio.sealed.holdings.unpricedUnits || 0, is_live: 1 };
  } catch (error) { if (reading) await connection.run('ROLLBACK').catch(() => {}); throw error; }
  finally { await connection.close(); }
}
module.exports = { mergeCurrent, readCurrentPoint };
