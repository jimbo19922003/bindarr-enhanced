// sale-aware-timeline-v1
'use strict';
const { dailySchema, dailyUpsert } = require('../../../shared/investmentLedgerSchema.json');
function createCollector({ db, getPortfolio, createValuation, connectRead, now = Date.now, timeZone = 'America/Chicago', getTimeZone = async () => timeZone, scopes = ['', 'pokemon', 'mtg', 'lorcana'] }) {
  let ready, inflight;
  async function run() {
    if (!ready) ready = db.run(dailySchema).then(() => db.run(require('./timelineAccounting').schema)).catch(error => { ready = null; throw error; });
    await ready;
    const timeZone = await getTimeZone();
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const users = await db.all('SELECT id FROM users ORDER BY id');
    const result = { captured: 0, errors: [] };
    for (const user of users) for (const game of scopes) {
      let connection, reading = false;
      try {
        connection = await connectRead();
        const timestamp = now(), valuation = createValuation('USD');
        await connection.run('BEGIN'); reading = true;
        const portfolio = await getPortfolio(user.id, game, valuation, connection);
        const { accounting } = await require('./dashboardAccounting').readDashboardAccounting(connection,user.id,game,valuation,portfolio,require('./performanceHistory').dayAt(timestamp,timeZone));
        const ledger = await connection.get('SELECT COALESCE(MAX(id),0) AS ledger_id FROM investment_event WHERE user_id = ?', [user.id]);
        await connection.run('COMMIT'); reading = false;
        const value = Math.round(portfolio.totalValue * 100), invested = Math.round(portfolio.totalSpent * 100);
        const cards = Math.round(portfolio.cardValue * 100), sealed = Math.round(portfolio.sealed.holdings.marketValue * 100);
        if (![value, invested, cards, sealed].every(amount => Number.isSafeInteger(amount) && amount >= 0) || cards + sealed !== value) throw new Error('Invalid normalized performance values');
        const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
        const day = `${parts.year}-${parts.month}-${parts.day}`, gain = value - invested;
        const roi = invested > 0 ? Number((gain / invested * 100).toFixed(6)) : null;
        const unpriced = (portfolio.cards || []).reduce((sum, card) => sum + (card.price_trend > 0 ? 0 : card.quantity || 1), 0);
        await connection.run('BEGIN IMMEDIATE'); reading = true;
        await connection.run(dailyUpsert, [user.id, game, 'USD', timeZone, day, timestamp, value, cards, sealed, invested, gain, roi, ledger.ledger_id, valuation.metadata().staleRates ? 1 : 0, unpriced, portfolio.sealed.holdings.unpricedUnits || 0]);
        await require('./timelineAccounting').save(connection,[user.id,game,'USD',timeZone,day,timestamp],accounting);
        await connection.run('COMMIT'); reading = false;
        result.captured++;
      } catch (error) {
        if (reading) await connection.run('ROLLBACK').catch(() => {});
        result.errors.push({ userId: user.id, game, error: error.code || error.message });
      } finally { if (connection) await connection.close().catch(() => {}); }
    }
    return result;
  }
  return { tick() {
    if (!inflight) inflight = run().finally(() => { inflight = null; });
    return inflight;
  } };
}
async function openConnection(db) {
  const sqlite3 = require('sqlite3'); let connection;
  await new Promise((resolve, reject) => { connection = new sqlite3.Database(db.dbPath, sqlite3.OPEN_READWRITE, error => error ? reject(error) : resolve()); });
  const run = (sql, params = []) => new Promise((resolve, reject) => connection.run(sql, params, function(error) { error ? reject(error) : resolve({ changes: this.changes }); }));
  const get = (sql, params = []) => new Promise((resolve, reject) => connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
  const all = (sql, params = []) => new Promise((resolve, reject) => connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
  const close = () => new Promise((resolve, reject) => connection.close(error => error ? reject(error) : resolve()));
  try { await run('PRAGMA foreign_keys = ON'); await run('PRAGMA busy_timeout = 5000'); } catch (error) { await close(); throw error; }
  return { run, get, all, close };
}
let active;
function start() {
  if (active) return active.collector;
  const db = require('../db');
  const requested = Number(process.env.PORTFOLIO_SAMPLE_MINUTES || 15);
  const minutes = Number.isFinite(requested) && requested >= 1 && requested <= 1440 ? requested : 15;
  const collector = createCollector({ db, getPortfolio: require('./currentPortfolio').currentPortfolio, createValuation: require('./reportingValuation').createReportingValuation, connectRead: () => openConnection(db), getTimeZone: () => require('./portfolioTimeZone').readTimeZone(db) });
  const sample = async () => {
    try {
      await require('./currencyConversion').refreshIfDue();
      const result = await collector.tick();
      for (const error of result.errors) console.warn('Daily performance sample failed:', error.userId, error.game, error.error);
    } catch (error) { console.warn('Daily performance collector failed:', error.code || error.message); }
  };
  const timer = setInterval(() => { void sample(); }, minutes * 60000);
  timer.unref?.(); active = { collector, timer }; void sample();
  return collector;
}
function stop() { if (active) { clearInterval(active.timer); active = null; } }
module.exports = { createCollector, start, stop };
