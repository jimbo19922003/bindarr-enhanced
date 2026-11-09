'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {openConnection}=require('../src/utils/salesRepository');

test('partial lookup refreshes preserve artwork while explicit new artwork replaces it',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'art-cache-test-')),filename=path.join(root,'test.db');await fs.writeFile(filename,'');
 const db=await openConnection(filename);t.after(async()=>{await db.close();await fs.rm(root,{recursive:true,force:true});});
 const module={exports:{}};
 vm.runInNewContext(await fs.readFile(path.join(__dirname,'../src/utils/cardCache.js'),'utf8'),{module,exports:module.exports,require:name=>{if(name!=='../db')throw new Error('Unexpected dependency');return db;}});
 const {cacheNormalizedCards,CARD_CACHE_COLUMNS}=module.exports;
 await db.exec('CREATE TABLE card_cache ('+CARD_CACHE_COLUMNS.map(name=>name==='id'?'id TEXT PRIMARY KEY':name+' TEXT').join(',')+',price_1st_edition REAL,last_updated TEXT)');
 const base={id:'tcgdex-en-base1-4',name:'Charmander',set_id:'base1',number:'4',language:'English',image_url:'https://assets.tcgdex.net/en/base/base1/4/low.png'};
 await cacheNormalizedCards([base],'pokemon');
 for(const image_url of ['',null,undefined,'   ']){
  await cacheNormalizedCards([{...base,image_url}],'pokemon');
  assert.equal((await db.get('SELECT image_url FROM card_cache WHERE id=?',[base.id])).image_url,base.image_url);
 }
 const replacement='https://assets.tcgdex.net/en/base/base1/4/high.png';
 await cacheNormalizedCards([{...base,image_url:replacement}],'pokemon');
 assert.equal((await db.get('SELECT image_url FROM card_cache WHERE id=?',[base.id])).image_url,replacement);
 await cacheNormalizedCards([{...base,id:'tcgdex-en-base1-5',image_url:''}],'pokemon');
 assert.equal((await db.get('SELECT image_url FROM card_cache WHERE id=?',['tcgdex-en-base1-5'])).image_url,'');
});
