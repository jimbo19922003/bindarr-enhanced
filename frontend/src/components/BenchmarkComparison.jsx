import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useT } from '../utils/i18n';
export default function BenchmarkComparison({ benchmark }) {
  const {locale} = useT();
  const percent = value => `${Number(value).toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2})}%`;
  if (!benchmark || benchmark.unavailable) return <p role="status">S&amp;P 500 data is currently unavailable. Portfolio value and cost remain available in the other views.</p>;
  const data = benchmark.data || [];
  return <div>
    <p>S&amp;P 500 price index, excluding dividends. Both lines start at 0% on the first shared portfolio date. Holdings-value change includes purchases, sales and removals: it is not a cash-flow-adjusted return or a like-for-like investment performance measure.</p>
    <p style={{color:'var(--text-secondary)',fontSize:'0.8rem'}}>Daily calendar-date comparison, not synchronized intraday quotes. Non-trading dates use the last available close, never a future close. Available index history: {benchmark.firstAvailableDate} to {benchmark.lastCloseDate}.</p>
    {benchmark.stale && <p role="status">The benchmark refresh failed; showing cached index data.</p>}
    {!data.length ? <p>No shared dates with a positive starting portfolio value are available yet.</p> : <>
      <p>Baseline portfolio date: {benchmark.baseDate}; baseline index close: {benchmark.baseIndexAsOf}. Latest comparison uses the index close from {data[data.length-1].benchmarkAsOf}.</p>
      {data.length === 1 && <p>Only one shared portfolio date is available; both baseline dots are 0%. A comparison curve needs more recorded days.</p>}
      <div style={{height:280,width:'100%',minWidth:0}}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{top:12,right:20,left:12,bottom:8}}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-glass)" />
          <XAxis dataKey="date" minTickGap={32} stroke="var(--text-secondary)" />
          <YAxis width={85} tickFormatter={percent} stroke="var(--text-secondary)" />
          <ReferenceLine y={0} stroke="#94a3b8" />
          <Tooltip formatter={(value,name) => [percent(value),name]} labelFormatter={(label,payload) => `${label} (index close: ${payload?.[0]?.payload?.benchmarkAsOf || 'unavailable'})`} contentStyle={{background:'var(--bg-secondary)',borderColor:'var(--border-glass)'}} />
          <Legend />
          <Line type="linear" dataKey="holdingsValuePct" name="Holdings-value change (includes cash flows)" stroke="#3b82f6" strokeWidth={2} dot={{r:4}} connectNulls={false} isAnimationActive={false} />
          <Line type="linear" dataKey="sp500Pct" name="S&P 500 price change (no dividends)" stroke="#f59e0b" strokeWidth={2} dot={{r:4}} connectNulls={false} isAnimationActive={false} />
        </LineChart></ResponsiveContainer>
      </div>
    </>}
    <small>Source: <a href="https://fred.stlouisfed.org/series/SP500" target="_blank" rel="noreferrer">FRED SP500 / S&amp;P Dow Jones Indices</a>. The index is not part of collection value, recorded cost or gains. Provider history limits apply.</small>
  </div>;
}
