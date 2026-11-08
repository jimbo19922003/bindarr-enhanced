import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useT } from '../utils/i18n';
export default function BenchmarkComparison({benchmark}) {
  const {locale}=useT();
  const percent=value=>`${Number(value).toLocaleString(locale,{maximumFractionDigits:2})}%`;
  if (!benchmark || benchmark.unavailable) return <div className="portfolio-chart-state" role="status">S&amp;P data unavailable. Other views are unaffected.</div>;
  const data=benchmark.data || [], latest=data[data.length-1];
  return <>
    <div className="portfolio-benchmark-note">Value change, not investment return · S&amp;P excludes dividends</div>
    {!data.length ? <div className="portfolio-chart-state">No overlapping history yet.</div> : <div className="portfolio-chart-canvas">
      <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{top:12,right:12,left:0,bottom:0}}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border-glass)" />
        <XAxis dataKey="date" minTickGap={32} tickLine={false} axisLine={false} fontSize={11} stroke="var(--text-secondary)" tickFormatter={value=>new Intl.DateTimeFormat(locale,{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(`${value}T00:00:00Z`))} />
        <YAxis width={76} tickFormatter={percent} tickLine={false} axisLine={false} fontSize={11} stroke="var(--text-secondary)" />
        <ReferenceLine y={0} stroke="#94a3b8" />
        <Tooltip formatter={(value,name)=>[percent(value),name]} labelFormatter={(label,payload)=>`${label} · index close ${payload?.[0]?.payload?.benchmarkAsOf || 'unavailable'}`} contentStyle={{background:'var(--bg-secondary)',borderColor:'var(--border-glass)',borderRadius:8}} />
        <Legend iconType="plainline" iconSize={14} wrapperStyle={{fontSize:12,paddingTop:12}} />
        <Line type="linear" dataKey="holdingsValuePct" name="Holdings value" stroke="#3b82f6" strokeWidth={2} dot={data.length===1 ? {r:5} : false} activeDot={{r:5}} connectNulls={false} isAnimationActive={false} />
        <Line type="linear" dataKey="sp500Pct" name="S&P 500" stroke="#f59e0b" strokeWidth={2} dot={data.length===1 ? {r:5} : false} activeDot={{r:5}} connectNulls={false} isAnimationActive={false} />
      </LineChart></ResponsiveContainer>
    </div>}
    <div className="portfolio-benchmark-meta">
      <span>{latest ? `Index close ${latest.benchmarkAsOf}` : 'Waiting for history'}{data.length===1 ? ' · Baseline only' : ''}</span>
      {benchmark.stale && <span className="portfolio-warning" role="status">Cached index data</span>}
      <details className="portfolio-about"><summary>Benchmark details</summary><p>Both series start at 0% on {benchmark.baseDate || 'the first shared portfolio date'}. Holdings-value change includes purchases, sales and removals; it is not an investment-return comparison. Calendar dates are not synchronized intraday quotes. Non-trading dates use the prior available close, never a future close.</p><p>Baseline index close: {benchmark.baseIndexAsOf || 'unavailable'}. Available index history: {benchmark.firstAvailableDate} to {benchmark.lastCloseDate}. One shared day produces baseline dots, not a historical curve.</p><p>Source: <a href="https://fred.stlouisfed.org/series/SP500" target="_blank" rel="noreferrer">FRED / S&amp;P Dow Jones Indices</a>. Price index only, excluding dividends. The benchmark never changes holdings, recorded cost or gains.</p></details>
    </div>
  </>;
}
