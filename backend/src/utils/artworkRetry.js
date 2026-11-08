'use strict';
const schema=`CREATE TABLE IF NOT EXISTS pokemon_artwork_repair_job(card_id TEXT PRIMARY KEY,state TEXT NOT NULL,provider TEXT,attempts_json TEXT NOT NULL,checked_at INTEGER NOT NULL,retry_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS pokemon_artwork_manual_retry(card_id TEXT PRIMARY KEY,requested_at INTEGER NOT NULL);`;
const valid=id=>typeof id==='string'&&/^tcgdex-en-[A-Za-z0-9._-]{1,110}$/.test(id)&&!id.includes('..');
const codes=new Set(['key_missing','key_rejected','rate_limited','not_found','set_unconfirmed','search_incomplete','ambiguous','image_unavailable','invalid_image','unsupported_language_or_game','upstream','card_changed','artwork_store_unavailable']);
function attempts(text){try{const rows=JSON.parse(text);return Array.isArray(rows)?rows.slice(0,2).map(row=>({provider:['carddex','pokewallet'].includes(row?.provider)?row.provider:'unknown',status:codes.has(row?.status)?row.status:'upstream'})):[];}catch{return [];}}
function createArtworkRetry({service,connect=()=>require('./salesRepository').openConnection(require('../db').dbPath),now=Date.now}){
 async function using(work){const db=await connect();try{await db.exec(schema);return await work(db);}finally{await db.close();}}
 return {
  async failures(){const rows=await using(db=>db.all("SELECT card_id,attempts_json,retry_at FROM pokemon_artwork_repair_job WHERE state='unavailable' ORDER BY checked_at DESC LIMIT 20"));return {cards:rows.filter(row=>valid(row.card_id)).map(row=>({cardId:row.card_id,attempts:attempts(row.attempts_json),retryAt:Number.isSafeInteger(row.retry_at)&&row.retry_at>0?new Date(row.retry_at).toISOString():null})),limit:20};},
  async retry(id){
   if(!valid(id))return {state:'not_eligible',reason:'invalid_card_id'};
   const existing=await service.status(id);if(['available','pending','not_eligible'].includes(existing.state))return existing;
   const limited=await using(async db=>{let began=false;try{await db.run('BEGIN IMMEDIATE');began=true;const at=now(),previous=await db.get('SELECT requested_at FROM pokemon_artwork_manual_retry WHERE card_id=?',[id]),total=await db.get('SELECT COUNT(*) AS n FROM pokemon_artwork_manual_retry WHERE requested_at>?',[at-60000]);if(previous&&previous.requested_at>at-60000||total.n>=10)return {state:'busy',reason:'manual_retry_limit',retryAt:new Date(at+60000).toISOString()};await db.run('INSERT INTO pokemon_artwork_manual_retry VALUES(?,?) ON CONFLICT(card_id) DO UPDATE SET requested_at=excluded.requested_at',[id,at]);await db.run("UPDATE pokemon_artwork_repair_job SET retry_at=0 WHERE card_id=? AND state='unavailable'",[id]);await db.run('DELETE FROM pokemon_artwork_manual_retry WHERE requested_at<?',[at-86400000]);await db.run('COMMIT');began=false;return null;}finally{if(began)await db.run('ROLLBACK').catch(()=>{});}});
   return limited||service.start(id);
  }
 };
}
module.exports={createArtworkRetry};
