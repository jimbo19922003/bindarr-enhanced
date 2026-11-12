import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';

const SORTS = ['name', 'cost', 'knownValue', 'openedValue', 'sinceOpen', 'difference', 'recoveryPercent'];

function signed(currency, amount, money) {
  const value = Number(amount) || 0;
  const mark = value < 0 ? '−' : '+';
  return `${mark}${currency} ${money(Math.abs(value))}`;
}

function tone(amount) {
  return (Number(amount) || 0) >= 0 ? 'var(--type-grass)' : '#ef4444';
}

function returnPercent(row) {
  if (!row || !(row.cost > 0) || row.difference == null) return null;
  return parseFloat(((row.difference / row.cost) * 100).toFixed(1));
}

function signedPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n < 0 ? '−' : '+'}${Math.abs(n).toFixed(1)}%`;
}

function compareRows(sort) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return (a, b) => {
    if (sort.key === 'name') return a.name.localeCompare(b.name) * dir;
    const left = a[sort.key];
    const right = b[sort.key];
    if (left == null && right == null) return a.name.localeCompare(b.name);
    if (left == null) return 1;
    if (right == null) return -1;
    if (left !== right) return (left - right) * dir;
    return a.name.localeCompare(b.name);
  };
}

function OpenedPerformance({ performance, t, money }) {
  const reports = performance && Array.isArray(performance.reports) ? performance.reports : [];
  const [currency, setCurrency] = useState(reports[0] ? reports[0].currency : '');
  const [group, setGroup] = useState('set');
  const [sort, setSort] = useState({ key: 'recoveryPercent', dir: 'desc' });
  const [measure, setMeasure] = useState('percent');
  if (!reports.length) return null;

  const active = reports.find(report => report.currency === currency) || reports[0];
  const overall = active.overall;
  const rows = (group === 'type' ? active.productTypes : group === 'source' ? active.sources || [] : active.sets).slice().sort(compareRows(sort));
  const labelOf = (row) => {
    if (group === 'source' && row.name === 'booster_pack') return t('dash.openedSourceLoose');
    if (group === 'type' || group === 'source') return t(`sealed.type.${row.name}`) === `sealed.type.${row.name}` ? row.name : t(`sealed.type.${row.name}`);
    return row.name || t('dash.openedUnspecified');
  };
  const score = (row) => (measure === 'percent' ? returnPercent(row) : row.difference);
  const ranked = active.sets.slice().sort((a, b) => {
    const left = score(a);
    const right = score(b);
    if (left == null && right == null) return (a.name || '').localeCompare(b.name || '');
    if (left == null) return 1;
    if (right == null) return -1;
    return right - left || (a.name || '').localeCompare(b.name || '');
  });
  const scored = ranked.filter(row => score(row) != null);
  const best = scored[0];
  const worst = scored.length > 1 ? scored[scored.length - 1] : null;
  const chartRows = scored.slice(0, 8).map(row => ({
    name: row.name || t('dash.openedUnspecified'),
    value: score(row),
  }));
  const formatChart = (value) => (measure === 'percent' ? signedPct(value) : signed(active.currency, value, money));

  const toggle = (key) => {
    setSort(current => current.key === key
      ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' });
  };
  const mark = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '');
  const up = overall.difference >= 0;

  return (
    <section aria-label={t('dash.openedTitle')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.85rem' }}>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem', maxWidth: '40rem' }}>{t('dash.openedHint')}</p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {reports.length > 1 && (
            <div className="sub-nav-tabs" style={{ margin: 0 }}>
              {reports.map(report => (
                <button key={report.currency} type="button" className={`sub-nav-tab ${active.currency === report.currency ? 'active' : ''}`} style={{ padding: '0.35rem 0.85rem', fontSize: '0.75rem' }} onClick={() => setCurrency(report.currency)}>
                  {report.currency}
                </button>
              ))}
            </div>
          )}
          <div className="sub-nav-tabs" style={{ margin: 0 }}>
            <button type="button" className={`sub-nav-tab ${group === 'set' ? 'active' : ''}`} style={{ padding: '0.35rem 0.85rem', fontSize: '0.75rem' }} onClick={() => setGroup('set')}>{t('dash.openedBySet')}</button>
            <button type="button" className={`sub-nav-tab ${group === 'type' ? 'active' : ''}`} style={{ padding: '0.35rem 0.85rem', fontSize: '0.75rem' }} onClick={() => setGroup('type')}>{t('dash.openedByType')}</button>
            <button type="button" className={`sub-nav-tab ${group === 'source' ? 'active' : ''}`} style={{ padding: '0.35rem 0.85rem', fontSize: '0.75rem' }} onClick={() => setGroup('source')} title={t('dash.openedBySourceHint')}>{t('dash.openedBySource')}</button>
          </div>
        </div>
      </div>

      <div className="metrics-grid" style={{ marginBottom: '1rem' }}>
        <div className="glass-panel metric-card accent-invested">
          <div className="metric-header"><span>{t('dash.openedCost')}</span></div>
          <div className="metric-value">{active.currency} {money(overall.cost)}</div>
          <div className="metric-footer">{t('dash.openedUnits', { units: overall.units, openings: overall.openings })}</div>
        </div>
        <div className="glass-panel metric-card accent-networth">
          <div className="metric-header"><span>{t('dash.openedKnown')}</span></div>
          <div className="metric-value">{active.currency} {money(overall.knownValue)}</div>
          <div className="metric-footer">{t('dash.openedPulls', { pulls: overall.recordedPulls, unpriced: overall.unpricedPulls })}</div>
        </div>
        <div className="glass-panel metric-card accent-cards">
          <div className="metric-header"><span>{t('dash.openedAtOpen')}</span></div>
          <div className="metric-value">{overall.openedValue == null ? '—' : `${active.currency} ${money(overall.openedValue)}`}</div>
          <div className="metric-footer" style={{ color: overall.sinceOpen == null ? 'var(--text-muted)' : tone(overall.sinceOpen) }}>
            {overall.sinceOpen == null ? t('dash.openedNoSince') : t('dash.openedSince', { value: signed(active.currency, overall.sinceOpen, money) })}
          </div>
        </div>
        <div className={`glass-panel metric-card ${up ? 'accent-gain-up' : 'accent-gain-down'}`}>
          <div className="metric-header"><span>{t('dash.openedDifference')}</span></div>
          <div className="metric-value" style={{ color: tone(overall.difference) }}>{signed(active.currency, overall.difference, money)}</div>
          <div className="metric-footer">{overall.recoveryPercent == null ? t('dash.roiUnset') : t('dash.openedRecovery', { pct: overall.recoveryPercent })}</div>
        </div>
      </div>

      {best && worst && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <div className="glass-panel" style={{ padding: '0.9rem 1.1rem' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{t('dash.openedBest')}</div>
            <div style={{ color: 'var(--text-strong)', fontWeight: 700, marginTop: '0.25rem' }}>{best.name || t('dash.openedUnspecified')}</div>
            <div style={{ color: tone(score(best)), fontWeight: 800 }}>{formatChart(score(best))}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{measure === 'percent' ? signed(active.currency, best.difference, money) : (best.recoveryPercent == null ? '—' : t('dash.openedRecovery', { pct: best.recoveryPercent }))}</div>
          </div>
          <div className="glass-panel" style={{ padding: '0.9rem 1.1rem' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{t('dash.openedWorst')}</div>
            <div style={{ color: 'var(--text-strong)', fontWeight: 700, marginTop: '0.25rem' }}>{worst.name || t('dash.openedUnspecified')}</div>
            <div style={{ color: tone(score(worst)), fontWeight: 800 }}>{formatChart(score(worst))}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{measure === 'percent' ? signed(active.currency, worst.difference, money) : (worst.recoveryPercent == null ? '—' : t('dash.openedRecovery', { pct: worst.recoveryPercent }))}</div>
          </div>
        </div>
      )}

      {(overall.emptyOpenings > 0 || overall.incompleteEntries > 0 || overall.unpricedPulls > 0) && (
        <p style={{ margin: '0 0 1rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
          {overall.emptyOpenings > 0 && <span>{t('dash.openedEmpty', { count: overall.emptyOpenings })} </span>}
          {overall.incompleteEntries > 0 && <span>{t('dash.openedIncomplete', { count: overall.incompleteEntries })} </span>}
          {overall.unpricedPulls > 0 && <span>{t('dash.openedUnpriced', { count: overall.unpricedPulls })}</span>}
        </p>
      )}

      <div style={{ display: 'grid', gap: '1.5rem' }}>
        <div className="glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <h3 className="chart-title">{t('dash.openedChart')}</h3>
              <p style={{ margin: '-0.35rem 0 0.75rem', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{measure === 'percent' ? t('dash.openedChartHintPct') : t('dash.openedChartHint')}</p>
            </div>
            <div className="sub-nav-tabs" style={{ margin: 0, width: 'auto', flex: '0 0 auto' }}>
              <button type="button" className={`sub-nav-tab ${measure === 'percent' ? 'active' : ''}`} style={{ flex: '0 0 auto', padding: '0.35rem 0.85rem', fontSize: '0.75rem' }} onClick={() => setMeasure('percent')}>{t('dash.openedChartPercent')}</button>
              <button type="button" className={`sub-nav-tab ${measure === 'dollars' ? 'active' : ''}`} style={{ flex: '0 0 auto', padding: '0.35rem 0.85rem', fontSize: '0.75rem' }} onClick={() => setMeasure('dollars')}>{t('dash.openedChartDollars')}</button>
            </div>
          </div>
          <div className="chart-container" style={{ height: Math.max(140, chartRows.length * 42) }}>
            {chartRows.length === 0 ? (
              <div className="chart-empty">{t('dash.openedNoRows')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} layout="vertical" margin={{ left: 10, right: 30, top: 10, bottom: 10 }}>
                  <XAxis type="number" stroke="var(--text-secondary)" tickFormatter={(value) => (measure === 'percent' ? `${value}%` : `${value}`)} />
                  <YAxis dataKey="name" type="category" width={120} stroke="var(--text-secondary)" tickLine={false} axisLine={false} style={{ fontSize: '0.8rem' }} reversed />
                  <ReferenceLine x={0} stroke="var(--text-muted)" />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-glass)' }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                    formatter={(value) => [formatChart(value), t('dash.openedDifference')]}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {chartRows.map(row => (
                      <Cell key={row.name} fill={row.value >= 0 ? 'var(--type-grass)' : 'var(--accent-red)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="glass-panel">
          <h3 className="chart-title">{group === 'type' ? t('dash.openedByType') : group === 'source' ? t('dash.openedBySource') : t('dash.openedBySet')}</h3>
          {group === 'source' && <p style={{ margin: '-0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{t('dash.openedBySourceHint')}</p>}
          {rows.length === 0 ? (
            <div className="chart-empty">{t('dash.openedNoRows')}</div>
          ) : (
            <div className="collection-table-wrapper" style={{ marginTop: '0.75rem' }}>
              <table className="collection-table">
                <thead>
                  <tr>
                    {SORTS.map(key => (
                      <th key={key} className={key === 'openedValue' || key === 'sinceOpen' || key === 'recoveryPercent' ? 'hide-mobile' : undefined} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" onClick={() => toggle(key)} style={{ background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', cursor: 'pointer' }}>
                          {t(`dash.openedCol.${key}`)}{mark(key)}
                        </button>
                      </th>
                    ))}
                    <th className="hide-mobile">{t('dash.openedCol.pulls')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.name || 'unspecified'}>
                      <td>{labelOf(row)}</td>
                      <td>{active.currency} {money(row.cost)}</td>
                      <td>{active.currency} {money(row.knownValue)}</td>
                      <td className="hide-mobile">{row.openedValue == null ? '—' : `${active.currency} ${money(row.openedValue)}`}</td>
                      <td className="hide-mobile" style={{ color: row.sinceOpen == null ? 'var(--text-muted)' : tone(row.sinceOpen) }}>{row.sinceOpen == null ? '—' : signed(active.currency, row.sinceOpen, money)}</td>
                      <td style={{ color: tone(row.difference), fontWeight: 700 }}>{signed(active.currency, row.difference, money)}</td>
                      <td className="hide-mobile">{row.recoveryPercent == null ? '—' : `${row.recoveryPercent}%`}</td>
                      <td className="hide-mobile">{t('dash.openedRowPulls', { pulls: row.recordedPulls, unpriced: row.unpricedPulls })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default OpenedPerformance;
