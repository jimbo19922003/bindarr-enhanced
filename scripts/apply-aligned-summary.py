from pathlib import Path
d=Path('frontend/src/components/Dashboard.jsx'); e=Path('frontend/src/locales/en.json')
s,en=d.read_text(),e.read_text()
marker='// aligned-summary-v1\n'
if s.startswith(marker):
    assert 'executive-cards-aligned' in s and "t('dash.portfolioIncludes')" in s
    raise SystemExit(0)
start='      {/* Metrics Summary Grid */}'
end='      <PerformanceChart statsTrigger={statsTrigger} />'
if s.count(start)!=1 or s.count(end)!=1: raise RuntimeError('Executive summary boundaries changed')
a,b=s.index(start),s.index(end)
old=s[a:b]
if old.count('className="metric-value"')!=5 or 'dash.realizedPending' not in old: raise RuntimeError('Unexpected summary card structure')
s=s[:a]+Path('scripts/aligned-summary/summary.jsx').read_text()+s[b:]
anchor="import PerformanceChart from './PerformanceChart';"
if s.count(anchor)!=1: raise RuntimeError('Dashboard import changed')
s=s.replace(anchor,anchor+"\nimport './SummaryCards.css';",1)
anchor='"dash.netWorth": "Net Worth",'
if en.count(anchor)!=1: raise RuntimeError('English label anchor changed')
en=en.replace(anchor,anchor+'\n  "dash.portfolioIncludes": "Cards + sealed products",\n  "dash.avgInvestedShort": "Avg invested: {price} / card",\n  "dash.avgMarketShort": "Avg value: {price} / card",',1)
assert "t('dash.netWorth')" not in s
d.write_text(marker+s);e.write_text(en)
