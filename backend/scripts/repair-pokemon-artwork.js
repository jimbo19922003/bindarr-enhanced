'use strict';
const path=require('node:path');
require('dotenv').config();require('dotenv').config({path:path.join(__dirname,'../.env')});
const args=process.argv.slice(2),apply=args[0]==='--apply',id=args[apply?1:0];
if(args.length!==(apply?2:1)||!/^tcgdex-en-[A-Za-z0-9._-]+$/.test(id||'')||id.includes('..')){console.error('Usage: node backend/scripts/repair-pokemon-artwork.js [--apply] tcgdex-en-CARD-ID');process.exit(1);}
const db=require('../src/db'),art=require('../src/cardArt'),{openConnection}=require('../src/utils/salesRepository');
const {createArtworkClient,findArtwork,saveMissingArtwork}=require('../src/utils/pokemonArtworkRepair');
const connect=()=>openConnection(db.dbPath);
const schema='CREATE TABLE IF NOT EXISTS pokemon_artwork_attempt(card_id TEXT PRIMARY KEY,status TEXT NOT NULL,provider TEXT,checked_at INTEGER NOT NULL,retry_at INTEGER NOT NULL)';
async function withDb(work){const connection=await connect();try{return await work(connection);}finally{await connection.close();}}
async function card(){return withDb(connection=>connection.get("SELECT cc.* FROM card_cache cc JOIN pokemon_catalog_card pc ON pc.id=cc.id JOIN pokemon_catalog_active a ON a.snapshot_id=pc.snapshot_id WHERE cc.id=? AND cc.game='pokemon' AND cc.language='English' AND a.language='en'",[id]));}
async function main(){
 console.log(JSON.stringify({database:db.dbPath,cardId:id,mode:apply?'apply':'preview'},null,2));
 const original=await card();if(!original)throw Object.assign(new Error(),{code:'not_in_active_snapshot'});
 if(art.resolve(id)){console.log('Artwork is already available locally; nothing replaced.');return;}
 if(String(original.image_url||'').trim())throw Object.assign(new Error(),{code:'provider_reference_present'});
 if(apply){await withDb(connection=>connection.exec(schema));const prior=await withDb(connection=>connection.get('SELECT * FROM pokemon_artwork_attempt WHERE card_id=?',[id]));if(prior&&prior.retry_at>Date.now()){console.log(JSON.stringify({status:prior.status,retryAt:new Date(prior.retry_at).toISOString()}));return;}}
 try{const client=createArtworkClient({connect}),candidate=await findArtwork(original,client);console.log(JSON.stringify({name:original.name,set:original.set_name,number:original.number,...candidate},null,2));if(!apply){console.log('Preview only: provider lookups can consume shared API allowance; no artwork or card records changed. Run with --apply to download and cache this printing.');return;}const bytes=await client.image(candidate.providerId),current=await card();if(!current||['name','set_id','number','language'].some(key=>current[key]!==original[key])||String(current.image_url||'').trim())throw Object.assign(new Error(),{code:'card_changed'});const result=await saveMissingArtwork(art,id,bytes);await withDb(connection=>connection.run('INSERT INTO pokemon_artwork_attempt VALUES(?,?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET status=excluded.status,provider=excluded.provider,checked_at=excluded.checked_at,retry_at=excluded.retry_at',[id,'available',candidate.provider,Date.now(),0]));console.log(JSON.stringify({status:'available',...result,url:'/api/card-art/'+encodeURIComponent(id)+'.png'},null,2));}
 catch(error){const known=new Set(['key_missing','key_rejected','rate_limited','not_found','set_unconfirmed','search_incomplete','ambiguous','image_unavailable','invalid_image','card_changed','upstream','unsupported_language_or_game']);const code=known.has(error.code)?error.code:'artwork_repair_failed';if(apply){const retry=Date.now()+(['key_missing','key_rejected','rate_limited','upstream','artwork_repair_failed'].includes(code)?60000:86400000);await withDb(connection=>connection.run('INSERT INTO pokemon_artwork_attempt VALUES(?,?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET status=excluded.status,provider=excluded.provider,checked_at=excluded.checked_at,retry_at=excluded.retry_at',[id,code,'pokewallet',Date.now(),retry]));}console.error('Artwork repair: '+code);process.exitCode=1;}
}
main().catch(()=>{console.error('Artwork repair could not read the active catalogue or write its local cache.');process.exitCode=1;}).finally(()=>new Promise(resolve=>db.dbConnection.close(()=>resolve())));
