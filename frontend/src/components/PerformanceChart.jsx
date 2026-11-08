import { useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useT } from '../utils/i18n';
const ranges = ['7d', '30d', '90d', 'ytd', '1y', '5y', 'all'];
export default function PerformanceChart({ statsTrigger }) {
  const { locale } = useT();
  const [range, setRange] = useState('30d');
  const [game, setGame] = useState('');
  const [view, setView] = useState('value');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setReport(null); setLoading(true); setError('');
    const params = new URLSearchParams({ range, game, currency: 'USD' });
    fetch(`/api/stats/performance?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load daily performance');
        if (data.currency !== 'USD' || !Array.isArray(data.portfolio)) throw new Error('Unexpected performance response');
        return data;
      })
      .then(data => { if (current) setReport(data); })
      .catch(err => { if (current && err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [range, game, statsTrigger, refresh]);
  const money = value => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);
  const percent = value => `${Number(value).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const day = value => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T00:00:00Z`));
  const rows = report?.portfolio || [], latest = rows[rows.length - 1];
  const labels = { value: 'Combined market value', invested: 'Recorded cost', gain: 'Gain / loss vs. recorded cost', gainPct: 'Gain / loss vs. recorded cost (%)' };
  const series = view === 'value' ? ['value', 'invested'] : [view];
  return (
    <section className="glass-panel" aria-label="Daily portfolio performance" style={{ padding: '1.25rem', marginBottom: '1.5rem', minWidth: 0 }}>
      <h3 className="chart-title">Daily portfolio performance</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Saved cards + sealed snapshots in USD. Gain is compared with each day's recorded cost, not a cash-flow-adjusted investment return. These controls apply only to this panel.</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <label>Game <select value={game} onChange={event => setGame(event.target.value)}><option value="">All games</option><option value="pokemon">Pokemon</option><option value="mtg">Magic: The Gathering</option><option value="lorcana">Lorcana</option></select></label>
        <label>View <select value={view} onChange={event => setView(event.target.value)}><option value="value">Market value / recorded cost</option><option value="gain">Gain / loss (USD)</option><option value="gainPct">Gain / loss (%)</option></select></label>
        <button type="button" className="btn btn-secondary" onClick={() => setRefresh(n => n + 1)}>Refresh snapshots</button>
      </div>
      <div role="group" aria-label="Daily performance range" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {ranges.map(item => <button key={item} type="button" aria-pressed={range === item} className={`btn ${range === item ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setRange(item)}>{item.toUpperCase()}</button>)}
      </div>
      {loading ? <p role="status">Loading daily snapshots...</p> : error ? <p role="alert">{error}</p> : !rows.length ? <p>No saved snapshots for this game and range. Earlier values are not reconstructed.</p> : <>
        <p>Latest: {day(latest.date)} - value {money(latest.value)}, cost {money(latest.invested)}, gain {money(latest.gain)} ({latest.gainPct == null ? 'percentage unavailable: zero recorded cost' : percent(latest.gainPct)}).</p>
        {rows.length === 1 && <p style={{ color: 'var(--text-secondary)' }}>One daily snapshot is available. The dot is your actual record; a history line will develop as more days are saved.</p>}
        {view === 'gainPct' && rows.every(row => row.gainPct == null) ? <p>Gain percentage is unavailable because these snapshots have no recorded cost.</p> : <div style={{ width: '100%', height: 280, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 12, right: 20, left: 12, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-glass)" />
            <XAxis dataKey="date" tickFormatter={day} minTickGap={32} stroke="var(--text-secondary)" />
            <YAxis width={85} tickFormatter={value => view === 'gainPct' ? percent(value) : money(value)} stroke="var(--text-secondary)" />
            <Tooltip labelFormatter={day} formatter={(value, name) => [view === 'gainPct' ? percent(value) : money(value), name]} contentStyle={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-glass)' }} />
            <Legend />
            {view !== 'value' && <ReferenceLine y={0} stroke="#94a3b8" />}
            {series.map((key, index) => <Line key={key} type="linear" dataKey={key} name={labels[key]} stroke={index ? '#f59e0b' : '#3b82f6'} strokeWidth={2} dot={{ r: rows.length === 1 ? 6 : 3 }} activeDot={{ r: 7 }} connectNulls={false} isAnimationActive={false} />)}
          </LineChart></ResponsiveContainer>
        </div>}
        <small style={{ color: 'var(--text-secondary)' }}>Snapshot timezone: {report.timeZone}. {rows.length} recorded day(s). Missing days are not backfilled; lines join available observations. Refresh reads saved snapshots, not a new valuation.</small>
        {rows.some(row => row.staleRates || row.unpricedCards > 0 || row.unpricedSealed > 0) && <p role="status">Some snapshots contain stale exchange rates or unpriced holdings; their values may be incomplete.</p>}
      </>}
    </section>
  );
}
