'use strict';
const {LANGUAGES}=require('./languages');
const REGIONAL=new Set(['ja','ko','zh-tw','id','th','zh-cn']);
const codes=LANGUAGES.map(l=>l.code).sort((a,b)=>b.length-a.length);
function resolveLanguage(value){if(typeof value!=='string')return null;const key=value.trim().toLowerCase();return LANGUAGES.find(l=>[l.code,l.name,l.tcgdex,l.scryfall].some(alias=>typeof alias==='string'&&alias.toLowerCase()===key))||null;}
function splitId(id){if(typeof id!=='string'||!id.startsWith('tcgdex-'))return null;for(const code of codes){const prefix='tcgdex-'+code+'-';if(id.startsWith(prefix)&&id.length>prefix.length)return {code,providerId:id.slice(prefix.length)};}return null;}
function parse(row){if(!row)return null;const result={...row};for(const key of ['types','subtypes','color_identity'])if(typeof result[key]==='string')result[key]=JSON.parse(result[key]);result.image_url=typeof result.image_url==='string'?result.image_url.trim():'';result.artwork_status=result.image_url?'provider_reference_available':'missing_provider_reference';return result;}
function createLocalPokemonCards({connect}){
 async function read(work){const db=await connect();let began=false;try{await db.run('BEGIN');began=true;const result=await work(db);await db.run('COMMIT');began=false;return result;}catch(error){if(began)await db.run('ROLLBACK').catch(()=>{});throw error;}finally{await db.close();}}
 async function cached(db,id){if(typeof id!=='string'||!id||id.length>600||id.includes('\0'))return null;const row=await db.get("SELECT * FROM card_cache WHERE id=? AND game='pokemon'",[id]);if(!row)return null;if(id.startsWith('tcgdex-')){const identity=splitId(id);if(!identity||resolveLanguage(row.language)?.code!==identity.code)return null;}return parse(row);}
 return {
  getCardById(id){return read(db=>cached(db,id));},
  printingInLanguage(card,target){
   return read(async db=>{
    const identity=splitId(card?.id),want=resolveLanguage(target);
    if(!identity||!want||identity.code===want.code||REGIONAL.has(identity.code)||REGIONAL.has(want.code))return null;
    const source=await cached(db,card.id);if(!source)return null;
    if(!await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='pokemon_catalog_active'"))return null;
    const id='tcgdex-'+want.code+'-'+identity.providerId;
    const member=await db.get("SELECT cc.id FROM pokemon_catalog_card pc JOIN pokemon_catalog_active a ON a.snapshot_id=pc.snapshot_id JOIN card_cache cc ON cc.id=pc.id WHERE a.language=? AND cc.id=? AND cc.game='pokemon' AND cc.language=?",[want.code,id,want.name]);
    return member?cached(db,id):null;
   });
  }
 };
}
let instance;
function getLocalPokemonCards(){if(!instance)instance=createLocalPokemonCards({connect:()=>require('./salesRepository').openConnection(require('../db').dbPath)});return instance;}
module.exports={createLocalPokemonCards,getLocalPokemonCards};
