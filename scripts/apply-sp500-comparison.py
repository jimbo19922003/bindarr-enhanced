from pathlib import Path
h=Path('backend/src/utils/performanceHistory.js'); c=Path('frontend/src/components/PerformanceChart.jsx')
s,chart=h.read_text(),c.read_text()
marker='// sp500-comparison-v1\n'
if s.startswith(marker):
    assert 'BenchmarkComparison' in chart and 'loadBenchmark' in s
    raise SystemExit(0)
def once(text,old,new):
    if text.count(old)!=1: raise RuntimeError('Source anchor changed: '+old[:90])
    return text.replace(old,new,1)
s=once(s,'loadCurrent = null })','loadCurrent = null, loadBenchmark = null })')
old="      return res.json({ currency: 'USD', timeZone, range, ...window, basis: 'gain-vs-recorded-cost', portfolio: combined.map(point) });"
new="""      const portfolio = combined.map(point);
      const result = { currency: 'USD', timeZone, range, ...window, basis: 'gain-vs-recorded-cost', portfolio };
      if (req.query.benchmark === 'sp500') {
        try { result.sp500 = await (loadBenchmark || require('./sp500Benchmark').loadBenchmark)(portfolio); }
        catch { result.sp500 = { unavailable: true, data: [] }; }
      }
      return res.json(result);"""
s=once(s,old,new)
chart=once(chart,"import { useT } from '../utils/i18n';","import { useT } from '../utils/i18n';\nimport BenchmarkComparison from './BenchmarkComparison';")
chart=once(chart,"const params = new URLSearchParams({ range, currency: 'USD' });","const params = new URLSearchParams({ range, currency: 'USD' });\n    if (view === 'sp500') params.set('benchmark', 'sp500');")
chart=once(chart,'[range, statsTrigger, refresh]','[range, statsTrigger, refresh, view]')
chart=once(chart,"['gainPct', 'Gain / loss (%)']].map","['gainPct', 'Gain / loss (%)'], ['sp500', 'S&P comparison']].map")
chart=once(chart,"{view === 'gainPct' && rows.every","{view === 'sp500' ? <BenchmarkComparison benchmark={report.sp500} /> : view === 'gainPct' && rows.every")
h.write_text(marker+s);c.write_text(chart)
