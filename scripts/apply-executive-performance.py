from pathlib import Path

def once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Expected exactly one source anchor: ' + old[:100])
    return text.replace(old, new, 1)

def span(text, first, last, replacement):
    if text.count(first) != 1 or text.count(last) != 1:
        raise RuntimeError('Source boundaries changed; refusing partial patch')
    start = text.index(first)
    end = text.index(last, start)
    return text[:start] + replacement + text[end:]

app_path = Path('frontend/src/App.jsx')
dash_path = Path('frontend/src/components/Dashboard.jsx')
chart_path = Path('frontend/src/components/PerformanceChart.jsx')
app, dash, chart = [p.read_text() for p in (app_path, dash_path, chart_path)]
marker = '// executive-performance-v1\n'
if dash.startswith(marker):
    assert 'DashboardWithPerformance' not in app
    assert '<PerformanceChart statsTrigger={statsTrigger} />' in dash
    assert 'setGame' not in chart and '<select' not in chart
    print('Executive performance patch already applied')
    raise SystemExit(0)

old_wrapper = """const Dashboard = lazy(async () => {
  const [{ default: ExistingDashboard }, { default: PerformanceChart }] = await Promise.all([import('./components/Dashboard'), import('./components/PerformanceChart')]);
  return { default: function DashboardWithPerformance(props) { return <><PerformanceChart statsTrigger={props.statsTrigger} /><ExistingDashboard {...props} /></>; } };
});"""
app = once(app, old_wrapper, "const Dashboard = lazy(() => import('./components/Dashboard'));")
dash = once(dash, "import OpenedPerformance from './OpenedPerformance';", "import OpenedPerformance from './OpenedPerformance';\nimport PerformanceChart from './PerformanceChart';")
dash = once(dash, 'Legend, AreaChart, Area }', 'Legend }')
dash = once(dash, 'cardAverages, formatDayTick, formatDayTooltip, formatMoneyTick', 'cardAverages')
dash = once(dash, "  // Timeline Chart State\n  const [historyData, setHistoryData] = useState([]);\n  const [loadingHistory, setLoadingHistory] = useState(false);\n", '')
first = '  useEffect(() => {\n    if (!stats) return;'
last = '  const fetchStats = async () => {'
old_effect = dash[dash.index(first):dash.index(last)]
if '/api/stats/history?' not in old_effect or '}, [timePeriod, stats, gameFilter, reportingCurrency]);' not in old_effect:
    raise RuntimeError('History effect changed')
dash = span(dash, first, last, '')
first = '      {/* Recorded combined holdings, not a backfilled price-only curve. */}'
last = '      <div className="dashboard-details">'
old_timeline = dash[dash.index(first):dash.index(last, dash.index(first))]
if '<AreaChart data={historyData}' not in old_timeline or '</AreaChart>' not in old_timeline:
    raise RuntimeError('Timeline source changed')
# There are several dashboard-details blocks; guard this specific boundary locally.
start = dash.index(first)
end = dash.index(last, start)
dash = dash[:start] + '      <PerformanceChart statsTrigger={statsTrigger} />\n\n' + dash[end:]
dash = marker + dash
chart = once(chart, "  const [game, setGame] = useState('');\n", '')
chart = once(chart, "new URLSearchParams({ range, game, currency: 'USD' })", "new URLSearchParams({ range, currency: 'USD' })")
chart = once(chart, '[range, game, statsTrigger, refresh]', '[range, statsTrigger, refresh]')
start = chart.index('        <label>Game <select')
end = chart.index('        <button type="button" className="btn btn-secondary"', start)
if chart[start:end].count('<select') != 2:
    raise RuntimeError('Chart selectors changed')
buttons = """        <div role="group" aria-label="Portfolio timeline view" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {[['value', 'Value + cost'], ['gain', 'Gain / loss ($)'], ['gainPct', 'Gain / loss (%)']].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={view === id} className={`btn ${view === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView(id)}>{label}</button>
          ))}
        </div>
"""
chart = chart[:start] + buttons + chart[end:]
chart = once(chart, '>Daily portfolio performance</h3>', '>Portfolio value &amp; recorded cost</h3>')
chart = once(chart, 'Saved cards + sealed snapshots in USD.', 'All games: saved cards + sealed snapshots in USD.')
chart = once(chart, 'No saved snapshots for this game and range.', 'No saved snapshots for this range.')
chart = once(chart, "invested: 'Recorded cost'", "invested: 'Recorded cost (daily)'")
assert 'historyData' not in dash and 'loadingHistory' not in dash
assert 'DashboardWithPerformance' not in app
assert '<select' not in chart and 'setGame' not in chart
assert dash.count('<PerformanceChart statsTrigger={statsTrigger} />') == 1
assert dash.index("{view === 'executive'") < dash.index('<PerformanceChart') < dash.index("{view === 'sealed'")
for path, text in zip((app_path, dash_path, chart_path), (app, dash, chart)):
    path.write_text(text)
print('Prepared Executive-only all-games value/cost timeline and view buttons')
