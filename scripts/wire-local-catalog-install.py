from pathlib import Path

def once(text,old,new):
    if text.count(new)==1 and old not in text.replace(new,'',1):
        return text
    if text.count(new)==0 and text.count(old)==1:
        return text.replace(old,new,1)
    raise SystemExit('Expected exactly one patched or unpatched catalogue install integration point')
route_name='backend/src/routes/localCatalogStatus.js'
route=Path(route_name).read_text()
route=once(route,"  router.get('/', async (req, res) => {","  router.use('/install', require('./localCatalogInstall').createLocalCatalogInstallRouter({connect}));\n  router.get('/', async (req, res) => {")
panel_name='frontend/src/components/LocalCatalogStatusPanel.jsx'
panel=Path(panel_name).read_text()
panel=once(panel,"import { useEffect, useState } from 'react';","import { useEffect, useState } from 'react';\nimport LocalCatalogImportPanel from './LocalCatalogImportPanel';")
panel=once(panel,'Sync/import controls are not yet connected.','Use the staged-bundle preview/install controls below; automatic delivery is not connected.')
panel=once(panel,'  </section>;',"    <LocalCatalogImportPanel language={language} onImported={() => setRefresh(value => value + 1)} />\n  </section>;")
for name,text in [(route_name,route),(panel_name,panel)]:
    Path(name).write_text(text)
