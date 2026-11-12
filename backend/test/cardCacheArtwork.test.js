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
 await db.exec('ALTER TABLE card_cache ADD COLUMN price_as_of TEXT');
 const asOf='2026-11-09T00:00:00Z';
 await db.run("UPDATE card_cache SET price_trend=42,price_holofoil=42,price_currency='USD',price_source='tcgcsv',price_as_of=? WHERE id=?",[asOf,base.id]);
 await cacheNormalizedCards([{...base,price_trend:999,price_holofoil:999,price_currency:'EUR',price_source:'tcgdex'}],'pokemon');
 const saved=await db.get('SELECT price_trend,price_holofoil,price_currency,price_source,price_as_of FROM card_cache WHERE id=?',[base.id]);
 assert.deepEqual(saved,{price_trend:'42',price_holofoil:'42',price_currency:'USD',price_source:'tcgcsv',price_as_of:asOf});
});

test('illustrator is captured, preserved across briefs without one, and replaced by a new value',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'illustrator-cache-test-')),filename=path.join(root,'test.db');await fs.writeFile(filename,'');
 const db=await openConnection(filename);t.after(async()=>{await db.close();await fs.rm(root,{recursive:true,force:true});});
 const module={exports:{}};
 vm.runInNewContext(await fs.readFile(path.join(__dirname,'../src/utils/cardCache.js'),'utf8'),{module,exports:module.exports,require:name=>{if(name!=='../db')throw new Error('Unexpected dependency');return db;}});
 const {cacheNormalizedCards,CARD_CACHE_COLUMNS}=module.exports;
 await db.exec('CREATE TABLE card_cache ('+CARD_CACHE_COLUMNS.map(name=>name==='id'?'id TEXT PRIMARY KEY':name+' TEXT').join(',')+',price_1st_edition REAL,last_updated TEXT)');
 const base={id:'tcgdex-en-base1-58',name:'Pikachu',set_id:'base1',number:'58',language:'English'};
 const read=async()=>(await db.get('SELECT illustrator FROM card_cache WHERE id=?',[base.id])).illustrator;
 await cacheNormalizedCards([{...base,illustrator:'  Mitsuhiro Arita  '}],'pokemon');
 assert.equal(await read(),'Mitsuhiro Arita');
 for(const illustrator of [null,undefined,'','  ']){
  await cacheNormalizedCards([{...base,illustrator}],'pokemon');
  assert.equal(await read(),'Mitsuhiro Arita');
 }
 await cacheNormalizedCards([{...base,illustrator:['Ann','Bo']}],'mtg');
 assert.equal(await read(),'Ann, Bo');
});

test('set briefs preserve full card rarity, metadata, prices and freshness', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rarity-cache-test-'));
 const filename = path.join(root, 'test.db');
 await fs.writeFile(filename, '');
 const db = await openConnection(filename);
 t.after(async () => { await db.close(); await fs.rm(root, {recursive: true, force: true}); });
 const module = {exports: {}};
 vm.runInNewContext(await fs.readFile(path.join(__dirname, '../src/utils/cardCache.js'), 'utf8'), {
  module, exports: module.exports, require: name => {
   if (name !== '../db') throw new Error('Unexpected dependency');
   return db;
  },
 });
 const {cacheNormalizedCards, CARD_CACHE_COLUMNS} = module.exports;
 await db.exec('CREATE TABLE card_cache (' + CARD_CACHE_COLUMNS.map(name =>
  name === 'id' ? 'id TEXT PRIMARY KEY' : name + ' TEXT'
 ).join(',') + ',price_1st_edition REAL,last_updated TEXT)');
 const full = {
  id: 'tcgdex-en-30th-037', name: 'Pikachu', printed_name: 'Pikachu',
  set_id: '30th', set_name: '30th Celebration', number: '037', language: 'English',
  rarity: 'Pikachu Rare', supertype: 'Pokémon', subtypes: ['Basic'], types: ['Lightning'],
  available_printings: ['Holofoil'], illustrator: 'Test artist',
  price_trend: 12, price_holofoil: 12, price_currency: 'USD', price_source: 'tcgdex',
 };
 await cacheNormalizedCards([full], 'pokemon');
 await db.run("UPDATE card_cache SET last_updated = '2026-11-01 12:00:00' WHERE id = ?", [full.id]);
 const before = await db.get('SELECT * FROM card_cache WHERE id = ?', [full.id]);
 const brief = {
  id: full.id, name: full.name, printed_name: full.name, set_id: full.set_id,
  set_name: 'Updated set name', number: full.number, language: full.language,
  image_url: 'https://assets.tcgdex.net/en/test/037/low.png',
  rarity: 'Common', supertype: '', subtypes: [], types: [],
  price_trend: 0, price_currency: 'EUR', price_source: 'tcgdex',
 };
 await cacheNormalizedCards([brief], 'pokemon', {incomplete: true});
 const after = await db.get('SELECT * FROM card_cache WHERE id = ?', [full.id]);
 assert.deepEqual(after, {...before, set_name: brief.set_name, image_url: brief.image_url});

 await cacheNormalizedCards([{...full, rarity: 'Rare'}], 'pokemon');
 assert.equal((await db.get('SELECT rarity FROM card_cache WHERE id = ?', [full.id])).rarity, 'Rare',
  'a full response can still correct a previously known rarity');
});

test('new brief cards stay incomplete until a full response restores their metadata', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'brief-cache-test-'));
 const filename = path.join(root, 'test.db');
 await fs.writeFile(filename, '');
 const db = await openConnection(filename);
 t.after(async () => { await db.close(); await fs.rm(root, {recursive: true, force: true}); });
 const module = {exports: {}};
 vm.runInNewContext(await fs.readFile(path.join(__dirname, '../src/utils/cardCache.js'), 'utf8'), {
  module, exports: module.exports, require: name => {
   if (name !== '../db') throw new Error('Unexpected dependency');
   return db;
  },
 });
 const {cacheNormalizedCards, CARD_CACHE_COLUMNS} = module.exports;
 await db.exec('CREATE TABLE card_cache (' + CARD_CACHE_COLUMNS.map(name =>
  name === 'id' ? 'id TEXT PRIMARY KEY' : name + ' TEXT'
 ).join(',') + ',price_1st_edition REAL,last_updated TEXT)');
 const brief = {id: 'tcgdex-en-30th-037', name: 'Pikachu', set_id: '30th', number: '037'};
 await cacheNormalizedCards([brief], 'pokemon', {incomplete: true});
 await cacheNormalizedCards([brief], 'pokemon', {incomplete: true});
 const read = () => db.get('SELECT rarity, supertype, last_updated FROM card_cache WHERE id = ?', [brief.id]);
 assert.deepEqual(await read(), {rarity: 'Common', supertype: '', last_updated: '1970-01-01 00:00:00'});
 await cacheNormalizedCards([{...brief, rarity: 'Pikachu Rare', supertype: 'Pokémon'}], 'pokemon');
 const restored = await read();
 assert.equal(restored.rarity, 'Pikachu Rare');
 assert.equal(restored.supertype, 'Pokémon');
 assert.notEqual(restored.last_updated, '1970-01-01 00:00:00');
});
