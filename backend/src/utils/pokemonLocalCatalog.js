'use strict';
const {createHash}=require('node:crypto');
const {LANGUAGES}=require('./languages');
const {tcgdexPrintings}=require('./cardPrintings');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(v,label)=>{if(typeof v!=='string'||!v.trim()||v.length>500||v.includes('\0'))throw new TypeError('Invalid '+label);return v.trim();};
const language=code=>{const row=LANGUAGES.find(l=>l.code===code);if(!row)throw new TypeError('Unsupported catalog language');return row;};
const numberKey=value=>{const s=String(value).trim().toLowerCase();return /^\d+$/.test(s)?s.replace(/^0+(?=\d)/,''):s;};
const metadata=['id','name','printed_name','supertype','subtypes','types','rarity','set_id','set_name','number','image_url','game','language','available_printings'];
const schema=`CREATE TABLE IF NOT EXISTS pokemon_catalog_snapshot(id INTEGER PRIMARY KEY AUTOINCREMENT,language TEXT NOT NULL,source_commit TEXT NOT NULL,content_hash TEXT NOT NULL,scan_hash TEXT NOT NULL,card_count INTEGER NOT NULL,set_count INTEGER NOT NULL,imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS pokemon_catalog_active(language TEXT PRIMARY KEY,snapshot_id INTEGER NOT NULL REFERENCES pokemon_catalog_snapshot(id),scan_refresh_required INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pokemon_catalog_set(snapshot_id INTEGER NOT NULL REFERENCES pokemon_catalog_snapshot(id),id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(snapshot_id,id));
CREATE TABLE IF NOT EXISTS pokemon_catalog_card(snapshot_id INTEGER NOT NULL REFERENCES pokemon_catalog_snapshot(id),id TEXT NOT NULL REFERENCES card_cache(id),set_id TEXT NOT NULL,name TEXT NOT NULL,number_key TEXT NOT NULL,PRIMARY KEY(snapshot_id,id));
CREATE INDEX IF NOT EXISTS pokemon_catalog_card_lookup ON pokemon_catalog_card(snapshot_id,set_id,number_key);`;
function normalize(input){
 const lang=language(input.language);
 if(!/^[a-f0-9]{40}$/.test(input.commit||''))throw new TypeError('A pinned upstream commit SHA is required');
 if(!Array.isArray(input.sets)||!input.sets.length||!Array.isArray(input.cards)||!input.cards.length)throw new TypeError('Refusing an empty catalog snapshot');
 const seenSets=new Set(),digital=new Set(),sets=[];
 for(const raw of input.sets){const id=text(raw.id,'set ID');if(seenSets.has(id))throw new TypeError('Duplicate set ID');seenSets.add(id);if(raw.serie?.id==='tcgp'){digital.add(id);continue;}sets.push({id,name:text(raw.name,'localized set name'),series:raw.serie?.name||'',release_date:raw.releaseDate||'',printed_total:Number.isSafeInteger(raw.cardCount?.official)&&raw.cardCount.official>=0?raw.cardCount.official:null});}
 const bySet=new Map(sets.map(s=>[s.id,s])),seen=new Set(),cards=[];
 for(const raw of input.cards){const providerId=text(raw.id,'provider card ID'),setId=text(raw.set?.id,'card set ID');if(digital.has(setId))continue;if(!bySet.has(setId))throw new TypeError('Card refers to an absent set');const id=`tcgdex-${lang.code}-${providerId}`;if(seen.has(id))throw new TypeError('Duplicate card ID');seen.add(id);if(raw.localId==null||String(raw.localId).trim()==='')throw new TypeError('Missing printed collector number');let image='';if(raw.image){const u=new URL(raw.image);if(u.protocol!=='https:'||u.hostname!=='assets.tcgdex.net'||u.username||u.password||u.port||u.search||u.hash)throw new TypeError('Untrusted catalog image reference');image=raw.image.replace(/\/$/,'')+'/low.png';}
  const name=text(raw.name,'localized card name');cards.push({id,name,printed_name:name,supertype:({Pokemon:'Pokémon',Trainer:'Trainer',Energy:'Energy'})[raw.category]||raw.category||'',subtypes:raw.stage?[String(raw.stage).replace(/(Stage)(\d)/,'$1 $2')]:[],types:Array.isArray(raw.types)?raw.types:[],rarity:raw.rarity||'',set_id:setId,set_name:bySet.get(setId).name,number:String(raw.localId),image_url:image,game:'pokemon',language:lang.name,available_printings:tcgdexPrintings(raw.variants)});
 }
 if(!sets.length||!cards.length)throw new TypeError('No physical Pokémon records in snapshot');
 sets.sort((a,b)=>a.id.localeCompare(b.id));cards.sort((a,b)=>a.id.localeCompare(b.id));
 const identityCards=cards.map(({available_printings,...card})=>card);
 return {language:lang.code,commit:input.commit,sets,cards,contentHash:hash({sets,cards:identityCards}),scanHash:hash(cards.map(c=>[c.id,c.image_url]))};
}
const parse=row=>{if(!row)return null;const out={...row};for(const k of ['subtypes','types','color_identity'])if(typeof out[k]==='string')out[k]=JSON.parse(out[k]);return out;};
async function upsertCard(db,card){
 const updates=metadata.filter(k=>k!=='id').map(k=>k==='name'?"name=CASE WHEN excluded.name=excluded.printed_name AND card_cache.name<>card_cache.printed_name THEN card_cache.name ELSE excluded.name END":k==='image_url'?"image_url=CASE WHEN excluded.image_url='' THEN card_cache.image_url ELSE excluded.image_url END":k==='available_printings'?'available_printings=COALESCE(excluded.available_printings,card_cache.available_printings)':`${k}=excluded.${k}`).join(',');
 const sql=`INSERT INTO card_cache(${metadata.join(',')}) VALUES(${metadata.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${updates}`;
 const prior=await db.get('SELECT game,language FROM card_cache WHERE id=?',[card.id]);
 if(prior&&(prior.game!=='pokemon'||prior.language!==card.language))throw new Error('Existing card identity conflicts with imported language or game');
 await db.run(sql,metadata.map(k=>Array.isArray(card[k])?JSON.stringify(card[k]):card[k]));
}
function createPokemonLocalCatalog({connect}){
 async function transaction(write,work){const db=await connect();let began=false;try{await db.run(write?'BEGIN IMMEDIATE':'BEGIN');began=true;const result=await work(db);await db.run('COMMIT');began=false;return result;}catch(e){if(began)await db.run('ROLLBACK').catch(()=>{});throw e;}finally{await db.close();}}
 const exists=async db=>!!await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='pokemon_catalog_active'");
 return {
  importSnapshot(input){const data=normalize(input);return transaction(true,async db=>{
   await db.exec(schema);const previous=await db.get('SELECT s.*,a.scan_refresh_required FROM pokemon_catalog_active a JOIN pokemon_catalog_snapshot s ON s.id=a.snapshot_id WHERE a.language=?',[data.language]);
   if(previous?.source_commit===data.commit){if(previous.content_hash!==data.contentHash)throw new Error('Same upstream commit produced different normalized content');for(const card of data.cards)if(card.available_printings)await db.run('UPDATE card_cache SET available_printings=? WHERE id=?',[JSON.stringify(card.available_printings),card.id]);return {...previous,unchanged:true};}
   const inserted=await db.run('INSERT INTO pokemon_catalog_snapshot(language,source_commit,content_hash,scan_hash,card_count,set_count) VALUES(?,?,?,?,?,?)',[data.language,data.commit,data.contentHash,data.scanHash,data.cards.length,data.sets.length]);
   const id=inserted.lastID;
   for(const set of data.sets)await db.run('INSERT INTO pokemon_catalog_set VALUES(?,?,?)',[id,set.id,JSON.stringify(set)]);
   for(const card of data.cards){await upsertCard(db,card);await db.run('INSERT INTO pokemon_catalog_card VALUES(?,?,?,?,?)',[id,card.id,card.set_id,card.name,numberKey(card.number)]);}
   const dirty=!previous||previous.scan_hash!==data.scanHash||previous.scan_refresh_required?1:0;
   await db.run('INSERT INTO pokemon_catalog_active VALUES(?,?,?) ON CONFLICT(language) DO UPDATE SET snapshot_id=excluded.snapshot_id,scan_refresh_required=excluded.scan_refresh_required',[data.language,id,dirty]);
   return {id,language:data.language,source_commit:data.commit,card_count:data.cards.length,set_count:data.sets.length,scan_refresh_required:dirty,unchanged:false};
  });},
  mergeSet(input,onProgress=()=>{}){const data=normalize(input);if(data.sets.length!==1)throw new TypeError('A set sync must contain exactly one set');return transaction(true,async db=>{
   await db.exec(schema);
   const previous=await db.get('SELECT s.*,a.scan_refresh_required FROM pokemon_catalog_active a JOIN pokemon_catalog_snapshot s ON s.id=a.snapshot_id WHERE a.language=?',[data.language]);
   const setId=data.sets[0].id;
   const sourceCommit=createHash('sha1').update(`${previous?.source_commit||'empty'}:${setId}:${data.contentHash}`).digest('hex');
   const contentHash=hash({previous:previous?.content_hash||'',setId,content:data.contentHash});
   const scanHash=hash({previous:previous?.scan_hash||'',setId,scan:data.scanHash});
   const inserted=await db.run('INSERT INTO pokemon_catalog_snapshot(language,source_commit,content_hash,scan_hash,card_count,set_count) VALUES(?,?,?,?,0,0)',[data.language,`tcgdex-set-sync:${sourceCommit}`,contentHash,scanHash]);
   const id=inserted.lastID;
   if(previous){
    await db.run('INSERT INTO pokemon_catalog_set SELECT ?,id,payload_json FROM pokemon_catalog_set WHERE snapshot_id=? AND id<>?',[id,previous.id,setId]);
    await db.run('INSERT INTO pokemon_catalog_card SELECT ?,id,set_id,name,number_key FROM pokemon_catalog_card WHERE snapshot_id=? AND set_id<>?',[id,previous.id,setId]);
   }
   for(const set of data.sets)await db.run('INSERT INTO pokemon_catalog_set VALUES(?,?,?)',[id,set.id,JSON.stringify(set)]);
   onProgress({phase:'saving',done:0,total:data.cards.length});
   for(let index=0;index<data.cards.length;index++){
    const card=data.cards[index];
    await upsertCard(db,card);
    await db.run('INSERT INTO pokemon_catalog_card VALUES(?,?,?,?,?)',[id,card.id,card.set_id,card.name,numberKey(card.number)]);
    if((index+1)%50===0||index+1===data.cards.length)onProgress({phase:'saving',done:index+1,total:data.cards.length});
   }
   const counts=await db.get('SELECT COUNT(*) AS cards,COUNT(DISTINCT set_id) AS sets FROM pokemon_catalog_card WHERE snapshot_id=?',[id]);
   await db.run('UPDATE pokemon_catalog_snapshot SET card_count=?,set_count=? WHERE id=?',[counts.cards,counts.sets,id]);
   await db.run('INSERT INTO pokemon_catalog_active VALUES(?,?,1) ON CONFLICT(language) DO UPDATE SET snapshot_id=excluded.snapshot_id,scan_refresh_required=1',[data.language,id]);
   return {id,language:data.language,source_commit:`tcgdex-set-sync:${sourceCommit}`,card_count:counts.cards,set_count:counts.sets,scan_refresh_required:1,unchanged:false};
  });},
  status(code){language(code);return transaction(false,async db=>await exists(db)?await db.get('SELECT s.*,a.scan_refresh_required FROM pokemon_catalog_active a JOIN pokemon_catalog_snapshot s ON s.id=a.snapshot_id WHERE a.language=?',[code])||null:null);},
  getCard(id){return transaction(false,async db=>parse(await db.get("SELECT * FROM card_cache WHERE id=? AND game='pokemon'",[id])));},
  listSets(code){language(code);return transaction(false,async db=>{if(!await exists(db))return [];return (await db.all('SELECT s.payload_json FROM pokemon_catalog_set s JOIN pokemon_catalog_active a ON a.snapshot_id=s.snapshot_id WHERE a.language=? ORDER BY s.id',[code])).map(r=>JSON.parse(r.payload_json));});},
  search({language:code,name='',set='',number='',page=1,limit=60}){language(code);if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger((page-1)*limit))throw new TypeError('Invalid catalog page');if([name,set,number].some(v=>typeof v!=='string'||v.length>200))throw new TypeError('Invalid search filter');return transaction(false,async db=>{if(!await exists(db))return {cards:[],total:0};const clauses=['a.language=?'],params=[code];if(name){clauses.push('instr(lower(c.name),lower(?))>0');params.push(name);}if(set){clauses.push('c.set_id=?');params.push(set);}if(number){clauses.push('c.number_key=?');params.push(numberKey(number));}const from=`FROM pokemon_catalog_card c JOIN pokemon_catalog_active a ON a.snapshot_id=c.snapshot_id JOIN card_cache cc ON cc.id=c.id WHERE ${clauses.join(' AND ')}`;const total=(await db.get(`SELECT COUNT(*) AS n ${from}`,params)).n;const cards=(await db.all(`SELECT cc.* ${from} ORDER BY c.id LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit])).map(parse);return {cards,total};});}
 };
}
module.exports={createPokemonLocalCatalog,normalize,numberKey};
