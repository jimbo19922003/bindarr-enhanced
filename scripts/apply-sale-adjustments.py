from pathlib import Path
marker='// sale-adjustments-v1\n'
def once(s,old,new):
 if s.count(old)!=1:raise RuntimeError('Sale adjustment anchor changed: '+old[:100])
 return s.replace(old,new,1)
changes=[]
def edit(path,fn):
 p=Path(path);s=p.read_text()
 if not s.startswith(marker):changes.append((p,marker+fn(s)))
def application(s):
 return once(s,"  items(user,{kind='card',q=''}={}) {","  adjustmentPreview(user,id,body) {return require('./saleAdjustments').createSaleAdjustments({connect}).preview(user,id,body);},\n  adjustSale(user,id,body) {return require('./saleAdjustments').createSaleAdjustments({connect}).apply(user,id,body);},\n  saleAudit(user,id) {return require('./saleAdjustments').createSaleAdjustments({connect}).audit(user,id);},\n  items(user,{kind='card',q=''}={}) {")
edit('backend/src/utils/salesApplication.js',application)
def routes(s):
 anchor=" router.get('/items',"
 addition=" router.get('/:historyId/adjustments',handle(req=>service.saleAudit(req.user.id,Number(req.params.historyId))));\n router.post('/:historyId/adjustments/preview',handle(req=>service.adjustmentPreview(req.user.id,Number(req.params.historyId),req.body||{})));\n router.post('/:historyId/adjustments',handle(req=>service.adjustSale(req.user.id,Number(req.params.historyId),req.body||{})));\n"
 return once(s,anchor,addition+anchor)
edit('backend/src/routes/sales.js',routes)
def report(s):
 s=once(s," const where=clauses.join(' AND ');"," const source=await require('./saleAdjustments').effectiveSource(db,'sales_entry',true);\n const where=clauses.join(' AND ');")
 if s.count('FROM sales_entry WHERE ${where}')!=3:raise RuntimeError('History query count changed')
 s=s.replace('FROM sales_entry WHERE ${where}','FROM ${source} WHERE ${where}')
 s=once(s,'WHERE ${where} GROUP BY currency',"WHERE ${where} AND sale_status='active' GROUP BY currency")
 return once(s,'WHERE ${where} GROUP BY month,currency',"WHERE ${where} AND sale_status='active' GROUP BY month,currency")
edit('backend/src/utils/salesReport.js',report)
def timeline(s):
 s=once(s,'  const rows=await db.all(card?',"  const source=await require('./saleAdjustments').effectiveSource(db,table);\n  const rows=await db.all(card?")
 s=once(s,'FROM ${table} r LEFT JOIN','FROM ${source} r LEFT JOIN')
 return once(s,'SELECT * FROM ${table} WHERE user_id=? AND sold_on<=?','SELECT * FROM ${source} WHERE user_id=? AND sold_on<=?')
edit('backend/src/utils/timelineAccounting.js',timeline)
def sealed(s):
 old="        return await db.all('SELECT id,lot_id,sold_on,quantity,proceeds_cents,fees_cents,sold_basis_cents,realized_gain_cents,currency,product_name,notes FROM sealed_sale_record WHERE user_id=? AND id<? ORDER BY id DESC LIMIT ?',[userId,beforeId,limit]);"
 new="        const source=await require('./saleAdjustments').effectiveSource(db,'sealed_sale_record');\n        return await db.all(`SELECT id,lot_id,sold_on,quantity,proceeds_cents,fees_cents,sold_basis_cents,realized_gain_cents,currency,product_name,notes FROM ${source} WHERE user_id=? AND id<? ORDER BY id DESC LIMIT ?`,[userId,beforeId,limit]);"
 return once(s,old,new)
edit('backend/src/utils/sealedSalesRepository.js',sealed)
def history(s):
 s=once(s,"import './SalesWorkflow.css';","import './SalesWorkflow.css';\nimport SaleAdjustmentDialog from './SaleAdjustmentDialog';")
 s=once(s,'export default function SalesHistory({statsTrigger}) {','export default function SalesHistory({statsTrigger}) {\n const [adjustment,setAdjustment]=useState(null);')
 s=once(s,'<th>Loss/Gain</th></tr>','<th>Loss/Gain</th><th>Status / actions</th></tr>')
 s=once(s,'<td>{money(r.realizedGainCents,r.currency)}</td></tr>',"<td>{money(r.realizedGainCents,r.currency)}</td><td><div>{r.saleStatus||'active'} · revision {r.revision||0}</div><button type=\"button\" className=\"btn btn-secondary\" onClick={()=>setAdjustment({row:r,action:'audit'})}>Audit</button>{r.saleStatus!=='undone'&&<><button type=\"button\" className=\"btn btn-secondary\" onClick={()=>setAdjustment({row:r,action:'correct'})}>Correct</button><button type=\"button\" className=\"btn btn-secondary\" onClick={()=>setAdjustment({row:r,action:'undo'})}>Undo</button></>}</td></tr>")
 s=once(s,'Sale correction/reversal is not available yet.','Corrected sales use their latest financial details. Undone sales remain visible for audit but are excluded from active totals. Saved historical timeline snapshots are not rewritten.')
 return once(s,' return <div className="sales-report">',' return <div className="sales-report">\n  {adjustment&&<SaleAdjustmentDialog key={`${adjustment.row.historyId}-${adjustment.action}`} {...adjustment} onClose={()=>setAdjustment(null)} onDone={()=>{setAdjustment(null);setRefresh(n=>n+1);}}/>}')
edit('frontend/src/components/SalesHistory.jsx',history)
edit('frontend/src/components/SaleDialogHost.jsx',lambda s:once(s,'Sale reversal is not available yet.','Correction and guarded undo are available in Sales History.'))
for path,text in changes:path.write_text(text)
