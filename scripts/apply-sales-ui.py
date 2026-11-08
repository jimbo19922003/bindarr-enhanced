from pathlib import Path
marker='// sales-ui-v1\n'
def once(s,old,new):
 if s.count(old)!=1:raise RuntimeError('Sales integration anchor changed: '+old[:90])
 return s.replace(old,new,1)
srv=Path('backend/src/server.js');dash=Path('frontend/src/components/Dashboard.jsx');sealed=Path('backend/src/utils/sealedSalesRepository.js')
s,d,r=srv.read_text(),dash.read_text(),sealed.read_text()
if not r.startswith(marker):r=marker+once(r,'module.exports={createSealedSalesRepository};','module.exports={createSealedSalesRepository,schema};')
if not s.startswith(marker):
 anchor='// --- AUTHENTICATED API ROUTES ---'
 mount="""// --- AUTHENTICATED API ROUTES ---
app.use('/api/sales', (req,res,next) => dbReady ? next() : res.status(503).json({error:'Database initializing'}), require('./routes/sales').createRouter({service:require('./utils/salesApplication').createSalesApplication({connect:() => require('./utils/salesRepository').openConnection(db.dbPath)})}));"""
 s=marker+once(s,anchor,mount)
if not d.startswith(marker):
 d=once(d,"import PerformanceChart from './PerformanceChart';","import PerformanceChart from './PerformanceChart';\nimport SalesPanel from './SalesPanel';\nimport RealizedGainCard from './RealizedGainCard';")
 old='''        <div className="glass-panel metric-card" aria-label="Realized Loss/Gain pending sales integration">
          <div className="metric-header"><span>{t('dash.realizedLossGain')}</span><span className="metric-icon"><Coins size={18} /></span></div>
          <div className="metric-value" style={{ color: 'var(--text-muted)' }} aria-label="Not available">—</div>
          <div className="metric-footer">{t('dash.realizedPending')}</div>
        </div>'''
 d=once(d,old,'        <RealizedGainCard statsTrigger={statsTrigger} currency={summary.currency || reportingCurrency} />')
 d=once(d,'      <PerformanceChart statsTrigger={statsTrigger} />','      <PerformanceChart statsTrigger={statsTrigger} />\n      <SalesPanel statsTrigger={statsTrigger} onUpdate={onUpdate} showToast={showToast} />')
 d=marker+d
for path,text in ((srv,s),(dash,d),(sealed,r)):path.write_text(text)
