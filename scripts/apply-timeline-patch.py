from pathlib import Path
import hashlib

def checked(path, expected):
    raw = Path(path).read_bytes()
    digest = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    if digest != expected:
        raise SystemExit(f'{path} changed; refusing to patch unexpected source ({digest})')
    return raw.decode()

def replace_once(text, old, new):
    if text.count(old) != 1:
        raise SystemExit('Patch anchor missing or ambiguous; no source files written')
    return text.replace(old, new, 1)

dashboard_path = 'frontend/src/components/Dashboard.jsx'
stats_path = 'backend/src/routes/stats.js'
dashboard = checked(dashboard_path, 'f755c826541fa066c91ba30bd91c001e19b0fd0e')
stats = checked(stats_path, '320b71f1731fcefab2d70e4069ff985741669652')
start = dashboard.index('  useEffect(() => {\n    if (stats && stats.summary.totalCards > 0)')
end = dashboard.index('  const fetchStats = async () => {', start)
dashboard = dashboard[:start] + '''  useEffect(() => {
    if (!stats) return;
    const controller = new AbortController();
    let current = true;
    setHistoryData([]);
    setLoadingHistory(true);
    fetch(`/api/stats/history?period=${timePeriod}${gameFilter ? `&game=${gameFilter}` : ''}`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Failed to load portfolio history');
        return response.json();
      })
      .then(data => { if (current) setHistoryData(data); })
      .catch(error => { if (current && error.name !== 'AbortError') console.error(error); })
      .finally(() => { if (current) setLoadingHistory(false); });
    return () => { current = false; controller.abort(); };
  }, [timePeriod, stats, gameFilter]);

''' + dashboard[end:]
start = dashboard.index('  const fetchTimelineHistory = async () => {')
end = dashboard.index('  const renderGameTabs = () => {', start)
dashboard = dashboard[:start] + dashboard[end:]
dashboard = replace_once(dashboard, '      {/* Net Worth History Timeline Chart */}', '''      {/* Recorded combined holdings, not a backfilled price-only curve. */}
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
        Recorded cards + sealed portfolio snapshots. History starts when this feature is used; earlier combined values are unavailable.
      </p>''')
start = stats.index("router.get('/stats/history', async (req, res) => {")
end = stats.index('// 7c. Net worth', start)
stats = stats[:start] + '''router.get('/stats/history', require('../utils/portfolioTimeline').createHistoryHandler({
  db, resolveCardPrice, summarizeHoldings,
}));

''' + stats[end:]
Path(dashboard_path).write_text(dashboard)
Path(stats_path).write_text(stats)
