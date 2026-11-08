'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),{join}=require('node:path'),{tmpdir}=require('node:os');
const {createCompiledSnapshotLoader}=require('../src/utils/pokemonCatalogBundle');
const {normalize,createPokemonLocalCatalog}=require('../src/utils/pokemonLocalCatalog');
const {openConnection}=require('../src/utils/salesRepository');
async function main(){
 const [directory,commit,list,...extra]=process.argv.slice(2);if(!directory||!commit||!list||extra.length)throw new Error('Usage: node validate-pokemon-bundle.js <bundle-dir> <commit> <languages>');
 const languages=list.split(',');if(new Set(languages).size!==languages.length)throw new Error('Duplicate validation language');
 const temporary=await fs.mkdtemp(join(tmpdir(),'catalog-validation-')),file=join(temporary,'catalog.db'),reports=[];
 try{
  await fs.writeFile(file,'');const connect=()=>openConnection(file),db=await connect();
  try{await db.exec(`CREATE TABLE card_cache(id TEXT PRIMARY KEY,name TEXT,printed_name TEXT,supertype TEXT,subtypes TEXT,types TEXT,rarity TEXT,set_id TEXT,set_name TEXT,number TEXT,image_url TEXT,game TEXT,language TEXT,price_trend REAL,price_1st_edition REAL,price_source TEXT,price_currency TEXT,last_updated TEXT);CREATE TABLE collection(id INTEGER PRIMARY KEY,card_id TEXT REFERENCES card_cache(id));`);}finally{await db.close();}
  const store=createPokemonLocalCatalog({connect}),load=createCompiledSnapshotLoader({directory});
  for(const language of languages){
   const snapshot=await load({commit,language}),data=normalize(snapshot),sample=data.cards[0],seed=await connect();
   try{await seed.run('INSERT INTO card_cache(id,name,printed_name,game,language,price_trend,price_1st_edition,price_source,price_currency,last_updated) VALUES(?,?,?,?,?,?,?,?,?,?)',[sample.id,'Existing','Existing','pokemon',sample.language,123.45,678.9,'pokewallet-validation','USD','preserve-price-timestamp']);await seed.run('INSERT INTO collection(card_id) VALUES(?)',[sample.id]);}finally{await seed.close();}
   const imported=await store.importSnapshot(snapshot),result=await store.search({language,limit:1}),card=await store.getCard(sample.id);
   assert.equal(imported.card_count,data.cards.length);assert.equal(result.total,data.cards.length);assert.equal(card.id,sample.id);assert.equal(card.price_trend,123.45);assert.equal(card.price_1st_edition,678.9);assert.equal(card.last_updated,'preserve-price-timestamp');assert.equal((await store.importSnapshot(snapshot)).unchanged,true);
   const check=await connect();try{assert.equal((await check.get('SELECT COUNT(*) AS n FROM collection WHERE card_id=?',[sample.id])).n,1);}finally{await check.close();}
   reports.push({language,physicalCards:imported.card_count,physicalSets:imported.set_count,withArtwork:data.cards.filter(c=>c.image_url).length,scannerIdPreserved:true,priceColumnsPreserved:true,collectionReferencePreserved:true,repeatImportUnchanged:true});
  }
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
 console.log(JSON.stringify({upstreamCommit:commit,temporaryDatabaseOnly:true,languages:reports},null,2));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
