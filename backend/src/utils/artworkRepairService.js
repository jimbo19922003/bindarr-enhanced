'use strict';
const {createArtworkClient,findArtwork,saveMissingArtwork}=require('./pokemonArtworkRepair');
const {createCarddexArtworkClient}=require('./carddexArtwork');
const {orderedArtworkFallback}=require('./orderedArtworkFallback');
const schema='CREATE TABLE IF NOT EXISTS pokemon_artwork_repair_job(card_id TEXT PRIMARY KEY,state TEXT NOT NULL,provider TEXT,attempts_json TEXT NOT NULL,checked_at INTEGER NOT NULL,retry_at INTEGER NOT NULL)';
const allowed=new Set(['key_missing','key_rejected','rate_limited','not_found','set_unconfirmed','search_incomplete','ambiguous','image_unavailable','invalid_image','unsupported_language_or_game','upstream','card_changed','artwork_store_unavailable']);
function createArtworkRepairService({connect,art,providers,saveArtwork=saveMissingArtwork,now=Date.now}){
 const pending=new Map();
 if(!providers){const emergency=createArtworkClient({connect});providers={carddex:createCarddexArtworkClient({connect}),pokewallet:{lookup:card=>findArtwork(card,emergency),image:candidate=>emergency.image(candidate.providerId)}};}
 const valid=id=>typeof id==='string'&&id.startsWith('tcgdex-en-')&&art.isValidId(id);
 async function using(work){const db=await connect();try{await db.exec(schema);return await work(db);}finally{await db.close();}}
 const eligible=id=>using(db=>db.get("SELECT cc.* FROM card_cache cc JOIN pokemon_catalog_card pc ON pc.id=cc.id JOIN pokemon_catalog_active a ON a.snapshot_id=pc.snapshot_id WHERE cc.id=? AND a.language='en' AND cc.language='English' AND cc.game='pokemon'",[id]));
 const available=(id,provider='local',at=now())=>({state:'available',provider,url:'/api/card-art/'+encodeURIComponent(id)+'.png?v='+at});
 function attemptsOf(value){return Array.isArray(value)?value.slice(0,2).map(item=>({provider:['carddex','pokewallet'].includes(item?.provider)?item.provider:'unknown',status:allowed.has(item?.status)?item.status:'upstream'})):[];}
 async function record(id,state,provider,attempts,retry){await using(db=>db.run('INSERT INTO pokemon_artwork_repair_job VALUES(?,?,?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET state=excluded.state,provider=excluded.provider,attempts_json=excluded.attempts_json,checked_at=excluded.checked_at,retry_at=excluded.retry_at',[id,state,provider,JSON.stringify(attempts),now(),retry]));}
 async function status(id){if(!valid(id))return {state:'not_eligible'};if(art.resolve(id)){art.invalidate();return available(id);}if(pending.has(id))return {state:'pending'};const row=await using(db=>db.get('SELECT * FROM pokemon_artwork_repair_job WHERE card_id=?',[id]));if(row&&row.retry_at>now()){let attempts=[];try{attempts=attemptsOf(JSON.parse(row.attempts_json));}catch{}return {state:'unavailable',attempts,retryAt:new Date(row.retry_at).toISOString()};}return {state:'unknown'};}
 async function start(id){
  const existing=await status(id);if(existing.state!=='unknown')return existing;
  const card=await eligible(id);if(!card||String(card.image_url||'').trim())return {state:'not_eligible'};
  if(pending.has(id))return {state:'pending'};if(pending.size>=2)return {state:'busy'};
  const task=Promise.resolve().then(async()=>{
   try{const result=await orderedArtworkFallback(card,{...providers,download:true,accept:async(bytes)=>{const current=await eligible(id);if(!current||['name','set_id','number','language'].some(key=>current[key]!==card[key])||String(current.image_url||'').trim())throw Object.assign(new Error(),{code:'card_changed'});try{return await saveArtwork(art,id,bytes);}catch(error){throw Object.assign(new Error(),{code:error.code&&error.code!=='invalid_image'?'artwork_store_unavailable':'invalid_image'});}}});await record(id,'available',result.accepted?.existing?'local':result.candidate.provider,[],0);}
   catch(error){const attempts=attemptsOf(error.attempts);const transient=!attempts.length||attempts.some(item=>['key_missing','key_rejected','rate_limited','upstream','card_changed','artwork_store_unavailable'].includes(item.status));await record(id,'unavailable',null,attempts,now()+(transient?60000:86400000));}
  }).catch(()=>{}).finally(()=>pending.delete(id));
  pending.set(id,task);return {state:'pending'};
 }
 return {start,status,async waitForIdle(){await Promise.all([...pending.values()]);}};
}
module.exports={createArtworkRepairService};
