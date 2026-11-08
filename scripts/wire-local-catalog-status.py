from pathlib import Path
import hashlib

def read_guarded(name,expected):
    raw=Path(name).read_bytes()
    digest=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    if digest!=expected: raise SystemExit(name+': source changed; refusing to overwrite it')
    return raw.decode('utf-8')
def once(text,old,new):
    if text.count(old)!=1: raise SystemExit('Expected exactly one Admin integration point')
    return text.replace(old,new,1)
admin_name='backend/src/routes/admin.js'
admin=read_guarded(admin_name,'3ca9ebd44effb56487a48e28d3a905cff989e555')
admin=once(admin,'router.use(authenticateToken, requireAdmin);',"router.use(authenticateToken, requireAdmin);\nrouter.use('/local-catalog', require('./localCatalogStatus').createLocalCatalogStatusRouter({\n  connect: () => require('../utils/salesRepository').openConnection(db.dbPath),\n}));")
panel_name='frontend/src/components/CatalogPanel.jsx'
panel=read_guarded(panel_name,'268b93316ab43be34112d3f533a89ecafaadb2b2')
panel=once(panel,"import SetTree from './SetTree';","import SetTree from './SetTree';\nimport LocalCatalogStatusPanel from './LocalCatalogStatusPanel';")
panel=once(panel,'export default function CatalogPanel({ showToast }) {','function LegacyCatalogPanel({ showToast }) {')
panel+='\nexport default function CatalogPanel(props) {\n  const [legacyOpen, setLegacyOpen] = useState(false);\n  return <>\n    <LocalCatalogStatusPanel />\n    <details onToggle={event => setLegacyOpen(event.currentTarget.open)}>\n      <summary style={{cursor: \'pointer\', marginBottom: \'1rem\'}}>Scanner setup and legacy build tools</summary>\n      <p>Scanning still requires model files and a compatible index. These tools remain available while the replacement workflow is unfinished; metadata readiness does not establish scanner readiness.</p>\n      {legacyOpen && <LegacyCatalogPanel {...props} />}\n    </details>\n  </>;\n}\n'
for name,text in [(admin_name,admin),(panel_name,panel)]:
    Path(name).write_bytes(text.encode('utf-8'))
