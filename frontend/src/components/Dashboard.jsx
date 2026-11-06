import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area } from 'recharts';
import { TrendingUp, Coins, Library, Trophy, Plus, ArrowUpRight, Package, Zap } from 'lucide-react';
import { getCardDisplayName } from '../utils/langHelper';
import { priceText, currencySymbol } from '../utils/formatPrice';
import { getPrintingBadgeLabel, getPrintingBadgeStyle } from '../utils/cardPrinting';
import { defaultGameFilter, gameOptions, showGamePicker, gameLabel } from '../utils/games';
import { useT } from '../utils/i18n';
import CardInspectorModal from './CardInspectorModal';
import CardImage from './CardImage';
import OpenedPerformance from './OpenedPerformance';

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', 
  '#ec4899', '#14b8a6', '#f43f5e', '#a855f7', '#6366f1'
];

const TYPE_COLORS = {
  'Grass': '#4ade80',
  'Fire': '#f87171',
  'Water': '#60a5fa',
  'Lightning': '#facc15',
  'Psychic': '#c084fc',
  'Fighting': '#f97316',
  'Darkness': '#475569',
  'Metal': '#94a3b8',
  'Dragon': '#a855f7',
  'Fairy': '#f472b6',
  'Colorless': '#cbd5e1',
  'White': '#fef08a',
  'Blue': '#3b82f6',
  'Black': '#334155',
  'Red': '#ef4444',
  'Green': '#10b981',
  'Land': '#d97706',
  'Amber': '#f59e0b',
  'Amethyst': '#a855f7',
  'Emerald': '#10b981',
  'Ruby': '#ef4444',
  'Sapphire': '#3b82f6',
  'Steel': '#94a3b8'
};

