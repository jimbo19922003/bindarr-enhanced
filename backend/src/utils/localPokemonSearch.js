'use strict';
const {LANGUAGES}=require('./languages');
const {numberKey}=require('./pokemonLocalCatalog');
const {collectionQuery,nameClause}=require('./cardSearchSql');
const {parseSetList}=require('./setQuery');
const invalid=()=>Object.assign(new TypeError('Invalid local catalog query'),{code:'INVALID_LOCAL_CATALOG_QUERY'});
function languageOf(value){if(value==null||value==='')return LANGUAGES.find(l=>l.code==='en');if(typeof value!=='string')throw invalid();const key=value.trim().toLowerCase(),row=LANGUAGES.find(l=>[l.code,l.name,l.tcgdex,l.scryfall].some(alias=>typeof alias==='string'&&alias.toLowerCase()===key));if(!row)throw invalid();return row;}
function cardRow(row){const card={...row};for(const key of ['types','subtypes','color_identity'])if(typeof card[key]==='string')card[key]=JSON.parse(card[key]);card.image_url=typeof card.image_url==='string'?card.image_url.trim():'';card.artwork_status=card.image_url?'provider_reference_available':'missing_provider_reference';return card;}
function createLocalPokemonSearch({connect}){
 return {localOnly:true,async searchCards({name='',number='',set='',scope='database',userId=null,lang='en',page=1,limit=60}={}){
  if(!['database','internet','collection'].includes(scope)||[name,number,set].some(value=>typeof value!=='string'||value.length>200)||!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(limit)||limit<1||limit>250||!Number.isSafeInteger((page-1)*limit))throw invalid();
  const setList=parseSetList(set),offset=(page-1)*limit;
  let db,began=false;
  try{
   db=await connect();await db.run('BEGIN');began=true;
   let result;
   if(scope==='collection'){
    if(!Number.isSafeInteger(Number(userId))||Number(userId)<1)result={cards:[],total:0};
    else {const query=collectionQuery('pokemon',{userId,name,number,setList,limit,offset});result={cards:(await db.all(query.sql,query.params)).map(cardRow),total:null};}
   }else{
    const language=languageOf(lang),installed=await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='pokemon_catalog_active'");
    const active=installed?await db.get('SELECT snapshot_id FROM pokemon_catalog_active WHERE language=?',[language.code]):null;
    if(!active)throw Object.assign(new Error('UPSTREAM_UNAVAILABLE'),{code:'LOCAL_CATALOG_SYNC_REQUIRED',language:language.code});
    const clauses=['pc.snapshot_id=?',"cc.game='pokemon'",'cc.language=?'],params=[active.snapshot_id,language.name],byName=nameClause('cc.',name);
    if(byName){clauses.push(byName.clause);params.push(...byName.params);}
    if(number){clauses.push('pc.number_key=?');params.push(numberKey(number.replace(/^#/,'').split('/')[0]));}
    if(setList.length){clauses.push('LOWER(pc.set_id) IN ('+setList.map(()=>'?').join(',')+')');params.push(...setList.map(value=>value.toLowerCase()));}
    const from='FROM pokemon_catalog_card pc JOIN card_cache cc ON cc.id=pc.id WHERE '+clauses.join(' AND ');
    const total=(await db.get('SELECT COUNT(*) AS n '+from,params)).n;
    result={cards:(await db.all('SELECT cc.* '+from+' ORDER BY pc.id LIMIT ? OFFSET ?',[...params,limit,offset])).map(cardRow),total};
   }
   await db.run('COMMIT');began=false;return result;
  }catch(error){if(began)await db.run('ROLLBACK').catch(()=>{});throw error;}finally{if(db)await db.close();}
 }};
}
let instance;
function getLocalPokemonSearch(){if(!instance)instance=createLocalPokemonSearch({connect:()=>require('./salesRepository').openConnection(require('../db').dbPath)});return instance;}
module.exports={createLocalPokemonSearch,getLocalPokemonSearch};
