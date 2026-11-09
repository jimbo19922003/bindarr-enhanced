// artwork-catalogue-repair-v1
'use strict';
const {randomUUID}=require('node:crypto');
const {createArtworkClient,findArtwork,saveMissingArtwork}=require('./pokemonArtworkRepair');
const {createCarddexArtworkClient}=require('./carddexArtwork');
const {orderedArtworkFallback}=require('./orderedArtworkFallback');
const schema='CREATE TABLE IF NOT EXISTS pokemon_artwork_repair_job(card_id TEXT PRIMARY KEY,state TEXT NOT NULL,provider TEXT,attempts_json TEXT NOT NULL,checked_at INTEGER NOT NULL,retry_at INTEGER NOT NULL)';
const allowed=new Set(['key_missing','key_rejected','rate_limited','not_found','set_unconfirmed','search_incomplete','ambiguous','image_unavailable','invalid_image','unsupported_language_or_game','upstream','card_changed','artwork_store_unavailable']);
const storageCodes=new Set(['SQLITE_BUSY','SQLITE_READONLY','SQLITE_CANTOPEN','SQLITE_ERROR','SQLITE_FULL','SQLITE_IOERR','EACCES','ENOSPC','EIO']);
const safeCode=error=>allowed.has(error?.code)||storageCodes.has(error?.code)?error.code:'internal_error';
function createArtworkRepairService({connect,art,providers,saveArtwork=saveMissingArtwork,now=Date.now,logger=entry=>console.info('[artwork-repair] '+JSON.stringify(entry))}){
 const pending=new Map();
 const audit=(event,details={})=>{try{logger({event,...details});}catch{}};
 if(!providers){const emergency=createArtworkClient({connect});providers={carddex:createCarddexArtworkClient({connect}),pokewallet:{lookup:card=>findArtwork(card,emergency),image:candidate=>emergency.image(candidate.providerId)}};}
 const valid=id=>typeof id==='string'&&id.startsWith('tcgdex-en-')&&art.isValidId(id);
 const logId=id=>valid(id)?id:'invalid';
 async function using(work){const db=await connect();try{await db.exec(schema);return await work(db);}finally{await db.close();}}
 const eligible=id=>using(db=>db.get("SELECT cc.* FROM card_cache cc WHERE cc.id=? AND cc.language='English' AND cc.game='pokemon'",[id]));
 const available=(id,provider='local',at=now())=>({state:'available',provider,url:'/api/card-art/'+encodeURIComponent(id)+'.png?v='+at});
 function attemptsOf(value){return Array.isArray(value)?value.slice(0,2).map(item=>({provider:['carddex','pokewallet'].includes(item?.provider)?item.provider:'unknown',status:allowed.has(item?.status)?item.status:'upstream'})):[];}
 async function record(id,state,provider,attempts,retry){await using(db=>db.run('INSERT INTO pokemon_artwork_repair_job VALUES(?,?,?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET state=excluded.state,provider=excluded.provider,attempts_json=excluded.attempts_json,checked_at=excluded.checked_at,retry_at=excluded.retry_at',[id,state,provider,JSON.stringify(attempts),now(),retry]));}
 async function status(id){
  if(!valid(id))return {state:'not_eligible',reason:'invalid_card_id'};
  if(art.resolve(id)){art.invalidate();return available(id);}
  if(pending.has(id))return {state:'pending',jobId:pending.get(id).jobId};
  const row=await using(db=>db.get('SELECT * FROM pokemon_artwork_repair_job WHERE card_id=?',[id]));
  if(row&&row.retry_at>now()){let attempts=[];try{attempts=attemptsOf(JSON.parse(row.attempts_json));}catch{audit('invalid_cached_diagnostics',{cardId:id});}return {state:'unavailable',reason:'provider_chain_exhausted',attempts,retryAt:new Date(row.retry_at).toISOString()};}
  return {state:'unknown'};
 }
 async function startJob(id){
  const existing=await status(id);if(existing.state!=='unknown'){audit('cached_or_existing_result',{cardId:logId(id),state:existing.state,attempts:existing.attempts||[],retryAt:existing.retryAt||null});return existing;}
  const card=await eligible(id);if(!card||String(card.image_url||'').trim()){const reason=card?'provider_reference_present':'not_cached';audit('not_eligible',{cardId:logId(id),reason});return {state:'not_eligible',reason};}
  if(pending.has(id))return {state:'pending',jobId:pending.get(id).jobId};
  if(pending.size>=2){audit('busy',{cardId:id});return {state:'busy',reason:'job_limit'};}
  const jobId=randomUUID();
  const trace=()=>Object.fromEntries(['carddex','pokewallet'].map(provider=>[provider,{
   lookup:async value=>{audit('provider_lookup',{cardId:id,jobId,provider});try{const candidate=await providers[provider].lookup(value);audit('provider_lookup_result',{cardId:id,jobId,provider,status:candidate?'matched':'image_unavailable'});return candidate;}catch(error){audit('provider_lookup_failed',{cardId:id,jobId,provider,code:safeCode(error)});throw error;}},
   image:async candidate=>{audit('provider_download',{cardId:id,jobId,provider});try{const bytes=await providers[provider].image(candidate);audit('provider_download_complete',{cardId:id,jobId,provider,bytes:Buffer.isBuffer(bytes)?bytes.length:null});return bytes;}catch(error){audit('provider_download_failed',{cardId:id,jobId,provider,code:safeCode(error)});throw error;}}
  }]));
  audit('queued',{cardId:id,jobId});
  const task=Promise.resolve().then(async()=>{
   try{const result=await orderedArtworkFallback(card,{...trace(),download:true,accept:async(bytes)=>{const current=await eligible(id);if(!current||['name','set_id','number','language'].some(key=>current[key]!==card[key])||String(current.image_url||'').trim())throw Object.assign(new Error(),{code:'card_changed'});try{return await saveArtwork(art,id,bytes);}catch(error){const code=error.code&&error.code!=='invalid_image'?'artwork_store_unavailable':'invalid_image';audit('image_validation_or_storage_failed',{cardId:id,jobId,code,detailCode:safeCode(error)});throw Object.assign(new Error(),{code});}}});const provider=result.accepted?.existing?'local':result.candidate.provider;await record(id,'available',provider,[],0);audit('complete',{cardId:id,jobId,provider});}
   catch(error){const attempts=attemptsOf(error.attempts);const transient=!attempts.length||attempts.some(item=>['key_missing','key_rejected','rate_limited','upstream','card_changed','artwork_store_unavailable'].includes(item.status));const retry=now()+(transient?60000:86400000);audit('unavailable',{cardId:id,jobId,code:safeCode(error),attempts,retryAt:new Date(retry).toISOString()});await record(id,'unavailable',null,attempts,retry);}
  }).catch(error=>{audit('job_storage_failed',{cardId:id,jobId,code:safeCode(error)});}).finally(()=>pending.delete(id));
  task.jobId=jobId;pending.set(id,task);return {state:'pending',jobId};
 }
 return {async start(id){audit('requested',{cardId:logId(id)});try{return await startJob(id);}catch(error){audit('preflight_failed',{cardId:logId(id),code:safeCode(error)});throw Object.assign(new Error('Artwork repair preflight failed'),{code:'ARTWORK_REPAIR_UNAVAILABLE'});}},status,async waitForIdle(){await Promise.all([...pending.values()]);}};
}
module.exports={createArtworkRepairService};
