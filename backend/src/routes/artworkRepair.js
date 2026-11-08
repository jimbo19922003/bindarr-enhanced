'use strict';
const express=require('express');
function createArtworkRepairRouter({service,enabled=()=>process.env.POKEMON_LOCAL_CATALOG==='1'}){
 const router=express.Router();
 router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');if(req.user?.role!=='admin')return res.status(req.user?403:401).json({state:'not_authorized'});if(!enabled())return res.status(409).json({state:'disabled'});return next();});
 router.get('/:cardId',async(req,res)=>{try{return res.json(await service.status(req.params.cardId));}catch{return res.status(503).json({state:'unavailable',code:'ARTWORK_STATUS_UNAVAILABLE'});}});
 router.post('/:cardId',async(req,res)=>{if(req.body&&Object.keys(req.body).length)return res.status(400).json({state:'not_eligible',code:'NO_ARTWORK_INPUT_ACCEPTED'});try{const result=await service.start(req.params.cardId);if(result.state==='busy'){res.set('Retry-After','2');return res.status(429).json(result);}return res.status(result.state==='pending'?202:200).json(result);}catch{return res.status(503).json({state:'unavailable',code:'ARTWORK_REPAIR_UNAVAILABLE'});}});
 return router;
}
module.exports={createArtworkRepairRouter};
