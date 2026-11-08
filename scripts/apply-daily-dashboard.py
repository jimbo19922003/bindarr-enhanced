from pathlib import Path
import hashlib

root = Path(__file__).resolve().parents[1]
updates = {}

def read(path):
    return (root / path).read_text(encoding='utf-8')

def require_blob(path, expected):
    raw = (root / path).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    if actual != expected:
        raise RuntimeError(f'{path} changed since review; refusing to patch it')

def replace_once(text, old, new):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'Expected one source match, got {count}: {old[:100]}')
    return text.replace(old, new, 1)

stats_path = 'backend/src/routes/stats.js'
stats = read(stats_path)
portfolio_path = 'backend/src/utils/currentPortfolio.js'
if 'async function cardRows(' in stats:
    require_blob(stats_path, 'ba38b405c3ca7028340c852fedd6c560a650ef65')
    start = stats.index('async function cardRows(')
    end = stats.index('async function openingPerformanceFor(', start)
    shared = stats[start:end]
    updates[portfolio_path] = "'use strict';\nconst db = require('../db');\nconst { summarizeHoldings, emptyHoldings } = require('./sealedInventory');\nconst round = n => Number(n.toFixed(2));\n\n" + shared + '\nmodule.exports = { currentPortfolio };\n'
    stats = stats[:start] + stats[end:]
    stats = replace_once(stats, "const { createReportingValuation } = require('../utils/reportingValuation');", "const { createReportingValuation } = require('../utils/reportingValuation');\nconst { currentPortfolio } = require('../utils/currentPortfolio');")
    stats = replace_once(stats, "const { summarizeHoldings, emptyHoldings } = require('../utils/sealedInventory');", "const { summarizeHoldings } = require('../utils/sealedInventory');")
    updates[stats_path] = stats
else:
    if "require('../utils/currentPortfolio')" not in stats or not (root / portfolio_path).exists():
        raise RuntimeError('Unexpected portfolio extraction state')

path = 'frontend/src/components/Dashboard.jsx'
text = read(path)
if '// daily-dashboard-v2' not in text:
    require_blob(path, 'eff99984838dd81cda3fe9326f39fbf124d72692')
    text = replace_once(text, "import { priceText, currencySymbol } from '../utils/formatPrice';", "import { priceText, currencySymbol, getCurrency } from '../utils/formatPrice';\nimport { cardAverages, formatDayTick, formatDayTooltip, formatMoneyTick } from '../utils/dashboardTimeline';")
    text = replace_once(text, "  const [view, setView] = useState('executive');", "  const [view, setView] = useState('executive');\n  const [reportingCurrency, setReportingCurrency] = useState(() => getCurrency());\n  useEffect(() => {\n    const changed = () => setReportingCurrency(getCurrency());\n    window.addEventListener('bindarr_currency_change', changed);\n    return () => window.removeEventListener('bindarr_currency_change', changed);\n  }, []);")
    text = replace_once(text, '}, [statsTrigger, gameFilter]);', '}, [statsTrigger, gameFilter, reportingCurrency]);')
    text = replace_once(text, '}, [timePeriod, stats, gameFilter]);', '}, [timePeriod, stats, gameFilter, reportingCurrency]);')
    text = replace_once(text, "`/api/stats/history?period=${timePeriod}${gameFilter ? `&game=${gameFilter}` : ''}`", "`/api/stats/history?period=${timePeriod}&currency=${encodeURIComponent(reportingCurrency)}&timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}${gameFilter ? `&game=${gameFilter}` : ''}`")
    text = replace_once(text, "      const response = await fetch(`/api/stats${gameFilter ? `?game=${gameFilter}` : ''}`);", "      setError(null);\n      const params = new URLSearchParams({ currency: reportingCurrency });\n      if (gameFilter) params.set('game', gameFilter);\n      const response = await fetch(`/api/stats?${params}`);")
    old = "{summary.totalCards > 0 && (\n              <span>{t('dash.avgPerCard', { price: priceText(summary.avgCardValue) })}</span>\n            )}"
    new = "<span title=\"Total recorded card and sealed-product spending divided by currently owned physical card copies; includes unopened sealed purchases.\">Average invested per owned card: {priceText(cardAverages(summary).investedPerCard, summary.currency || reportingCurrency)}</span>"
    text = replace_once(text, old, new)
    old = "<span>{t('dash.uniqueCount', { count: summary.uniqueCards })}{summary.unsortedCount > 0 ? ` • ${t('dash.unsortedCount', { count: summary.unsortedCount })}` : ''}</span>"
    text = replace_once(text, old, old + "\n            <div>Average market value: {priceText(cardAverages(summary).marketPerCard, summary.currency || reportingCurrency)} / card</div>")
    text = replace_once(text, 'Recorded cards + sealed portfolio snapshots. History starts when this feature is used; earlier combined values are unavailable.', 'Daily cards + sealed portfolio snapshots. Each day shows its latest recorded normalized value; today updates as the collection changes. Earlier unconverted history is retained separately, not backfilled.')
    text = replace_once(text, 'historyData.length < 2', 'historyData.length < 1')
    text = replace_once(text, '<XAxis dataKey=\"date\" stroke=\"var(--text-secondary)\" style={{ fontSize: \'0.7rem\' }} />', '<XAxis dataKey=\"date\" stroke=\"var(--text-secondary)\" style={{ fontSize: \'0.7rem\' }} minTickGap={28} interval=\"preserveStartEnd\" tickFormatter={day => formatDayTick(day, locale)} />')
    text = replace_once(text, '<YAxis stroke=\"var(--text-secondary)\" style={{ fontSize: \'0.7rem\' }} tickFormatter={(v) => `${currencySymbol()}${v}`} />', '<YAxis stroke=\"var(--text-secondary)\" style={{ fontSize: \'0.7rem\' }} width={72} tickFormatter={value => formatMoneyTick(value, reportingCurrency, locale)} />')
    text = replace_once(text, "formatter={(v) => [`${currencySymbol()}${v}`, t('dash.portfolioValue')]}", "labelFormatter={day => formatDayTooltip(day, locale)}\n                  formatter={value => [priceText(value, reportingCurrency), t('dash.portfolioValue')]}")
    text = replace_once(text, '<Area type=\"monotone\" dataKey=\"value\" stroke=\"var(--type-grass)\" strokeWidth={2} fillOpacity={1} fill=\"url(#colorVal)\" />', '<Area type=\"linear\" dataKey=\"value\" stroke=\"var(--type-grass)\" strokeWidth={2} dot={{ r: 3 }} fillOpacity={1} fill=\"url(#colorVal)\" />')
    updates[path] = '// daily-dashboard-v2\n' + text

for source, target in [
    ('scripts/dashboard-daily/portfolioTimeline.js', 'backend/src/utils/portfolioTimeline.js'),
    ('scripts/dashboard-daily/portfolioTimeline.test.js', 'backend/test/portfolioTimeline.test.js'),
    ('scripts/dashboard-daily/dashboardTimeline.js', 'frontend/src/utils/dashboardTimeline.js'),
    ('scripts/dashboard-daily/dashboardTimeline.test.js', 'frontend/src/utils/dashboardTimeline.test.js'),
]:
    updates[target] = read(source)

for name, content in updates.items():
    destination = root / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding='utf-8')
