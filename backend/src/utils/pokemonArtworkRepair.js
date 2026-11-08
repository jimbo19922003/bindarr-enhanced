'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const match=require('./pokewalletMatch');
const DAY=86400000,HOUR=3600000,MAX_BYTES=8*1024*1024;
const fail=code=>Object.assign(new Error(code),{code});
async function using(connect,work){const db=await connect();try{return await work(db);}finally{await db.close();}}
function createArtworkClient({connect,http=require('axios'),now=Date.now}){
 async function request(endpoint,params={},binary=false){
  const key=await using(connect,async db=>{let saved='';try{saved=(await db.get('SELECT pokewallet_api_key FROM app_settings WHERE id=1'))?.pokewallet_api_key||'';}catch{}return String(saved).trim()||String(process.env.POKEWALLET_API_KEY||'').trim();});
  if(!key)throw fail('key_missing');
  const query=new URLSearchParams(Object.entries(params).sort()),cacheKey=createHash('sha256').update(key).digest('hex').slice(0,16)+' GET '+endpoint+'?'+query;
  if(!binary){const cached=await using(connect,db=>db.get('SELECT body,fetched_at FROM pokewallet_cache WHERE request=?',[cacheKey]));if(cached&&now()-cached.fetched_at>=0&&now()-cached.fetched_at<DAY&&cached.body.length<=2*1024*1024){try{return JSON.parse(cached.body);}catch{}}}
  await using(connect,async db=>{let began=false;try{await db.run('BEGIN IMMEDIATE');began=true;const at=now(),budget=await db.get('SELECT * FROM pokewallet_budget WHERE id=1'),hour=(await db.get('SELECT COUNT(*) AS n FROM pokewallet_request WHERE created_at>?',[at-HOUR])).n,day=(await db.get('SELECT COUNT(*) AS n FROM pokewallet_request WHERE created_at>?',[at-DAY])).n;if(budget?.paused_until>at||hour>=90||day>=900)throw fail('rate_limited');if(budget?.observed_at!=null){const since=(await db.get('SELECT COUNT(*) AS n FROM pokewallet_request WHERE created_at>?',[budget.observed_at])).n;if((at-budget.observed_at<HOUR&&budget.remaining_hour!=null&&budget.remaining_hour-since<=0)||(at-budget.observed_at<DAY&&budget.remaining_day!=null&&budget.remaining_day-since<=0))throw fail('rate_limited');}await db.run('INSERT INTO pokewallet_request(created_at) VALUES(?)',[at]);await db.run('COMMIT');began=false;}finally{if(began)await db.run('ROLLBACK').catch(()=>{});}});
  let response;try{response=await http.get('https://api.pokewallet.io'+endpoint,{params,headers:{'X-API-Key':key,Accept:binary?'image/jpeg,image/webp,image/png':'application/json','User-Agent':'Bindarr-artwork-repair'},timeout:8000,maxRedirects:0,maxContentLength:binary?MAX_BYTES:2*1024*1024,responseType:binary?'arraybuffer':'json',validateStatus:()=>true});}catch{throw fail('upstream');}
  if(response.status===429||response.status===503){const seconds=Number(response.headers?.['retry-after']);const delay=Number.isFinite(seconds)&&seconds>0?Math.min(seconds*1000,DAY):HOUR;await using(connect,db=>db.run('INSERT INTO pokewallet_budget(id,paused_until) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET paused_until=MAX(COALESCE(pokewallet_budget.paused_until,0),excluded.paused_until)',[now()+delay]));throw fail('rate_limited');}
  if(response.status!==200)throw fail(response.status===404?'not_found':response.status===401?'key_rejected':'upstream');
  const header=name=>{const value=response.headers?.[name];return value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value))?Number(value):null;};
  await using(connect,db=>db.run('INSERT INTO pokewallet_budget(id,remaining_hour,remaining_day,observed_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET remaining_hour=COALESCE(excluded.remaining_hour,pokewallet_budget.remaining_hour),remaining_day=COALESCE(excluded.remaining_day,pokewallet_budget.remaining_day),observed_at=excluded.observed_at',[header('x-ratelimit-remaining-hour'),header('x-ratelimit-remaining-day'),now()]));
  if(binary){const type=String(response.headers?.['content-type']||'').split(';')[0].trim().toLowerCase();if(!['image/jpeg','image/png','image/webp'].includes(type))throw fail('invalid_image');const bytes=Buffer.from(response.data);if(!bytes.length||bytes.length>MAX_BYTES)throw fail('invalid_image');return bytes;}
  if(!response.data||typeof response.data!=='object')throw fail('upstream');const body=JSON.stringify(response.data);if(body.includes(key)||Buffer.byteLength(body)>2*1024*1024)throw fail('upstream');await using(connect,db=>db.run('INSERT INTO pokewallet_cache(request,body,fetched_at) VALUES(?,?,?) ON CONFLICT(request) DO UPDATE SET body=excluded.body,fetched_at=excluded.fetched_at',[cacheKey,body,now()]));return response.data;
 }
 return {json(endpoint,params){if(!['/sets','/search'].includes(endpoint))throw fail('invalid_endpoint');return request(endpoint,params);},image(id){if(!match.isProviderCardId(id))throw fail('invalid_provider_id');return request('/images/'+encodeURIComponent(id),{size:'low'},true);}};
}
function chooseArtwork(card,sets,body){
 if(card.game!=='pokemon'||card.language!=='English'||!String(card.id).startsWith('tcgdex-en-'))throw fail('unsupported_language_or_game');
 const english=Array.isArray(sets?.data)?sets.data.filter(set=>['eng','en','english'].includes(String(set.language||'').toLowerCase())&&match.foldName(set.name)===match.foldName(card.set_name)):[];
 if(english.length!==1||!english[0].set_id)throw fail('set_unconfirmed');
 const rows=body?.results;if(!Array.isArray(rows)||!Number.isSafeInteger(body?.pagination?.total)||body.pagination.total!==rows.length)throw fail('search_incomplete');
 const inSet=rows.filter(row=>String(row?.card_info?.set_id||'')===String(english[0].set_id)).map(row=>({...row,card_info:{...row.card_info,set_name:english[0].name}}));
 const decision=match.matchSearchResults(card,inSet,inSet.length);if(decision.status!=='matched')throw fail(decision.status==='ambiguous'?'ambiguous':'not_found');
 const selected=decision.matches[0];if(!match.isProviderCardId(selected.id)||!Array.isArray(selected.images?.languages)||!selected.images.languages.includes('en'))throw fail('image_unavailable');
 return {provider:'pokewallet',providerId:selected.id,setId:String(english[0].set_id)};
}
async function findArtwork(card,client){const sets=await client.json('/sets');const body=await client.json('/search',{q:match.nameQuery(card),limit:100,page:1});return chooseArtwork(card,sets,body);}
async function saveMissingArtwork(cardArt,id,bytes){
 if(!cardArt.isValidId(id)||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_BYTES)throw fail('invalid_image');
 if(cardArt.resolve(id))return {saved:false,existing:true};
 const sharp=require('sharp'),image=sharp(bytes,{limitInputPixels:20000000,animated:false}),meta=await image.metadata();
 if(!['jpeg','png','webp'].includes(meta.format)||!meta.width||!meta.height||meta.width<64||meta.height<64||meta.width/meta.height<0.6||meta.width/meta.height>0.85)throw fail('invalid_image');
 const png=await image.rotate().resize({width:745,withoutEnlargement:true}).png().toBuffer();
 await fs.mkdir(cardArt.USER_DIR,{recursive:true});const temporary=path.join(cardArt.USER_DIR,'.repair-'+randomUUID()+'.tmp'),target=path.join(cardArt.USER_DIR,id+'.png');
 try{await fs.writeFile(temporary,png,{flag:'wx',mode:0o600});if(cardArt.resolve(id))return {saved:false,existing:true};try{await fs.link(temporary,target);}catch(error){if(error.code==='EEXIST')return {saved:false,existing:true};throw error;}cardArt.invalidate();return {saved:true,bytes:png.length};}finally{await fs.unlink(temporary).catch(()=>{});}
}
module.exports={createArtworkClient,chooseArtwork,findArtwork,saveMissingArtwork};
