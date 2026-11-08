from pathlib import Path
marker='// dashboard-accounting-v1\n'
def once(s,old,new):
 if s.count(old)!=1:raise RuntimeError('Dashboard accounting anchor changed: '+old[:100])
 return s.replace(old,new,1)
changes=[]
p=Path('backend/src/routes/stats.js');s=p.read_text()
if not s.startswith(marker):
 anchor="router.get('/stats/performance',"
 endpoint="""router.get('/stats/accounting', async (req,res) => {
  res.set('Cache-Control','no-store');
  try { res.json(await require('../utils/dashboardAccounting').readSummary({connect:()=>require('../utils/salesRepository').openConnection(db.dbPath),user:req.user?.id,game:String(req.query.game||''),currency:String(req.query.currency||'USD')})); }
  catch(error) { failure(res,error,'Failed to compute portfolio accounting'); }
});

"""
 s=once(s,anchor,endpoint+anchor);changes.append((p,marker+s))
p=Path('frontend/src/components/Dashboard.jsx');s=p.read_text()
if not s.startswith(marker):
 s=once(s,"import RealizedGainCard from './RealizedGainCard';","import PortfolioAccountingSummary from './PortfolioAccountingSummary';")
 start=s.index('        <div className="glass-panel metric-card accent-invested">',s.index('{/* Aligned Executive summary cards */}'))
 end=s.index('\n',s.index('        <RealizedGainCard ',start))+1
 segment=s[start:end]
 if 'summary.totalSpent' not in segment or 'const roi = summary.roi' not in segment:raise RuntimeError('Executive metric layout changed')
 s=s[:start]+'        <PortfolioAccountingSummary statsTrigger={statsTrigger} game={gameFilter} currency={summary.currency || reportingCurrency} />\n'+s[end:]
 s=once(s,'if (!stats || (stats.summary.totalCards === 0 && sealedUnits === 0 && (!openedReports || openedReports.length === 0))) {','if (!stats) {')
 s=once(s,'<PerformanceChart statsTrigger={statsTrigger} />','<PerformanceChart statsTrigger={statsTrigger} game={gameFilter} />')
 changes.append((p,marker+s))
p=Path('frontend/src/components/PerformanceChart.jsx');s=p.read_text()
if not s.startswith(marker):
 s=once(s,'function PerformanceChart({ statsTrigger })','function PerformanceChart({ statsTrigger, game = \'\' })')
 s=once(s,'const params = new URLSearchParams({range,currency:\'USD\'});','const params = new URLSearchParams({range,currency:\'USD\'});\n    if (game) params.set(\'game\',game);')
 s=once(s,'[range,statsTrigger,refresh,withBenchmark]','[range,statsTrigger,refresh,withBenchmark,game]')
 s=once(s,'<span>All games · USD','<span>{game ? game.toUpperCase() : \'All games\'} · USD')
 changes.append((p,marker+s))
for path,text in changes:path.write_text(text)
