from pathlib import Path
d=Path('frontend/src/components/Dashboard.jsx'); e=Path('frontend/src/locales/en.json')
s,en=d.read_text(),e.read_text()
marker='// streamlined-executive-v1\n'
def once(text,old,new):
    if text.count(old)!=1: raise RuntimeError('Dashboard source changed: '+old[:90])
    return text.replace(old,new,1)
if not s.startswith(marker):
    s=once(s,"  const [timePeriod, setTimePeriod] = useState('30d');\n",'')
    start=s.index("            <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.05)'")
    end=s.index('          </div>\n          <div className="metric-value">',start)
    block=s[start:end]
    if "['7d', '30d', '1y', '5y']" not in block: raise RuntimeError('Net worth controls changed')
    s=s[:start]+s[end:]
    start=s.index("          {(() => {\n            const change = timePeriod")
    end=s.index('          })()}',start)+len('          })()}')
    s=s[:start]+s[end:]
    s=once(s,'className="metrics-grid"','className="metrics-grid executive-summary-grid"') if s.count('className="metrics-grid"')==1 else s.replace('className="metrics-grid"','className="metrics-grid executive-summary-grid"',1)
    placeholder='''        <div className="glass-panel metric-card" aria-label="Realized Loss/Gain pending sales integration">
          <div className="metric-header"><span>{t('dash.realizedLossGain')}</span><span className="metric-icon"><Coins size={18} /></span></div>
          <div className="metric-value" style={{ color: 'var(--text-muted)' }} aria-label="Not available">—</div>
          <div className="metric-footer">{t('dash.realizedPending')}</div>
        </div>

'''
    s=once(s,'        {/* Total Cards count */}',placeholder+'        {/* Total Cards count */}')
    en=once(en,'"dash.unrealizedGain": "Unrealized Gain",','"dash.unrealizedGain": "Unrealized Loss/Gain",\n  "dash.realizedLossGain": "Realized Loss/Gain",\n  "dash.realizedPending": "Sales workflow pending",')
    s=marker+s
assert 'timePeriod' not in s and 'setTimePeriod' not in s
assert 'dash.realizedPending' in s and 'executive-summary-grid' in s
for name in ('PerformanceChart.jsx','BenchmarkComparison.jsx','PerformanceChart.css'):
    source=Path('scripts/streamlined-dashboard')/name
    (Path('frontend/src/components')/name).write_text(source.read_text())
d.write_text(s); e.write_text(en)
