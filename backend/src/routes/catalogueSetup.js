'use strict';
const express=require('express');
const {randomUUID}=require('node:crypto');
const {LANGUAGES}=require('../utils/languages');
const {normalize,createPokemonLocalCatalog}=require('../utils/pokemonLocalCatalog');
const {createRepositoryCatalogueSource}=require('../utils/repositoryCatalogueSource');
const healthy=row=>!!row&&Number.isSafeInteger(row.card_count)&&row.card_count>0&&row.usable!==false;
function createCatalogueSetup({store,source}){
 let task=null,job=null;
 const status=()=>({running:!!task,job:job?JSON.parse(JSON.stringify(job)):null});
 return {status,
  async options(){const rows=[];for(const language of LANGUAGES)rows.push({code:language.code,name:language.name,record:await store.status(language.code)});let available=null;try{available=await source.discover();}catch{}return {...status(),localModeEnabled:process.env.POKEMON_LOCAL_CATALOG==='1',sourceAvailable:!!available,languages:rows.map(row=>({code:row.code,name:row.name,installed:healthy(row.record),needsRepair:!!row.record&&!healthy(row.record),available:!!available?.languages.includes(row.code)}))};},
  start(body){
   if(!body||Array.isArray(body)||Object.keys(body).some(key=>!['languages','confirmed'].includes(key))||body.confirmed!==true||!Array.isArray(body.languages)||!body.languages.length||body.languages.length>5||new Set(body.languages).size!==body.languages.length||body.languages.some(code=>!LANGUAGES.some(row=>row.code===code)))throw Object.assign(new Error('Confirm one to five supported, unique catalogue languages.'),{status:400});
   if(task)throw Object.assign(new Error('A catalogue installation is already running.'),{status:409});
   job={id:randomUUID(),phase:'running',languages:body.languages.map(code=>({code,state:'queued'}))};
   task=Promise.resolve().then(async()=>{let info=null;for(const item of job.languages){try{item.state='checking';const previous=await store.status(item.code);if(healthy(previous)){item.state='reused';continue;}if(previous)throw new Error('Existing catalogue requires reviewed repair');if(!info)info=await source.discover();if(!info.languages.includes(item.code))throw new Error('Language is absent from the published source');item.state='downloading';const snapshot=await source.load(info,item.code);if(snapshot.commit!==info.commit||snapshot.language!==item.code)throw new Error('Snapshot identity differs');normalize(snapshot);const current=await store.status(item.code);if(healthy(current)){item.state='reused';continue;}if(current)throw new Error('Existing catalogue requires reviewed repair');item.state='importing';await store.importSnapshot(snapshot);if(!healthy(await store.status(item.code)))throw new Error('Installed catalogue failed verification');item.state='installed';}catch(error){item.state='failed';item.errorCode=/^CATALOG_[A-Z_]+$/.test(error.code||'')?error.code:'CATALOG_INSTALL_FAILED';item.message='Installation could not finish for this language. Existing catalogue data was not replaced.';}}job.phase=job.languages.every(item=>['installed','reused'].includes(item.state))?'done':job.languages.some(item=>['installed','reused'].includes(item.state))?'partial':'failed';}).finally(()=>{task=null;});return status();
  },
  async waitForIdle(){if(task)await task;return status();}
 };
}
function createRouter({connect,service}){
 if(!service){const base=createPokemonLocalCatalog({connect});const store={importSnapshot:base.importSnapshot,async status(code){const row=await base.status(code);if(!row)return null;const db=await connect();try{const count=await db.get('SELECT COUNT(*) AS n,SUM(CASE WHEN cc.id IS NULL THEN 1 ELSE 0 END) AS missing FROM pokemon_catalog_card pc LEFT JOIN card_cache cc ON cc.id=pc.id WHERE pc.snapshot_id=?',[row.id]);return {...row,usable:count.n===row.card_count&&Number(count.missing||0)===0};}finally{await db.close();}}};service=createCatalogueSetup({store,source:createRepositoryCatalogueSource()});}
 const router=express.Router();router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');return req.user?.role==='admin'?next():res.status(req.user?403:401).json({error:'Administrator access required'});});router.use(express.json({limit:'8kb'}));
 router.get('/',async(_req,res)=>{try{return res.json(await service.options());}catch{return res.status(503).json({error:'Catalogue status could not be read.'});}});
 router.get('/job',(_req,res)=>res.json(service.status()));
 router.post('/',(req,res)=>{try{return res.status(202).json(service.start(req.body));}catch(error){return res.status(error.status||503).json({error:error.status?error.message:'Catalogue installation could not start.'});}});
 return router;
}
module.exports={createCatalogueSetup,createRouter};
