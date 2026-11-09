'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {artworkRepairEnabled}=require('../src/routes/artworkRepair');
const {createArtworkRepairService}=require('../src/utils/artworkRepairService');
const {createCatalogueSetup}=require('../src/routes/catalogueSetup');

test('artwork defaults on independently of local-search mode and has an explicit opt-out',()=>{
 assert.equal(artworkRepairEnabled({}),true);
 assert.equal(artworkRepairEnabled({POKEMON_LOCAL_CATALOG:'0'}),true);
 assert.equal(artworkRepairEnabled({POKEMON_LOCAL_CATALOG:'1',POKEMON_ARTWORK_REPAIR:'0'}),false);
});

test('an eligible cached card can reach artwork providers without an active catalogue snapshot',async()=>{
 const id='tcgdex-en-demo-1',lookups=[];
 const card={id,name:'Example',number:'1',set_id:'demo',language:'English',game:'pokemon',image_url:''};
 const connect=async()=>({exec:async()=>{},close:async()=>{},run:async()=>{},get:async(sql)=>{if(sql.startsWith('SELECT cc.*')){assert.equal(sql.includes('pokemon_catalog_'),false);return card;}return undefined;}});
 const provider=name=>({lookup:async()=>{lookups.push(name);throw Object.assign(new Error(),{code:'not_found'});},image:async()=>{throw new Error('No unmatched image may be fetched');}});
 const service=createArtworkRepairService({connect,art:{isValidId:()=>true,resolve:()=>null,invalidate:()=>{}},providers:{carddex:provider('carddex'),pokewallet:provider('pokewallet')},logger:()=>{}});
 assert.equal((await service.start(id)).state,'pending');
 await service.waitForIdle();
 assert.deepEqual(lookups,['carddex','pokewallet']);
});

test('catalogue discovery reports a safe source-level reason rather than leaking exceptions',async()=>{
 const service=createCatalogueSetup({store:{status:async()=>null},source:{discover:async()=>{throw Object.assign(new Error('private-fixture'),{code:'CATALOG_RELEASE_MISSING'});}}});
 const value=await service.options();
 assert.equal(value.sourceAvailable,false);
 assert.equal(value.sourceErrorCode,'CATALOG_RELEASE_MISSING');
 assert.equal(JSON.stringify(value).includes('private-fixture'),false);
});

test('unknown source errors are reduced to an allowlisted public code',async()=>{
 const service=createCatalogueSetup({store:{status:async()=>null},source:{discover:async()=>{throw Object.assign(new Error('private-fixture'),{code:'SECRET_fixture'});}}});
 assert.equal((await service.options()).sourceErrorCode,'CATALOG_SOURCE_UNAVAILABLE');
});
