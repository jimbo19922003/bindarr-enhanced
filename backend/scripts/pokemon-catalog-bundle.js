'use strict';
const {createCompiledSnapshotLoader,writeBundleManifest}=require('../src/utils/pokemonCatalogBundle');
const {normalize,createPokemonLocalCatalog}=require('../src/utils/pokemonLocalCatalog');
async function main(){
 const [command,directory,commit,language,...flags]=process.argv.slice(2);
 if(!['manifest','verify','import'].includes(command)||!directory||!commit||!language||flags.some(f=>f!=='--apply')||new Set(flags).size!==flags.length||(command!=='import'&&flags.length))throw new Error('Usage: node backend/scripts/pokemon-catalog-bundle.js manifest <generated-dir> <commit> <en,ja,...> | verify <bundle-dir> <commit> <language> | import <bundle-dir> <commit> <language> [--apply]');
 if(command==='manifest'){const result=await writeBundleManifest({directory,commit,languages:language.split(',')});console.log(JSON.stringify({state:'manifest-written',commit:result.commit,languages:Object.keys(result.languages)}));return;}
 const snapshot=await createCompiledSnapshotLoader({directory})({commit,language}),normalized=normalize(snapshot);
 if(command==='verify'||!flags.includes('--apply')){console.log(JSON.stringify({state:command==='verify'?'verified':'dry-run',commit,language,physicalCards:normalized.cards.length,physicalSets:normalized.sets.length,withArtwork:normalized.cards.filter(c=>c.image_url).length,databaseChanged:false}));return;}
 require('dotenv').config();
 const db=require('../src/db'),{openConnection}=require('../src/utils/salesRepository');
 const result=await createPokemonLocalCatalog({connect:()=>openConnection(db.dbPath)}).importSnapshot(snapshot);
 console.log(JSON.stringify({state:'imported',...result}));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
