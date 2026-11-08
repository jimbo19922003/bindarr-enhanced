'use strict';
const {randomUUID}=require('node:crypto');
const {LANGUAGES}=require('./languages');
const {normalize}=require('./pokemonLocalCatalog');
const failure=(status,code,message)=>Object.assign(new Error(message),{status,code});
function createPokemonBundleInstall({store,loadSnapshot,now=Date.now,ttlMs=600000}) {
  let draft=null,verifying=false,task=null,job=null;
  const status=()=>({running:!!task,verifying,job:job?JSON.parse(JSON.stringify(job)):null});
  return {
    status,
    async preview(body={}) {
      if(task||verifying)throw failure(409,'CATALOG_BUSY','A verification or import is already running');
      if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(key=>!['commit','language'].includes(key)))throw failure(400,'INVALID_CATALOG_REQUEST','Only commit and language are accepted');
      const {commit,language='en'}=body;
      if(!/^[a-f0-9]{40}$/.test(commit||'')||!LANGUAGES.some(item=>item.code===language))throw failure(400,'INVALID_CATALOG_REQUEST','Choose a pinned commit and supported language');
      verifying=true;draft=null;
      try {
        const snapshot=JSON.parse(JSON.stringify(await loadSnapshot({commit,language})));
        if(snapshot.commit!==commit||snapshot.language!==language)throw new Error('Unexpected snapshot identity');
        const data=normalize(snapshot);
        const details={previewId:randomUUID(),commit,language,cardCount:data.cards.length,setCount:data.sets.length,artworkReferences:data.cards.filter(card=>card.image_url).length,missingArtworkReferences:data.cards.filter(card=>!card.image_url).length,contentHash:data.contentHash,expiresAt:new Date(now()+ttlMs).toISOString()};
        draft={snapshot,details,expiresAt:now()+ttlMs};
        return {...details};
      } catch(error) {
        console.error('Staged catalog verification failed:',error.message);
        throw failure(422,'CATALOG_BUNDLE_INVALID','Could not verify the configured staged bundle');
      } finally {verifying=false;}
    },
    apply(body={}) {
      if(task||verifying)throw failure(409,'CATALOG_BUSY','A verification or import is already running');
      if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(key=>!['previewId','confirmed'].includes(key))||body.confirmed!==true)throw failure(400,'CATALOG_CONFIRMATION_REQUIRED','Explicit confirmation of the preview is required');
      if(!draft||body.previewId!==draft.details.previewId)throw failure(409,'CATALOG_PREVIEW_INVALID','Preview the staged bundle again');
      if(now()>=draft.expiresAt){draft=null;throw failure(410,'CATALOG_PREVIEW_EXPIRED','The preview expired; verify it again');}
      const approved=draft;draft=null;
      job={id:randomUUID(),phase:'running',commit:approved.details.commit,language:approved.details.language,startedAt:new Date(now()).toISOString()};
      task=Promise.resolve().then(()=>store.importSnapshot(approved.snapshot)).then(result=>{job={...job,phase:'done',finishedAt:new Date(now()).toISOString(),result:{cardCount:result.card_count,setCount:result.set_count,unchanged:!!result.unchanged,scanRefreshRequired:!!result.scan_refresh_required}};}).catch(error=>{console.error('Catalog import failed:',error.message);job={...job,phase:'failed',finishedAt:new Date(now()).toISOString(),code:'CATALOG_IMPORT_FAILED',message:'Import failed. Inspect server logs; the transactional importer rolls back incomplete changes.'};}).finally(()=>{task=null;});
      return status();
    },
    async waitForIdle(){if(task)await task;return status();}
  };
}
module.exports={createPokemonBundleInstall};
