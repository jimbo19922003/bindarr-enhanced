'use strict';
const express=require('express');
const {createArtworkRetry}=require('../utils/artworkRetry');
function artworkRepairEnabled(env=process.env){return env.POKEMON_ARTWORK_REPAIR!=='0';}
function createArtworkRepairRouter({service,enabled=artworkRepairEnabled,logger=entry=>console.info('[artwork-repair-route] '+JSON.stringify(entry)),retryController}){
 const router=express.Router(),audit=entry=>{try{logger(entry);}catch{}};
 const recovery=retryController||createArtworkRetry({service});
 const cardId=req=>/^tcgdex-en-[A-Za-z0-9._-]{1,110}$/.test(req.params.cardId||'')&&!req.params.cardId.includes('..')?req.params.cardId:'invalid';
 const unexpected=req=>req.body&&Object.keys(req.body).length;
 const send=(res,result)=>{if(result.state==='busy'){res.set('Retry-After',result.reason==='manual_retry_limit'?'60':'2');return res.status(429).json(result);}return res.status(result.state==='pending'?202:200).json(result);};
 audit({event:'ready',enabled:!!enabled(),adminOnly:true});
 router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');if(req.user?.role!=='admin'){audit({event:'blocked',reason:'not_authorized'});return res.status(req.user?403:401).json({state:'not_authorized',reason:'not_authorized'});}if(!enabled()){audit({event:'blocked',reason:'disabled'});return res.status(409).json({state:'disabled',reason:'disabled'});}return next();});
 router.get('/',async(_req,res)=>{try{return res.json(await recovery.failures());}catch{return res.status(503).json({state:'unavailable',reason:'status_unavailable',code:'ARTWORK_STATUS_UNAVAILABLE'});}});
 router.post('/:cardId/retry',async(req,res)=>{if(unexpected(req))return res.status(400).json({state:'not_eligible',reason:'unexpected_input',code:'NO_ARTWORK_INPUT_ACCEPTED'});try{audit({event:'manual_retry_requested',cardId:cardId(req)});return send(res,await recovery.retry(req.params.cardId));}catch{audit({event:'retry_failed',cardId:cardId(req)});return res.status(503).json({state:'unavailable',reason:'start_unavailable',code:'ARTWORK_REPAIR_UNAVAILABLE'});}});
 router.get('/:cardId',async(req,res)=>{try{return res.json(await service.status(req.params.cardId));}catch{audit({event:'status_failed',cardId:cardId(req)});return res.status(503).json({state:'unavailable',reason:'status_unavailable',code:'ARTWORK_STATUS_UNAVAILABLE'});}});
 router.post('/:cardId',async(req,res)=>{if(unexpected(req)){audit({event:'blocked',reason:'unexpected_input',cardId:cardId(req)});return res.status(400).json({state:'not_eligible',reason:'unexpected_input',code:'NO_ARTWORK_INPUT_ACCEPTED'});}try{return send(res,await service.start(req.params.cardId));}catch{audit({event:'start_failed',cardId:cardId(req)});return res.status(503).json({state:'unavailable',reason:'start_unavailable',code:'ARTWORK_REPAIR_UNAVAILABLE'});}});
 return router;
}
module.exports={createArtworkRepairRouter,artworkRepairEnabled};
