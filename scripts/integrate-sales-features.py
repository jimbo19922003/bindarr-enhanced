from pathlib import Path
from hashlib import sha256

scripts=['scripts/apply-sale-aware-timeline.py','scripts/apply-dashboard-accounting.py','scripts/apply-sale-adjustments.py']
targets=['backend/src/utils/livePerformance.js','backend/src/utils/dailyPerformance.js','backend/src/utils/performanceHistory.js','backend/src/utils/performanceHistory.test.js','backend/src/utils/dashboardAccounting.test.js','backend/src/utils/salesApplication.js','backend/src/utils/salesReport.js','backend/src/utils/timelineAccounting.js','backend/src/utils/sealedSalesRepository.js','backend/src/routes/stats.js','backend/src/routes/sales.js','frontend/src/components/PerformanceChart.jsx','frontend/src/components/Dashboard.jsx','frontend/src/components/SalesHistory.jsx','frontend/src/components/SaleDialogHost.jsx']

def fix_fixture():
 p=Path('backend/src/utils/dashboardAccounting.test.js');s=p.read_text()
 old='CREATE TABLE sealed_pull(user_id INTEGER,collection_id INTEGER,filed_ids TEXT);'
 new='CREATE TABLE sealed_pull(id INTEGER PRIMARY KEY,user_id INTEGER,collection_id INTEGER,filed_ids TEXT);'
 if old in s:
  if s.count(old)!=1:raise RuntimeError('Ambiguous sealed pull fixture schema')
  s=s.replace(old,new,1)
 elif new not in s:raise RuntimeError('Dashboard fixture schema changed')
 old="INSERT INTO sealed_pull VALUES(1,10,'10')"
 new="INSERT INTO sealed_pull(user_id,collection_id,filed_ids) VALUES(1,10,'10')"
 if old in s:
  if s.count(old)!=1:raise RuntimeError('Ambiguous fixture insert')
  s=s.replace(old,new,1)
 elif new not in s:raise RuntimeError('Dashboard fixture insert changed')
 p.write_text(s)

def apply():
 fix_fixture()
 for filename in scripts:
  source=Path(filename).read_text()
  old='if not s.startswith(marker):'
  if old not in source:raise RuntimeError('Unrecognized integration guard: '+filename)
  source=source.replace(old,'if marker.strip() not in s.splitlines():')
  namespace={'__name__':'__main__','__file__':filename}
  exec(compile(source,filename,'exec'),namespace)

def hashes():
 return {name:sha256(Path(name).read_bytes()).hexdigest() for name in targets}

def verify():
 checks={
  'frontend/src/components/SalesHistory.jsx':['SaleAdjustmentDialog',"action:'audit'","action:'correct'","action:'undo'",'Status / actions'],
  'frontend/src/components/Dashboard.jsx':['<PortfolioAccountingSummary','game={gameFilter}'],
  'frontend/src/components/PerformanceChart.jsx':["['totalGain','realizedGain','unrealizedGain']","game = ''"],
  'backend/src/routes/sales.js':["/:historyId/adjustments/preview",'service.adjustSale','service.saleAudit'],
  'backend/src/routes/stats.js':["/stats/accounting",'dashboardAccounting'],
  'backend/src/utils/livePerformance.js':['timelineAccounting','accounting, day:'],
  'backend/src/utils/dailyPerformance.js':['timelineAccounting','BEGIN IMMEDIATE'],
  'backend/src/utils/performanceHistory.js':['decoratePoint','portfolio_accounting_daily'],
  'backend/src/utils/salesApplication.js':['adjustmentPreview(user,id,body)','adjustSale(user,id,body)'],
  'backend/src/utils/salesReport.js':['effectiveSource',"sale_status='active'"],
  'backend/src/utils/timelineAccounting.js':['effectiveSource(db,table)'],
  'backend/src/utils/dashboardAccounting.test.js':['sealed_pull(id INTEGER PRIMARY KEY','INSERT INTO sealed_pull(user_id,collection_id,filed_ids)']
 }
 for name,needles in checks.items():
  text=Path(name).read_text()
  for needle in needles:
   if needle not in text:raise RuntimeError('Missing integrated feature in '+name+': '+needle)

apply()
verify()
first=hashes()
apply()
verify()
if hashes()!=first:raise RuntimeError('Combined integrations are not idempotent')
