'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),express=require('express');
const {openConnection}=require('../src/utils/salesRepository');
const {createPokemonLocalCatalog}=require('../src/utils/pokemonLocalCatalog');
const {createCompiledSnapshotLoader,writeBundleManifest}=require('../src/utils/pokemonCatalogBundle');
const {createPokemonBundleInstall}=require('../src/utils/pokemonBundleInstall');
const {createLocalCatalogInstallRouter}=require('../src/routes/localCatalogInstall');
async function fixture(t,{configured=true}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'catalog-install-http-')),directory=path.join(root,'bundle'),file=path.join(root,'db.sqlite'),commit='b'.repeat(40);
  await fs.mkdir(path.join(directory,'en'),{recursive:true});await fs.writeFile(file,'');
  await fs.writeFile(path.join(directory,'LICENSE'),'MIT License\nTCGdex\npermission notice\n');
  await fs.writeFile(path.join(directory,'en','sets.json'),JSON.stringify([{id:'sample',name:'Sample',serie:{id:'physical',name:'Physical'}}]));
  await fs.writeFile(path.join(directory,'en','cards.json'),JSON.stringify([{id:'sample-1',localId:'1',name:'Approved card',category:'Pokemon',set:{id:'sample'}}]));
  await writeBundleManifest({directory,commit,languages:['en']});
  let reads=0;const connect=()=>{reads++;return openConnection(file);};
  const db=await connect();try{await db.exec('CREATE TABLE card_cache(id TEXT PRIMARY KEY,name TEXT,printed_name TEXT,supertype TEXT,subtypes TEXT,types TEXT,rarity TEXT,set_id TEXT,set_name TEXT,number TEXT,image_url TEXT,game TEXT,language TEXT,available_printings TEXT,illustrator TEXT)');}finally{await db.close();}
  const store=createPokemonLocalCatalog({connect}),installer=createPokemonBundleInstall({store,loadSnapshot:createCompiledSnapshotLoader({directory})});
  const app=express();app.use((req,_res,next)=>{if(req.headers['x-test-role'])req.user={role:req.headers['x-test-role']};next();});
  app.use('/install',createLocalCatalogInstallRouter({connect,installer,bundleDirectory:()=>configured?directory:undefined}));
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await installer.waitForIdle();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  const request=(method='GET',suffix='',body,role='admin')=>new Promise((resolve,reject)=>{
    const headers=role?{'x-test-role':role}:{};if(body!==undefined)headers['Content-Type']='application/json';
    const req=http.request(`http://127.0.0.1:${server.address().port}/install${suffix}`,{method,headers},response=>{let text='';response.on('data',chunk=>{text+=chunk;});response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(text),headers:response.headers});}catch(error){reject(error);}});});
    req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  return {request,commit,directory,store,installer,reads:()=>reads};
}
test('every installer endpoint rejects missing and non-admin identities before database work',async t=>{
  const f=await fixture(t),before=f.reads();
  for(const [method,suffix,body] of [['GET','',undefined],['POST','/preview',{commit:f.commit}],['POST','/apply',{previewId:'invalid',confirmed:true}]]){
    assert.equal((await f.request(method,suffix,body,null)).status,401);
    assert.equal((await f.request(method,suffix,body,'member')).status,403);
  }
  assert.equal(f.reads(),before);
});
test('HTTP preview and confirmation install the reviewed bundle even if staged bytes subsequently change',async t=>{
  const f=await fixture(t);
  const invalid=await f.request('POST','/preview',{commit:f.commit,directory:'/unapproved'});assert.equal(invalid.status,400);
  const preview=await f.request('POST','/preview',{commit:f.commit,language:'en'});assert.equal(preview.status,200);assert.equal(preview.body.cardCount,1);assert.equal(await f.store.status('en'),null);
  assert.equal((await f.request('POST','/apply',{previewId:preview.body.previewId,confirmed:false})).status,400);
  await fs.writeFile(path.join(f.directory,'en','cards.json'),'[]');
  const applied=await f.request('POST','/apply',{previewId:preview.body.previewId,confirmed:true});assert.equal(applied.status,202);
  await f.installer.waitForIdle();const status=await f.request();assert.equal(status.body.job.phase,'done');assert.equal(status.headers['cache-control'],'private, no-store');
  assert.equal((await f.store.getCard('tcgdex-en-sample-1')).name,'Approved card');
  const broken=await f.request('POST','/preview',{commit:f.commit,language:'en'});assert.equal(broken.status,422);assert.equal(broken.body.code,'CATALOG_BUNDLE_INVALID');
  assert.equal((await f.store.status('en')).source_commit,f.commit);
});
test('an unconfigured server reports unavailable rather than starting an installation',async t=>{
  const f=await fixture(t,{configured:false}),before=f.reads();assert.equal((await f.request()).body.configured,false);
  const result=await f.request('POST','/preview',{commit:f.commit});assert.equal(result.status,503);assert.equal(result.body.code,'CATALOG_BUNDLE_NOT_CONFIGURED');assert.equal(f.reads(),before);assert.equal(f.installer.status().job,null);
});
