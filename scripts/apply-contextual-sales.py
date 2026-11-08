from pathlib import Path
marker='// contextual-sales-v1\n'
def once(s,old,new):
 if s.count(old)!=1:raise RuntimeError('Contextual sales anchor changed: '+old[:110])
 return s.replace(old,new,1)
def source(path):
 p=Path(path);return p,p.read_text()
changes=[]
p,s=source('frontend/src/App.jsx')
if not s.startswith(marker):
 s=once(s,"import Logo from './components/Logo';","import Logo from './components/Logo';\nimport SaleDialogHost from './components/SaleDialogHost';")
 s=once(s,"const SealedInventory = lazy(() => import('./components/SealedInventory'));","const SealedInventory = lazy(() => import('./components/SealedInventory'));\nconst SalesHistory = lazy(() => import('./components/SalesHistory'));")
 s=once(s,"    window.addEventListener(VALUATION_CHANGED, invalidate);","    window.addEventListener(VALUATION_CHANGED, invalidate);\n    window.addEventListener('bindarr_sales_changed', invalidate);")
 s=once(s,"    return () => window.removeEventListener(VALUATION_CHANGED, invalidate);","    return () => { window.removeEventListener(VALUATION_CHANGED, invalidate); window.removeEventListener('bindarr_sales_changed', invalidate); };")
 s=once(s,'  const [shareToken] = useState(() => {',"  useEffect(() => {\n    const open = () => goTab('sales-history');\n    window.addEventListener('bindarr_open_sales_history', open);\n    return () => window.removeEventListener('bindarr_open_sales_history', open);\n  }, [activeTab]);\n  const [shareToken] = useState(() => {")
 s=once(s,"      case 'notes': return <Notes showToast={showToast} />;","      case 'sales-history': return <SalesHistory statsTrigger={statsTrigger} />;\n      case 'notes': return <Notes showToast={showToast} />;")
 nav='''          <button className={`nav-tab ${activeTab === 'sales-history' ? 'active' : ''}`} onClick={() => goTab('sales-history')} aria-label="Sales History" title="Sales History"><Database size={18} /><span className="nav-tab-label">Sales History</span></button>
'''
 anchor="          <button className={`nav-tab ${activeTab === 'storage'"
 if s.count(anchor)!=1:raise RuntimeError('Storage navigation changed')
 s=s[:s.index(anchor)]+nav+s[s.index(anchor):]
 s=once(s,"      <main style={{ flex: 1, marginTop: '1rem' }}>","      <SaleDialogHost showToast={showToast} />\n      <main style={{ flex: 1, marginTop: '1rem' }}>")
 changes.append((p,marker+s))
p,s=source('frontend/src/components/Dashboard.jsx')
if not s.startswith(marker):
 s=once(s,"import SalesPanel from './SalesPanel';\n",'')
 s=once(s,'      <SalesPanel statsTrigger={statsTrigger} onUpdate={onUpdate} showToast={showToast} />\n','')
 changes.append((p,marker+s))
p,s=source('frontend/src/components/RealizedGainCard.jsx')
if not s.startswith(marker):
 s=once(s,"new Event('bindarr_open_sales')","new Event('bindarr_open_sales_history')")
 s=once(s,'>View / record sales</button>','>Sales history</button>')
 changes.append((p,marker+s))
p,s=source('frontend/src/components/CardInspectorModal.jsx')
if not s.startswith(marker):
 s=once(s,"import CardImage from './CardImage';","import CardImage from './CardImage';\nimport { cardSaleTarget } from '../utils/saleTargets';")
 s=once(s,'  const displayPrice = resolveCardPrice(activeCard, printing);','  const displayPrice = resolveCardPrice(activeCard, printing);\n  const saleTarget = cardSaleTarget(card);')
 button='''          {mode === 'view' && saleTarget && <div><button type="button" className="btn btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('bindarr_sell_item', { detail: { ...saleTarget, onSold: () => { onUpdate?.(); onClose?.(); } } }))}>Sell this copy</button></div>}

'''
 s=once(s,"          {mode === 'edit' ? (",button+"          {mode === 'edit' ? (")
 changes.append((p,marker+s))
p,s=source('frontend/src/components/SealedInventory.jsx')
if not s.startswith(marker):
 s=once(s,"import SealedOpenings from './SealedOpenings';","import SealedOpenings from './SealedOpenings';\nimport { sealedSaleTarget } from '../utils/saleTargets';")
 old='<LotRow key={item.id} lot={item} t={t} onUpdateLot={onUpdateLot} onArchiveLot={onArchiveLot} onRip={() => setRipLot(item)} />'
 new='<LotRow key={item.id} lot={item} t={t} onUpdateLot={onUpdateLot} onArchiveLot={onArchiveLot} onRip={() => setRipLot(item)} onSell={!product.archived_at ? () => { const target = sealedSaleTarget(item, product); if (target) window.dispatchEvent(new CustomEvent("bindarr_sell_item", { detail: { ...target, onSold: onChanged } })); } : null} />'
 s=once(s,old,new)
 s=once(s,'function LotRow({ lot, t, onUpdateLot, onArchiveLot, onRip })','function LotRow({ lot, t, onUpdateLot, onArchiveLot, onRip, onSell })')
 anchor="          {canRip && <button className=\"btn btn-primary\" type=\"button\" onClick={onRip}>{t('sealed.letItRip')}</button>}".replace('\"','"')
 s=once(s,anchor,anchor+'\n          {canRip && onSell && <button className="btn btn-secondary" type="button" onClick={onSell} title={`Sell from lot #${lot.id}`}>Sell</button>}')
 changes.append((p,marker+s))
p,s=source('backend/src/utils/salesApplication.js')
if not s.startswith(marker):
 start=s.index('  history(user,{beforeId=Number.MAX_SAFE_INTEGER,limit=25}={}) {')
 end=s.index('\n };\n}',start)
 s=s[:start]+"  history(user,filters={}) {\n   return read(user,db=>require('./salesReport').readReport(db,user,filters));\n  }"+s[end:]
 changes.append((p,marker+s))
p,s=source('backend/src/routes/sales.js')
if not s.startswith(marker):
 old="router.get('/history',handle(req=>service.history(req.user.id,{beforeId:req.query.beforeId?Number(req.query.beforeId):Number.MAX_SAFE_INTEGER,limit:req.query.limit?Number(req.query.limit):25})));"
 s=once(s,old,"router.get('/history',handle(req=>service.history(req.user.id,req.query)));")
 changes.append((p,marker+s))
for path,text in changes:path.write_text(text)
