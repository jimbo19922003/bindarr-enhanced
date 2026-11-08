from pathlib import Path
h = Path('backend/src/utils/performanceHistory.js')
c = Path('frontend/src/components/PerformanceChart.jsx')
s, chart = h.read_text(), c.read_text()
marker = '// live-performance-v1\n'
if s.startswith(marker):
    assert 'mergeCurrent' in s and 'Current holdings today' in chart
    raise SystemExit(0)
def once(text, old, new):
    if text.count(old) != 1: raise RuntimeError('Source anchor changed: ' + old[:90])
    return text.replace(old,new,1)
s = once(s, "function createPerformanceHandler({ db, now = Date.now, timeZone = process.env.PORTFOLIO_TIMEZONE || 'UTC' })", "function createPerformanceHandler({ db, now = Date.now, timeZone = process.env.PORTFOLIO_TIMEZONE || 'UTC', loadCurrent = null })")
s = once(s, 'recordedAt: row.recorded_at,', 'recordedAt: row.recorded_at, isLive: !!row.is_live,')
s = once(s, "      return res.json({ currency: 'USD', timeZone, range, ...window, basis: 'gain-vs-recorded-cost', portfolio: rows.map(point) });", "      const params = { db, userId: req.user.id, game, timeZone, now };\n      const live = loadCurrent ? await loadCurrent(params) : db.dbPath ? await require('./livePerformance').readCurrentPoint(params) : null;\n      const combined = require('./livePerformance').mergeCurrent(rows, live, window.from, window.to);\n      return res.json({ currency: 'USD', timeZone, range, ...window, basis: 'gain-vs-recorded-cost', portfolio: combined.map(point) });")
chart = once(chart, 'All games: saved cards + sealed snapshots in USD.', 'All games: current holdings today and saved daily history in USD.')
chart = once(chart, '>Refresh snapshots</button>', '>Refresh timeline</button>')
chart = once(chart, '<p>Latest: {day(latest.date)}', "<p>{latest.isLive ? 'Current holdings today' : 'Latest saved snapshot'}: {day(latest.date)}")
chart = once(chart, 'The dot is your actual record; a history line will develop as more days are saved.', 'The dot shows the available observation; a history line will develop as more days are saved.')
chart = once(chart, 'Refresh reads saved snapshots, not a new valuation.', 'Today reflects current holdings using available quotes; earlier days are saved snapshots.')
h.write_text(marker+s); c.write_text(chart)
