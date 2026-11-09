from pathlib import Path
import hashlib

MARKER='// artwork-catalogue-repair-v1'
EXPECTED={
 'backend/src/routes/artworkRepair.js':'d29d92f3c5999fdc4378b0d20cdf26da360dab9b',
 'backend/src/utils/artworkRepairService.js':'56c5423a2d41fad33c83d24c56c0bc439ee9dfd3',
 'backend/src/routes/catalogueSetup.js':'74f8a25910c900d56208e6382a7308d661677eef',
 'frontend/src/components/SetupCardCatalogue.jsx':'dd85db7c1710567207b557e3b21b788ab832e120',
}

def once(text,old,new):
 if text.count(old)!=1:raise SystemExit('Reviewed repair point changed: '+old[:100])
 return text.replace(old,new,1)

def main():
 texts={name:Path(name).read_text() for name in EXPECTED}
 if all(MARKER in text for text in texts.values()):return
 for name,expected in EXPECTED.items():
  raw=Path(name).read_bytes()
  actual=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
  if actual!=expected:raise SystemExit(name+': changed since review; refusing to overwrite')
 name='backend/src/routes/artworkRepair.js';text=texts[name]
 text=once(text,'function createArtworkRepairRouter(',"function artworkRepairEnabled(env=process.env){return env.POKEMON_ARTWORK_REPAIR!=='0';}\nfunction createArtworkRepairRouter(")
 text=once(text,"enabled=()=>process.env.POKEMON_LOCAL_CATALOG==='1'",'enabled=artworkRepairEnabled')
 text=once(text,'module.exports={createArtworkRepairRouter};','module.exports={createArtworkRepairRouter,artworkRepairEnabled};')
 texts[name]=text
 name='backend/src/utils/artworkRepairService.js';text=texts[name]
 text=once(text,"SELECT cc.* FROM card_cache cc JOIN pokemon_catalog_card pc ON pc.id=cc.id JOIN pokemon_catalog_active a ON a.snapshot_id=pc.snapshot_id WHERE cc.id=? AND a.language='en' AND cc.language='English' AND cc.game='pokemon'","SELECT cc.* FROM card_cache cc WHERE cc.id=? AND cc.language='English' AND cc.game='pokemon'")
 text=once(text,"'not_in_active_snapshot'","'not_cached'")
 texts[name]=text
 name='backend/src/routes/catalogueSetup.js';text=texts[name]
 text=once(text,'let available=null;try{available=await source.discover();}catch{}',"let available=null,sourceErrorCode=null;try{available=await source.discover();}catch(error){const codes=new Set(['CATALOG_RELEASE_MISSING','CATALOG_ASSET_MISSING','CATALOG_MANIFEST_INVALID','CATALOG_SOURCE_COOLDOWN','CATALOG_REDIRECT_BLOCKED','CATALOG_SOURCE_INVALID','CATALOG_DOWNLOAD_TOO_LARGE']);sourceErrorCode=codes.has(error?.code)?error.code:'CATALOG_SOURCE_UNAVAILABLE';}")
 text=once(text,'sourceAvailable:!!available,languages:','sourceAvailable:!!available,sourceErrorCode,languages:')
 texts[name]=text
 name='frontend/src/components/SetupCardCatalogue.jsx';text=texts[name]
 text=once(text,"const endpoint='/api/admin/local-catalog/setup';","const endpoint='/api/admin/local-catalog/setup';\nconst sourceMessages={CATALOG_RELEASE_MISSING:'The catalogue download has not been published yet. A successful validated build and publication are required before installation.',CATALOG_ASSET_MISSING:'The published catalogue is incomplete. Installation is paused until all validated download files are available.',CATALOG_MANIFEST_INVALID:'The published catalogue manifest failed validation. No catalogue was installed.',CATALOG_SOURCE_COOLDOWN:'The catalogue source is temporarily in cooldown. Wait before refreshing; provider keys do not clear this cooldown.',CATALOG_REDIRECT_BLOCKED:'The catalogue download redirected to an unapproved location and was blocked.',CATALOG_SOURCE_INVALID:'The catalogue source configuration is invalid.',CATALOG_DOWNLOAD_TOO_LARGE:'The catalogue download exceeded its safety limit.'};")
 text=once(text,'No published catalogue download is available right now. Existing installed data can still be used. Refresh after a validated catalogue release is published; no commit ID or server path is needed here.',"{sourceMessages[data.sourceErrorCode]||'The catalogue source could not be reached. Existing installed data is unchanged.'}{' '}Existing installed catalogues remain usable. <a href=\"https://github.com/jimbo19922003/bindarr-enhanced/actions/workflows/build-pokemon-catalog.yml\" target=\"_blank\" rel=\"noreferrer\">Catalogue build and publication status</a>{data.sourceErrorCode&&<span> ({data.sourceErrorCode})</span>}")
 text=once(text,'(data?.languages||[]).map(row=>','(data?.languages||[]).filter(row=>data.sourceAvailable||row.installed||row.needsRepair).map(row=>')
 texts[name]=text
 for name,text in texts.items():Path(name).write_text(MARKER+'\n'+text)

if __name__=='__main__':main()