function Dashboard({ statsTrigger, onNavigate, setSelectedLocationId, setFocusEntryId, onUpdate, showToast }) {
  const { t, locale } = useT();
  // Money and dates follow the interface language, not the browser's: a user who
  // picked German sees 1.234,56 and 3.8.2026 even on an en-US browser.
  const money = (n) => (n || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timePeriod, setTimePeriod] = useState('30d');
  const [view, setView] = useState('executive');
  // '' | 'pokemon' | 'mtg'. Collapses to the only visible game when the other is
  // hidden in Settings, so the totals never include cards the user cannot see.
  const [gameFilter, setGameFilter] = useState(() => defaultGameFilter());
  
  // Timeline Chart State
  const [historyData, setHistoryData] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Clickable Card Inspector State
  const [inspectorCard, setInspectorCard] = useState(null);

  useEffect(() => {
    fetchStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsTrigger, gameFilter]);

  useEffect(() => {
    if (stats && stats.summary.totalCards > 0) {
      fetchTimelineHistory();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timePeriod, stats, gameFilter]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/stats${gameFilter ? `?game=${gameFilter}` : ''}`);
      if (!response.ok) {
        throw new Error(t('dash.errStats'));
      }
      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchTimelineHistory = async () => {
    try {
      setLoadingHistory(true);
      const response = await fetch(`/api/stats/history?period=${timePeriod}${gameFilter ? `&game=${gameFilter}` : ''}`);
      if (response.ok) {
        const data = await response.json();
        setHistoryData(data);
      }
    } catch (err) {
      console.error('Error loading history timeline:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const renderGameTabs = () => {
    // One game shown: "All" and that game are the same list, so there is nothing
    // to switch between.
    if (!showGamePicker()) return null;
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <div className="sub-nav-tabs" style={{ margin: 0 }}>
          {[['', t('dash.allGames')], ...gameOptions().map(g => [g.value, g.short])].map(([val, label]) => (
            <button
              key={val || 'all'}
              type="button"
              className={`sub-nav-tab ${gameFilter === val ? 'active' : ''}`}
              style={{ padding: '0.35rem 0.85rem', fontSize: '0.75rem' }}
              onClick={() => setGameFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="spinner"></div>;
  }

  if (error) {
    return (
      <div className="glass-panel" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
        <p>{t('dash.errLoad', { error })}</p>
        <button className="btn btn-primary" onClick={fetchStats} style={{ marginTop: '1rem' }}>{t('dash.retry')}</button>
      </div>
    );
  }

  const sealedUnits = stats && stats.summary.sealed ? stats.summary.sealed.remainingUnits : 0;
  const openedReports = stats && stats.openingPerformance ? stats.openingPerformance.reports : [];
  if (!stats || (stats.summary.totalCards === 0 && sealedUnits === 0 && (!openedReports || openedReports.length === 0))) {
    const isFiltered = Boolean(gameFilter);
    const gameName = isFiltered ? gameLabel(gameFilter, true) : '';
    return (
      <div>
        {renderGameTabs()}
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-secondary)' }}>
          <TrendingUp size={48} style={{ color: 'var(--accent-red)', marginBottom: '1.5rem', opacity: 0.8 }} />
          <h2 style={{ color: 'var(--text-strong)', marginBottom: '0.5rem' }}>
            {isFiltered ? t('dash.emptyFilteredTitle', { game: gameName }) : t('dash.emptyTitle')}
          </h2>
          <p style={{ maxWidth: '400px', margin: '0 auto 1.5rem auto' }}>
            {isFiltered ? t('dash.emptyFilteredBody', { game: gameName }) : t('dash.emptyBody')}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
            <div style={{ display: 'inline-block' }}>
              <button className="btn btn-primary" onClick={() => onNavigate && onNavigate('add-cards')}>{t('dash.goToAddCards')}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { summary, types, rarities, sets, cardSets = [], topValuable, topSealed = [], recentAdditions = [], setProgress, locations = [] } = stats;

  // Match type name to its color case-insensitively; fall back to a distinct
  // palette color by index so slices are never all the same gray.
  const typeColorLookup = Object.fromEntries(
    Object.entries(TYPE_COLORS).map(([k, v]) => [k.toLowerCase(), v])
  );
  const typeChartData = types.map((t, i) => {
    const fill = typeColorLookup[String(t.name).toLowerCase()] || COLORS[i % COLORS.length];
    return { name: t.name, value: t.value, color: fill, fill };
  });
  const rarityChartData = rarities.map((r, i) => ({ ...r, fill: COLORS[i % COLORS.length] }));

  return (
    <div>
      {renderGameTabs()}

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
        <div className="sub-nav-tabs" style={{ width: '100%', maxWidth: '720px', margin: 0 }}>
          {[
            ['executive', TrendingUp, t('dash.tabExecutive')],
            ['sealed', Package, t('dash.tabSealed')],
            ['rips', Zap, t('dash.tabRips')],
            ['cards', Library, t('dash.tabCards')],
          ].map(([id, Icon, label]) => (
            <button key={id} type="button" className={`sub-nav-tab ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {view === 'executive' && (<>
      {/* Metrics Summary Grid */}
      <div className="metrics-grid">
        {/* Net Worth Card with historical switcher */}
        <div className="glass-panel metric-card accent-networth">
          <div className="metric-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="metric-icon" style={{ width: '28px', height: '28px' }}><TrendingUp size={16} /></span>
              {t('dash.netWorth')}
            </span>
            <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '2px', borderRadius: '4px' }}>
              {['7d', '30d', '1y', '5y'].map(p => (
                <button 
                  key={p} 
                  type="button" 
                  onClick={() => setTimePeriod(p)}
                  style={{
                    padding: '2px 6px',
                    fontSize: '0.65rem',
                    border: 'none',
                    borderRadius: '3px',
                    background: timePeriod === p ? 'var(--type-grass)' : 'transparent',
                    color: 'var(--text-strong)',
                    cursor: 'pointer',
                    fontWeight: 700,
                    transition: 'all 0.15s ease'
                  }}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="metric-value">{currencySymbol()}{money(summary.totalValue)}</div>
          {summary.sealed && summary.sealed.remainingUnits > 0 && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
              {(summary.sealed.marketValue > 0 || summary.sealed.valuationComplete) && (
                <div>{t('dash.sealedIncluded', { value: `${currencySymbol()}${money(summary.sealed.marketValue)}` })}</div>
              )}
              {summary.sealed.unpricedUnits > 0 && (
                <div>{t('dash.sealedUnpriced', { count: summary.sealed.unpricedUnits })}</div>
              )}
            </div>
          )}
          {(() => {
            const change = timePeriod === '7d' ? summary.change7d :
                           timePeriod === '30d' ? summary.change30d :
                           timePeriod === '1y' ? summary.change1y : summary.change5y;
            // change7d/30d use Cardmarket's real avg7/avg30 (only real source
            // available); change1y/5y have no real historical price source
            // anywhere, so they're marked unavailable rather than faked.
            if (!change || !change.available) {
              return (
                <div className="metric-footer" style={{ color: 'var(--text-muted)' }}>
                  <span>{t('dash.noPriceHistory')}</span>
                </div>
              );
            }
            const isPositive = change.abs >= 0;
            return (
              <div className={`metric-footer ${isPositive ? 'positive' : 'negative'}`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <TrendingUp size={12} style={{ transform: isPositive ? 'none' : 'rotate(180deg)' }} />
                <span>
                  {isPositive ? '+' : ''}{currencySymbol()}{money(change.abs)} ({isPositive ? '+' : ''}{change.pct}%)
                </span>
              </div>
            );
          })()}
        </div>

        {/* Total Invested (cost basis) */}
        <div className="glass-panel metric-card accent-invested">
          <div className="metric-header">
            <span>{t('dash.totalInvested')}</span>
            <span className="metric-icon"><Coins size={18} /></span>
          </div>
          <div className="metric-value">{currencySymbol()}{money(summary.totalSpent)}</div>
          <div className="metric-footer">
            {summary.totalCards > 0 && (
              <span>{t('dash.avgPerCard', { price: priceText(summary.avgCardValue) })}</span>
            )}
          </div>
        </div>

        {/* Unrealized Gain / ROI */}
        {(() => {
          const roi = summary.roi || { abs: 0, pct: null };
          const isPositive = (roi.abs || 0) >= 0;
          return (
            <div className={`glass-panel metric-card ${isPositive ? 'accent-gain-up' : 'accent-gain-down'}`}>
              <div className="metric-header">
                <span>{t('dash.unrealizedGain')}</span>
                <span className="metric-icon"><ArrowUpRight size={18} style={{ transform: isPositive ? 'none' : 'rotate(90deg)' }} /></span>
              </div>
              <div className="metric-value" style={{ color: isPositive ? '#22c55e' : '#ef4444' }}>
                {isPositive ? '+' : '−'}{currencySymbol()}{money(Math.abs(roi.abs || 0))}
              </div>
              <div className="metric-footer">
                <span>{roi.pct === null ? t('dash.roiUnset') : t('dash.roiVsCost', { pct: `${isPositive ? '+' : ''}${roi.pct}` })}</span>
              </div>
            </div>
          );
        })()}

        {/* Total Cards count */}
        <div className="glass-panel metric-card accent-cards">
          <div className="metric-header">
            <span>{t('dash.totalCards')}</span>
            <span className="metric-icon"><Library size={18} /></span>
          </div>
          <div className="metric-value">{summary.totalCards}</div>
          <div className="metric-footer">
            <span>{t('dash.uniqueCount', { count: summary.uniqueCards })}{summary.unsortedCount > 0 ? ` • ${t('dash.unsortedCount', { count: summary.unsortedCount })}` : ''}</span>
          </div>
        </div>
      </div>

      {/* Net Worth History Timeline Chart */}
      <div className="glass-panel" style={{ marginBottom: '1.5rem', padding: '1.5rem 1.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 className="chart-title" style={{ margin: 0 }}>{t('dash.timelineTitle')}</h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {t('dash.timelineRange', { range: timePeriod.toUpperCase() })}
          </span>
        </div>
        <div className="chart-container" style={{ height: '240px', position: 'relative' }}>
          {loadingHistory ? (
            <div className="spinner" style={{ position: 'absolute', top: '45%', left: '45%' }}></div>
          ) : historyData.length < 2 ? (
            <div className="chart-empty">{t('dash.notEnoughHistory')}</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={historyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--type-grass)" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="var(--type-grass)" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke="var(--text-secondary)" style={{ fontSize: '0.7rem' }} />
                <YAxis stroke="var(--text-secondary)" style={{ fontSize: '0.7rem' }} tickFormatter={(v) => `${currencySymbol()}${v}`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-glass)' }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                  formatter={(v) => [`${currencySymbol()}${v}`, t('dash.portfolioValue')]}
                />
                <Area type="monotone" dataKey="value" stroke="var(--type-grass)" strokeWidth={2} fillOpacity={1} fill="url(#colorVal)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="dashboard-details">
        <div className="glass-panel">
          <h3 className="chart-title">{t('dash.mixTitle')}</h3>
          <div className="chart-container" style={{ height: '220px' }}>
            {summary.totalValue <= 0 ? (
              <div className="chart-empty">{t('dash.mixEmpty')}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: t('dash.mixCards'), value: Math.max(0, parseFloat((summary.totalValue - (summary.sealed ? summary.sealed.marketValue : 0)).toFixed(2))) },
                      { name: t('dash.mixSealed'), value: summary.sealed ? summary.sealed.marketValue : 0 },
                    ].filter(row => row.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {[
                      { name: t('dash.mixCards'), value: Math.max(0, parseFloat((summary.totalValue - (summary.sealed ? summary.sealed.marketValue : 0)).toFixed(2))) },
                      { name: t('dash.mixSealed'), value: summary.sealed ? summary.sealed.marketValue : 0 },
                    ].filter(row => row.value > 0).map(row => (
                      <Cell key={row.name} fill={row.name === t('dash.mixSealed') ? 'var(--accent-yellow)' : 'var(--accent-blue)'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-glass)' }}
                    formatter={(v) => [`${currencySymbol()}${money(v)}`, t('dash.value')]}
                  />
                  <Legend verticalAlign="bottom" height={36} iconSize={10} formatter={(value) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="glass-panel">
          <h3 className="chart-title">{t('dash.valueBySet')}</h3>
          <p style={{ margin: '-0.35rem 0 0.75rem', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{t('dash.valueBySetHint')}</p>
          <div className="chart-container">
            {sets.length === 0 ? <div className="chart-empty">{t('dash.noSetData')}</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sets} layout="vertical" margin={{ left: 10, right: 30, top: 10, bottom: 10 }}>
                  <XAxis type="number" stroke="var(--text-secondary)" tickFormatter={(v) => `${currencySymbol()}${v}`} />
                  <YAxis dataKey="name" type="category" width={120} stroke="var(--text-secondary)" tickLine={false} axisLine={false} style={{ fontSize: '0.8rem' }} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-glass)' }} formatter={(v) => [`${currencySymbol()}${v}`, t('dash.value')]} />
                  <Bar dataKey="value" fill="var(--accent-red)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
      </>)}

      {view === 'sealed' && (
        summary.sealed && summary.sealed.remainingUnits > 0 ? (
          <>
            <div className="metrics-grid">
              <div className="glass-panel metric-card accent-cards">
                <div className="metric-header"><span>{t('dash.sealedTitle')}</span><span className="metric-icon"><Package size={18} /></span></div>
                <div className="metric-value">{summary.sealed.remainingUnits}</div>
                <div className="metric-footer">{t('dash.sealedOnHand', { count: summary.sealed.remainingUnits })}</div>
              </div>
              <div className="glass-panel metric-card accent-networth">
                <div className="metric-header"><span>{t('dash.marketValue')}</span></div>
                <div className="metric-value">{currencySymbol()}{money(summary.sealed.marketValue)}</div>
                <div className="metric-footer">{summary.sealed.unpricedUnits > 0 ? t('dash.sealedUnpriced', { count: summary.sealed.unpricedUnits }) : t('dash.valuationComplete')}</div>
              </div>
              <div className="glass-panel metric-card accent-invested">
                <div className="metric-header"><span>{t('dash.sealedCost')}</span></div>
                <div className="metric-value">{currencySymbol()}{money(summary.sealed.cost)}</div>
              </div>
              <div className={`glass-panel metric-card ${(summary.sealed.marketValue - summary.sealed.cost) >= 0 ? 'accent-gain-up' : 'accent-gain-down'}`}>
                <div className="metric-header"><span>{t('dash.sealedGain')}</span></div>
                <div className="metric-value" style={{ color: (summary.sealed.marketValue - summary.sealed.cost) >= 0 ? '#22c55e' : '#ef4444' }}>
                  {(summary.sealed.marketValue - summary.sealed.cost) >= 0 ? '+' : '−'}{currencySymbol()}{money(Math.abs(summary.sealed.marketValue - summary.sealed.cost))}
                </div>
              </div>
            </div>
            <div className="dashboard-details">
              <div className="glass-panel">
                <h3 className="chart-title">{t('dash.sealedBySet')}</h3>
                <div className="chart-container" style={{ height: Math.max(160, (stats.sealedBreakdown?.sets || []).length * 42) }}>
                  {(stats.sealedBreakdown?.sets || []).length === 0 ? <div className="chart-empty">{t('dash.noSetData')}</div> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.sealedBreakdown.sets.map(row => ({ ...row, name: row.name || t('dash.openedUnspecified') }))} layout="vertical" margin={{ left: 10, right: 24, top: 8, bottom: 8 }}>
                        <XAxis type="number" stroke="var(--text-secondary)" tickFormatter={(v) => `${currencySymbol()}${v}`} />
                        <YAxis dataKey="name" type="category" width={120} stroke="var(--text-secondary)" tickLine={false} axisLine={false} style={{ fontSize: '0.8rem' }} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-glass)' }} formatter={(v) => [`${currencySymbol()}${money(v)}`, t('dash.value')]} />
                        <Bar dataKey="value" fill="var(--accent-yellow)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              <div className="glass-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                  <h3 className="chart-title" style={{ margin: 0 }}>{t('dash.topSealed')}</h3>
                  <button className="btn btn-secondary" type="button" onClick={() => onNavigate && onNavigate('sealed')}>{t('dash.openSealed')}</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginTop: '1rem' }}>
                  {(stats.sealedBreakdown?.types || []).map(row => (
                    <div key={row.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      <span style={{ color: 'var(--text-strong)', fontWeight: 650 }}>{t(`sealed.type.${row.name}`) === `sealed.type.${row.name}` ? row.name : t(`sealed.type.${row.name}`)}</span>
                      <span>{t('dash.sealedUnits', { count: row.units })} · {currencySymbol()}{money(row.value)}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.25rem' }}>
                  {topSealed.map(product => (
                    <div key={product.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
                      {product.image_url ? (
                        <img src={product.image_url} alt="" style={{ width: '56px', height: '56px', objectFit: 'contain', borderRadius: '5px' }} />
                      ) : (
                        <div style={{ width: '56px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Package size={22} /></div>
                      )}
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{product.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{product.set_name}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 800, color: 'var(--accent-yellow)', fontSize: '0.95rem' }}>{product.market_currency} {product.market_price}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('dash.sealedLine', { count: product.remaining, value: `${product.market_currency} ${product.line_value.toFixed(2)}` })}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <Package size={36} style={{ color: 'var(--accent-yellow)', marginBottom: '0.75rem' }} />
            <p>{t('dash.sealedEmpty')}</p>
            <button className="btn btn-secondary" type="button" onClick={() => onNavigate && onNavigate('sealed')}>{t('dash.openSealed')}</button>
          </div>
        )
      )}

      {view === 'rips' && (
        openedReports.length > 0
          ? <OpenedPerformance performance={stats.openingPerformance} t={t} money={money} />
          : <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}><Zap size={36} style={{ color: 'var(--accent-yellow)', marginBottom: '0.75rem' }} /><p>{t('dash.ripEmpty')}</p></div>
      )}

      {view === 'cards' && (<>
      <div className="glass-panel" style={{ marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))', gap: '0.8rem' }}>
        <div><div className="metric-header">{t('dash.uniqueCount', { count: summary.uniqueCards })}</div><div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{summary.totalCards > 0 ? t('dash.nearMint', { pct: summary.mintRate }) : '—'}</div></div>
        <div><div className="metric-header">{t('dash.vintageShare', { pct: summary.vintageRatio })}</div></div>
        <div><div className="metric-header">{t('dash.duplicates', { count: summary.duplicateCopies })}</div></div>
        <div><div className="metric-header">{summary.unsortedCount > 0 ? t('dash.unsortedCount', { count: summary.unsortedCount }) : t('dash.whereCards')}</div></div>
      </div>
      {/* Main Charts & Analytics Details */}
      <div className="dashboard-details">
        {/* Left Column: Charts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {setProgress.length > 0 && (
            <div className="glass-panel">
              <h3 className="chart-title">{t('dash.setProgress')}</h3>
              <div className="set-progress-grid" style={{ marginTop: '1rem' }}>
                {setProgress.map((set, idx) => (
                  <div key={idx} className="set-progress-item">
                    <div className="set-progress-header">
                      <span style={{ color: 'var(--text-strong)' }}>{set.setName}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{set.ownedUnique} / {set.totalCards} ({set.percent}%)</span>
                    </div>
                    <div className="set-progress-bar-bg">
                      <div className="set-progress-bar-fill" style={{ width: `${set.percent}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Card Value by Set Chart */}
          <div className="glass-panel">
            <h3 className="chart-title">{t('dash.cardValueBySet')}</h3>
            <p style={{ margin: '-0.35rem 0 0.75rem', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{t('dash.cardValueHint')}</p>
            <div className="chart-container">
              {cardSets.length === 0 ? (
                <div className="chart-empty">{t('dash.noSetData')}</div>
              ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cardSets} layout="vertical" margin={{ left: 10, right: 30, top: 10, bottom: 10 }}>
                  <XAxis type="number" stroke="var(--text-secondary)" tickFormatter={(v) => `${currencySymbol()}${v}`} />
                  <YAxis dataKey="name" type="category" width={120} stroke="var(--text-secondary)" tickLine={false} axisLine={false} style={{ fontSize: '0.8rem' }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-glass)' }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                    formatter={(v) => [`${currencySymbol()}${v}`, t('dash.value')]}
                  />
                  <Bar dataKey="value" fill="var(--accent-red)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* minmax(0, …) for the same reason as .dashboard-details. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '1.5rem' }}>
            {/* Type Distribution Donut Chart */}
            <div className="glass-panel">
              <h3 className="chart-title">{t(gameFilter === 'mtg' ? 'dash.colorDistribution' : 'dash.typeDistribution')}</h3>
              <div className="chart-container" style={{ height: '220px' }}>
                {typeChartData.length === 0 ? (
                  <div className="chart-empty">{t('dash.noTypeData')}</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={typeChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {typeChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-glass)' }}
                      itemStyle={{ color: 'var(--text-strong)' }}
                      labelStyle={{ color: 'var(--text-strong)' }}
                      formatter={(v) => [v, t('dash.cards')]}
                    />
                    <Legend 
                      verticalAlign="bottom" 
                      height={36} 
                      iconSize={10} 
                      style={{ fontSize: '0.75rem' }} 
                      formatter={(value) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Rarity Distribution Chart */}
            <div className="glass-panel">
              <h3 className="chart-title">{t('dash.rarityDistribution')}</h3>
              <div className="chart-container" style={{ height: '220px' }}>
                {rarityChartData.length === 0 ? (
                  <div className="chart-empty">{t('dash.noRarityData')}</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={rarityChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={78}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {rarityChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-glass)' }}
                      itemStyle={{ color: 'var(--text-strong)' }}
                      labelStyle={{ color: 'var(--text-strong)' }}
                      formatter={(v) => [v, t('dash.cards')]}
                    />
                    <Legend 
                      verticalAlign="bottom" 
                      height={36} 
                      iconSize={10} 
                      style={{ fontSize: '0.75rem' }} 
                      formatter={(value) => <span style={{ color: 'var(--text-secondary)', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Mini Tables & Lists */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Top Valuable Cards */}
          <div className="glass-panel" style={{ flex: 1 }}>
            <h3 className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Trophy size={18} style={{ color: 'var(--accent-yellow)' }} />
              {t('dash.topValuable')}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
              {topValuable.map((card, idx) => (
                <div 
                  key={idx} 
                  onClick={() => setInspectorCard(card)}
                  style={{ 
                    display: 'flex', 
                    gap: '0.75rem', 
                    alignItems: 'center', 
                    background: 'rgba(255, 255, 255, 0.02)', 
                    padding: '0.5rem', 
                    borderRadius: 'var(--radius-sm)', 
                    border: '1px solid var(--border-glass)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  className="dashboard-card-clickable"
                >
                  <CardImage card={card} style={{ width: '56px', aspectRatio: 0.718, objectFit: 'cover', borderRadius: '5px', boxShadow: '0 2px 6px rgba(0,0,0,0.4)' }} />
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {getCardDisplayName(card.name, card.language, card.printed_name)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span>{card.set_name} • {card.rarity}</span>
                      {card.printing && card.printing !== 'Normal' && (
                        <span style={{ fontSize: '0.55rem', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', flexShrink: 0, ...getPrintingBadgeStyle(card.printing) }}>
                          {getPrintingBadgeLabel(card.printing)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, color: 'var(--accent-yellow)', fontSize: '0.95rem' }}>{priceText(card.price_trend)}<span style={{ fontSize: '0.6rem', fontWeight: 500, color: 'var(--text-muted)' }}> {t('dash.each')}</span></div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {card.quantity > 1 ? t('dash.qtyTotal', { qty: card.quantity, price: priceText(card.price_trend * card.quantity) }) : t('dash.qty', { qty: 1 })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Additions */}
          {recentAdditions.length > 0 && (
            <div className="glass-panel" style={{ flex: 1 }}>
              <h3 className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Plus size={18} style={{ color: 'var(--accent-blue)' }} />
                {t('dash.recentAdditions')}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '1.25rem' }}>
                {recentAdditions.map((card, idx) => (
                  <div
                    key={idx}
                    onClick={() => setInspectorCard(card)}
                    style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)', cursor: 'pointer', transition: 'all 0.2s ease' }}
                    className="dashboard-card-clickable"
                  >
                    <CardImage card={card} style={{ width: '48px', aspectRatio: 0.718, objectFit: 'cover', borderRadius: '5px', boxShadow: '0 2px 6px rgba(0,0,0,0.4)' }} />
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {getCardDisplayName(card.name, card.language, card.printed_name)}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span>{card.set_name} • #{card.number}</span>
                        {card.printing && card.printing !== 'Normal' && (
                          <span style={{ fontSize: '0.55rem', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', flexShrink: 0, ...getPrintingBadgeStyle(card.printing) }}>
                            {getPrintingBadgeLabel(card.printing)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: 'var(--accent-yellow)', fontSize: '0.8rem' }}>{priceText(card.price_trend)}<span style={{ fontSize: '0.55rem', fontWeight: 500, color: 'var(--text-muted)' }}> {t('dash.each')}</span></div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{card.quantity > 1 ? t('dash.qty', { qty: card.quantity }) : (card.added_at ? new Date(card.added_at).toLocaleDateString(locale) : '')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {locations.length > 0 && (
            <div className="glass-panel">
              <h3 className="chart-title">{t('dash.whereCards')}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.8rem' }}>
                {locations.map(row => (
                  <div key={row.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-strong)' }}>{row.name}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
      </>)}

      {/* Card Inspector Modal Overlay */}
      <CardInspectorModal
        card={inspectorCard}
        onClose={() => setInspectorCard(null)}
        onUpdate={onUpdate}
        showToast={showToast}
        onViewStorage={(card) => {
          if (setSelectedLocationId) setSelectedLocationId(card.location_id || 'unsorted');
          if (setFocusEntryId) setFocusEntryId(card.entry_id || card.id);
          onNavigate('storage');
          setInspectorCard(null);
        }}
      />
    </div>
  );
}

export default Dashboard;
