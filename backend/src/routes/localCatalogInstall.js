'use strict';
const express=require('express');
const {createPokemonBundleInstall}=require('../utils/pokemonBundleInstall');
const {createPokemonLocalCatalog}=require('../utils/pokemonLocalCatalog');
const {createCompiledSnapshotLoader}=require('../utils/pokemonCatalogBundle');
function createLocalCatalogInstallRouter({connect,installer,bundleDirectory=()=>process.env.POKEMON_CATALOG_BUNDLE_DIR}) {
  const service=installer||createPokemonBundleInstall({store:createPokemonLocalCatalog({connect}),loadSnapshot:parameters=>createCompiledSnapshotLoader({directory:bundleDirectory()})(parameters)});
  const router=express.Router();
  router.use((req,res,next)=>req.user?.role==='admin'?next():res.status(req.user?403:401).json({error:'Administrator access required'}));
  router.use(express.json({limit:'8kb'}));
  router.get('/',(_req,res)=>{res.set('Cache-Control','private, no-store');res.json({configured:!!bundleDirectory(),...service.status()});});
  router.post('/preview',async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    if(!bundleDirectory())return res.status(503).json({error:'The operator must configure POKEMON_CATALOG_BUNDLE_DIR and stage a trusted bundle first',code:'CATALOG_BUNDLE_NOT_CONFIGURED'});
    try{return res.json(await service.preview(req.body));}catch(error){return res.status(error.status||500).json({error:error.status?error.message:'Catalogue preview failed',code:error.code||'CATALOG_PREVIEW_FAILED'});}
  });
  router.post('/apply',(req,res)=>{
    res.set('Cache-Control','private, no-store');
    try{return res.status(202).json(service.apply(req.body));}catch(error){return res.status(error.status||500).json({error:error.status?error.message:'Catalogue import could not start',code:error.code||'CATALOG_IMPORT_FAILED'});}
  });
  return router;
}
module.exports={createLocalCatalogInstallRouter};
