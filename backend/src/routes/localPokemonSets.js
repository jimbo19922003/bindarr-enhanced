'use strict';
const {LANGUAGES}=require('../utils/languages');
function resolveLanguage(value){if(value==null||value==='')return 'en';if(typeof value!=='string')return null;const key=value.trim().toLowerCase();return LANGUAGES.find(row=>[row.code,row.name,row.tcgdex,row.scryfall].some(alias=>typeof alias==='string'&&alias.toLowerCase()===key))?.code||null;}
function createLocalPokemonSetsHandler({connect,enabled=require('../utils/pokemonLocalMode').isPokemonLocalModeEnabled}){
 return async function localPokemonSets(req,res,next){
  let localMode;
  try{localMode=await enabled();}catch(error){console.error('Pokémon catalogue mode lookup failed:',error.message);return res.status(503).json({error:'Pokémon catalogue mode is unavailable',code:'LOCAL_CATALOG_MODE_UNAVAILABLE'});}
  if(!localMode||req.query.game!=='pokemon')return next();
  res.set('Cache-Control','private, no-store');
  const language=resolveLanguage(req.query.lang);
  if(!language)return res.status(400).json({error:'Unsupported catalog language',code:'INVALID_CATALOG_LANGUAGE'});
  let db,began=false;
  try{
   db=await connect();await db.run('BEGIN');began=true;
   const installed=await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='pokemon_catalog_active'");
   const active=installed?await db.get('SELECT snapshot_id FROM pokemon_catalog_active WHERE language=?',[language]):null;
   if(!active){await db.run('COMMIT');began=false;return next();}
   const rows=await db.all('SELECT s.id,s.payload_json,COUNT(c.id) AS total FROM pokemon_catalog_set s LEFT JOIN pokemon_catalog_card c ON c.snapshot_id=s.snapshot_id AND c.set_id=s.id WHERE s.snapshot_id=? GROUP BY s.id,s.payload_json',[active.snapshot_id]);
   const sets=rows.map(row=>({...JSON.parse(row.payload_json),total:row.total,ptcgo_code:'',symbol_url:'',logo_url:'',game:'pokemon'}));
   sets.sort((a,b)=>String(a.release_date||'').localeCompare(String(b.release_date||''))||a.id.localeCompare(b.id));
   await db.run('COMMIT');began=false;res.set('X-Pokemon-Catalog-Source','local');return res.json(sets);
  }catch(error){if(began)await db.run('ROLLBACK').catch(()=>{});console.error('Local Pokemon set listing failed:',error.message);return res.status(503).json({error:'Local Pokemon catalog is unavailable',code:'LOCAL_CATALOG_UNAVAILABLE',language});}
  finally{if(db)await db.close().catch(()=>{});}
 };
}
module.exports={createLocalPokemonSetsHandler,resolveLanguage};
