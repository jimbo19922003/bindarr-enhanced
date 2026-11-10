// dashboard-accounting-v1
// sale-aware-timeline-v1
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useT } from '../utils/i18n';
import BenchmarkComparison from './BenchmarkComparison';
import './PerformanceChart.css';
const ranges = ['7d','30d','90d','ytd','1y','5y','all'];
const views = [['value','Value + cost'],['gain','Loss/Gain $'],['gainPct','Estimated Loss/Gain %'],['sp500','S&P 500']];
export default function PerformanceChart({ statsTrigger, game = '' }) {
  const { locale } = useT();
  const [range,setRange] = useState('30d'), [view,setView] = useState('value');
  const [report,setReport] = useState(null), [loading,setLoading] = useState(true), [error,setError] = useState('');
  const [refresh,setRefresh] = useState(0);
  const withBenchmark = view === 'sp500';
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setReport(null); setLoading(true); setError('');
    const params = new URLSearchParams({range,currency:'USD'});
    if (game) params.set('game',game);
    if (withBenchmark) params.set('benchmark','sp500');
    fetch(`/api/stats/performance?${params}`,{signal:controller.signal,cache:'no-store'})
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load portfolio history');
        if (data.currency !== 'USD' || !Array.isArray(data.portfolio)) throw new Error('Unexpected performance response');
        return data;
      })
      .then(data => {if (current) setReport(data);})
      .catch(err => {if (current && err.name !== 'AbortError') setError(err.message);})
      .finally(() => {if (current) setLoading(false);});
    return () => {current=false;controller.abort();};
  },[range,statsTrigger,refresh,withBenchmark,game]);
  const money = value => new Intl.NumberFormat(locale,{style:'currency',currency:'USD'}).format(value);
  const percent = value => `${Number(value).toLocaleString(locale,{maximumFractionDigits:2})}%`;
  const date = (value,full=false) => new Intl.DateTimeFormat(locale,{timeZone:'UTC',month:'short',day:'numeric',...(full ? {year:'numeric'} : {})}).format(new Date(`${value}T00:00:00Z`));
  const rows = (report?.portfolio || []).map(row=>({...row,realizedKnown:row.realizedGain ?? (row.unknownSaleCount>0 ? row.knownRealizedGain : null)}));
  const labels = {value:'Market value',invested:'Estimated Investment Cost',gain:'Total Loss/Gain',gainPct:'Estimated Loss/Gain %',totalGain:'Total Loss/Gain',realizedKnown:'Known Realized Loss/Gain',unrealizedGain:'Estimated Unrealized Loss/Gain'};
  const series = view === 'value' ? ['value','invested'] : view === 'gain' ? ['totalGain','realizedKnown','unrealizedGain'] : [view];
  const incomplete = rows.some(row => row.staleRates || row.unpricedCards > 0 || row.unpricedSealed > 0 || row.unknownBasisCount > 0 || row.unknownSaleCount > 0 || row.spendingUnknownCount > 0);
  return <section className="glass-panel portfolio-timeline" aria-label="Portfolio timeline" aria-busy={loading}>
    <header className="portfolio-timeline-header">
      <h3 className="chart-title">Portfolio timeline</h3>
      <div className="portfolio-timeline-actions">
        <div className="portfolio-segment portfolio-ranges" role="group" aria-label="Timeline period">
          {ranges.map(item => <button key={item} type="button" aria-pressed={range===item} onClick={() => setRange(item)}>{item.toUpperCase()}</button>)}
        </div>
        <button type="button" className="portfolio-refresh" aria-label="Refresh portfolio timeline" title="Refresh timeline" disabled={loading} onClick={() => setRefresh(n=>n+1)}><RefreshCw size={15} /></button>
      </div>
    </header>
    <div className="portfolio-segment portfolio-views" role="group" aria-label="Timeline view">
      {views.map(([id,label]) => <button key={id} type="button" aria-pressed={view===id} onClick={() => setView(id)}>{label}</button>)}
    </div>
    {loading ? <div className="portfolio-chart-state" role="status">Loading...</div> : error ? <div className="portfolio-chart-state" role="alert">{error}</div> : !rows.length ? <div className="portfolio-chart-state">No history in this range.</div> : withBenchmark ? <BenchmarkComparison benchmark={report.sp500} /> : view==='gainPct' && rows.every(row=>row.gainPct==null) ? <div className="portfolio-chart-state">Estimated percentage unavailable: recorded spending must be positive and total gain must be known. Older observations may not contain the required data.</div> : <div className="portfolio-chart-canvas">
      <ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{top:12,right:12,left:0,bottom:0}}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border-glass)" />
        <XAxis dataKey="date" tickFormatter={value=>date(value)} minTickGap={32} stroke="var(--text-secondary)" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis width={76} tickFormatter={value=>view==='gainPct' ? percent(value) : new Intl.NumberFormat(locale,{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(value)} stroke="var(--text-secondary)" tickLine={false} axisLine={false} fontSize={11} />
        <Tooltip labelFormatter={value=>date(value,true)} formatter={(value,name)=>[view==='gainPct' ? percent(value) : money(value),name]} contentStyle={{background:'var(--bg-secondary)',borderColor:'var(--border-glass)',borderRadius:8}} />
        <Legend iconType="plainline" iconSize={14} wrapperStyle={{fontSize:12,paddingTop:12}} />
        {view!=='value' && <ReferenceLine y={0} stroke="#94a3b8" />}
        {series.map((key,index)=><Line key={key} type="linear" dataKey={key} name={labels[key]} stroke={['#3b82f6','#10b981','#f59e0b'][index % 3]} strokeWidth={2} dot={rows.length<=180 ? {r:2.5,strokeWidth:0} : false} activeDot={{r:5}} connectNulls={false} isAnimationActive={false} />)}
      </LineChart></ResponsiveContainer>
    </div>}
    <footer className="portfolio-timeline-footer">
      <span>{game ? game.toUpperCase() : 'All games'} · USD{report?.timeZone ? ` · ${report.timeZone}` : ''}{!loading ? ` · ${rows.length} daily point${rows.length===1 ? '' : 's'}` : ''}</span>
      {incomplete && <span className="portfolio-warning" role="status" title="Some observations have stale rates or incomplete prices, purchases, or sales. Missing purchase costs and prices contribute zero; unknown sold costs are not removed.">Incomplete pricing or basis</span>}
      {rows.some(r=>r.accountingVersion===1)&&<span className="portfolio-warning">Legacy observations: market value only; no reconstructed gain.</span>}
      {rows.some(r=>r.accountingVersion===2)&&<span className="portfolio-warning">Older gain points use a different cost-basis calculation.</span>}
      <details className="portfolio-about"><summary>About</summary><p>The timeline shows recorded daily snapshots in the instance portfolio timezone; it does not reconstruct missing days from purchase dates. Changing the timezone starts a separate history without deleting older snapshots. New points estimate unrealized gain as current value minus recorded purchase spending plus known sold acquisition cost. Unknown sold cost is not removed and may already be included in spending, making the estimate inaccurate. Known realized gain excludes sales with unknown gain; total gain remains unavailable until those sales are resolved. Missing purchase costs and prices contribute zero. Archived or otherwise removed purchases remain in spending. Older points retain their original calculation and may not be comparable. Non-USD realized results require a historical FX policy. Estimated loss/gain percentage is total loss/gain divided by recorded purchase spending; it is not a cash-flow-aware return. The S&amp;P comparison shows value change, not investment return. Hover or tap a point for exact amounts.</p></details>
    </footer>
  </section>;
}
