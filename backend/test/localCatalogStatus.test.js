'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),express=require('express');
const {openConnection}=require('../src/utils/salesRepository');
const {createPokemonLocalCatalog}=require('../src/utils/pokemonLocalCatalog');
const {createLocalCatalogStatusRouter}=require('../src/routes/localCatalogStatus');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'catalog-status-')),file=path.join(root,'db.sqlite');await fs.writeFile(file,'');let reads=0,fail=false;const artIds=new Set();const connect=()=>{reads++;return openConnection(file);};const db=await connect();try{await db.exec('CREATE TABLE card_cache(id TEXT PRIMARY KEY,name TEXT,printed_name TEXT,supertype TEXT,subtypes TEXT,types TEXT,rarity TEXT,set_id TEXT,set_name TEXT,number TEXT,image_url TEXT,game TEXT,language TEXT,available_printings TEXT,illustrator TEXT);CREATE TABLE app_settings(id INTEGER PRIMARY KEY,pokemon_local_catalog_enabled INTEGER NOT NULL DEFAULT 0);INSERT INTO app_settings(id,pokemon_local_catalog_enabled) VALUES(1,0)');}finally{await db.close();}const app=express();app.use((req,_res,next)=>{if(req.headers['x-test-role'])req.user={role:req.headers['x-test-role']};next();});const modeEnabled=async()=>{const check=await connect();try{return (await check.get('SELECT pokemon_local_catalog_enabled FROM app_settings WHERE id=1')).pokemon_local_catalog_enabled===1;}finally{await check.close();}};app.use('/status',createLocalCatalogStatusRouter({connect:()=>{if(fail)throw new Error('test unavailable');return connect();},modeEnabled,art:{listIds:()=>[...artIds]}}));const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});const request=(method,path,body,role='admin')=>new Promise((resolve,reject)=>{const payload=body==null?'':JSON.stringify(body);const req=http.request(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{...(role?{'x-test-role':role}:{}),...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{})}},response=>{let text='';response.on('data',chunk=>{text+=chunk;});response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(text),headers:response.headers});}catch(error){reject(error);}});});req.on('error',reject);req.end(payload);});const get=(query='',role='admin')=>request('GET',`/status${query}`,null,role);return {get,request,artIds,reads:()=>reads,fail:()=>{fail=true;},store:createPokemonLocalCatalog({connect})};}
function snapshot(){return {commit:'a'.repeat(40),language:'en',sets:[{id:'base1',name:'Base Set',serie:{id:'base',name:'Base'},cardCount:{official:102}}],cards:[{id:'base1-1',localId:'1',name:'One',category:'Pokemon',set:{id:'base1'},image:'https://assets.tcgdex.net/en/base/base1/1'},{id:'base1-2',localId:'2',name:'Two',category:'Pokemon',set:{id:'base1'}}]};}
test('status rejects unauthenticated and non-admin callers before reading the database',async t=>{const f=await fixture(t),before=f.reads();assert.equal((await f.get('',null)).status,401);assert.equal((await f.get('','member')).status,403);assert.equal(f.reads(),before);});
test('an uninstalled snapshot is not presented as complete or zero-byte image caching',async t=>{const f=await fixture(t),result=await f.get();assert.equal(result.status,200);assert.equal(result.body.snapshot,null);assert.equal(result.body.summary,null);assert.equal(result.body.artwork.bytesCached,null);assert.equal(result.body.scanner.readiness,'not_verified');assert.equal(result.body.localModeEnabled,false);});
test('installed status counts metadata and missing artwork references separately',async t=>{const f=await fixture(t);await f.store.importSnapshot(snapshot());const result=await f.get('?lang=English');assert.equal(result.status,200);assert.equal(result.headers['cache-control'],'private, no-store');assert.equal(result.body.summary.metadataCards,2);assert.equal(result.body.summary.cachedRows,2);assert.equal(result.body.summary.artworkReferences,1);assert.equal(result.body.summary.missingReferences,1);assert.equal(result.body.summary.missingCacheRows,0);assert.equal(result.body.sets[0].printedTotal,102);assert.equal(result.body.availableLanguages[0].code,'en');assert.equal(result.body.artwork.downloadsVerified,false);});
test('invalid language inputs are rejected rather than silently using English',async t=>{const f=await fixture(t);assert.equal((await f.get('?lang=unknown')).status,400);assert.equal((await f.get('?lang=en&lang=ja')).status,400);});
test('local catalogue mode is an admin-updated runtime setting',async t=>{const f=await fixture(t);assert.equal((await f.get()).body.localModeEnabled,false);assert.equal((await f.request('PUT','/status/mode',{enabled:true})).status,200);assert.equal((await f.get()).body.localModeEnabled,true);assert.equal((await f.request('PUT','/status/mode',{enabled:'yes'})).status,400);assert.equal((await f.request('PUT','/status/mode',{enabled:false},'member')).status,403);});
test('database failures do not turn into success-looking empty status',async t=>{const f=await fixture(t);f.fail();assert.equal((await f.get()).status,503);});
test('coverage and review exclude local artwork without double counting provider references',async t=>{
 const f=await fixture(t), input=snapshot();
 input.cards.push({id:'base1-3',localId:'3',name:'Three',category:'Pokemon',set:{id:'base1'}});
 await f.store.importSnapshot(input);
 f.artIds.add('tcgdex-en-base1-1');
 f.artIds.add('tcgdex-en-base1-2');
 const status=await f.get('?lang=en');
 assert.equal(status.body.summary.artworkReferences,1);
 assert.equal(status.body.summary.localArtworkWithoutReference,1);
 assert.equal(status.body.summary.missingArtwork,1);
 assert.equal(status.body.sets[0].missingArtwork,1);
 const response=await f.request('GET','/status/missing-artwork?lang=en&set=base1');
 assert.equal(response.status,200);
 assert.equal(response.body.total,1);
 assert.deepEqual(response.body.cards.map(card=>card.id),['tcgdex-en-base1-3']);
 assert.equal((await f.request('GET','/status/missing-artwork?lang=en&set=base1',null,'member')).status,403);
 assert.equal((await f.request('GET','/status/missing-artwork?lang=en&set=base1&page=0')).status,400);
 assert.equal((await f.request('GET','/status/missing-artwork?lang=ja&set=base1')).body.total,0);
 f.artIds.add('tcgdex-en-base1-3');
 assert.equal((await f.get('?lang=en')).body.summary.missingArtwork,0);
 assert.equal((await f.request('GET','/status/missing-artwork?lang=en&set=base1')).body.total,0);
});
test('missing artwork review paginates without hiding cards',async t=>{
 const f=await fixture(t),input=snapshot();
 input.cards=Array.from({length:51},(_,index)=>({id:`base1-${index+1}`,localId:String(index+1),name:`Card ${index+1}`,category:'Pokemon',set:{id:'base1'}}));
 await f.store.importSnapshot(input);
 const first=(await f.request('GET','/status/missing-artwork?lang=en&set=base1&page=1')).body;
 const second=(await f.request('GET','/status/missing-artwork?lang=en&set=base1&page=2')).body;
 assert.equal(first.total,51);assert.equal(first.cards.length,50);assert.equal(second.cards.length,1);
 assert.equal(new Set([...first.cards,...second.cards].map(card=>card.id)).size,51);
});
