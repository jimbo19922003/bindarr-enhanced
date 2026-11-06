import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const SORTS = ['name', 'cost', 'knownValue', 'openedValue', 'sinceOpen', 'difference', 'recoveryPercent'];

function signed(currency, amount, money) {
  const value = Number(amount) || 0;
  const mark = value < 0 ? '−' : '+';
  return `${mark}${currency} ${money(Math.abs(value))}`;
}

function tone(amount) {
  return (Number(amount) || 0) >= 0 ? 'var(--type-grass)' : '#ef4444';
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
  if (!reports.length) return null;

  const active = reports.find(report => report.currency === currency) || reports[0];
  const overall = active.overall;
  const rows = (group === 'type' ? active.productTypes : active.sets).slice().sort(compareRows(sort));
  const labelOf = (row) => {
    if (group === 'type') return t(`sealed.type.${row.name}`) === `sealed.type.${row.name}` ? row.name : t(`sealed.type.${row.name}`);
    return row.name || t('dash.openedUnspecified');
  };
  const ranked = active.sets.slice().sort((a, b) => b.difference - a.difference || (b.recoveryPercent || 0) - (a.recoveryPercent || 0));
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const chartRows = ranked.slice(0, 8).map(row => ({ name: row.name || t('dash.openedUnspecified'), difference: row.difference }));

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
            <div style={{ color: tone(best.difference), fontWeight: 800 }}>{signed(active.currency, best.difference, money)}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{best.recoveryPercent == null ? '—' : t('dash.openedRecovery', { pct: best.recoveryPercent })}</div>
          </div>
          <div className="glass-panel" style={{ padding: '0.9rem 1.1rem' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{t('dash.openedWorst')}</div>
            <div style={{ color: 'var(--text-strong)', fontWeight: 700, marginTop: '0.25rem' }}>{worst.name || t('dash.openedUnspecified')}</div>
            <div style={{ color: tone(worst.difference), fontWeight: 800 }}>{signed(active.currency, worst.difference, money)}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{worst.recoveryPercent == null ? '—' : t('dash.openedRecovery', { pct: worst.recoveryPercent })}</div>
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
          <h3 className="chart-title">{t('dash.openedChart')}</h3>
          <p style={{ margin: '-0.35rem 0 0.75rem', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{t('dash.openedChartHint')}</p>
          <div className="chart-container" style={{ height: Math.max(140, chartRows.length * 42) }}>
            {chartRows.length === 0 ? (
              <div className="chart-empty">{t('dash.openedNoRows')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} layout="vertical" margin={{ left: 10, right: 30, top: 10, bottom: 10 }}>
                  <XAxis type="number" stroke="var(--text-secondary)" tickFormatter={(value) => `${value}`} />
                  <YAxis dataKey="name" type="category" width={120} stroke="var(--text-secondary)" tickLine={false} axisLine={false} style={{ fontSize: '0.8rem' }} reversed />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-glass)' }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                    formatter={(value) => [signed(active.currency, value, money), t('dash.openedDifference')]}
                  />
                  <Bar dataKey="difference" radius={[0, 4, 4, 0]}>
                    {chartRows.map(row => (
                      <Cell key={row.name} fill={row.difference >= 0 ? 'var(--type-grass)' : 'var(--accent-red)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="glass-panel">
          <h3 className="chart-title">{group === 'type' ? t('dash.openedByType') : t('dash.openedBySet')}</h3>
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
