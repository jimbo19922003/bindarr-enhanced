'use strict';
const express=require('express');
function createProviderKeysRouter({connect,environmentKey=()=>process.env.POKEWALLET_API_KEY}){
 const router=express.Router();
 router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');return req.user?.role==='admin'?next():res.status(req.user?403:401).json({error:'Administrator access required'});});
 router.use(express.json({limit:'2kb'}));
 const describe=row=>{const saved=typeof row.pokewallet_api_key==='string'&&!!row.pokewallet_api_key.trim(),environment=!!String(environmentKey()||'').trim();return {configured:saved||environment,savedKeyPresent:saved,keySource:saved?'database':environment?'environment':'none'};};
 router.get('/pokewallet',async(_req,res)=>{let db;try{db=await connect();const row=await db.get('SELECT pokewallet_api_key FROM app_settings WHERE id=1');if(!row)throw new Error('missing settings');return res.json(describe(row));}catch{return res.status(503).json({error:'Provider key storage is unavailable',code:'PROVIDER_KEY_STORE_UNAVAILABLE'});}finally{if(db)await db.close().catch(()=>{});}});
 router.put('/pokewallet',async(req,res)=>{
  const body=req.body;if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(key=>key!=='key')||typeof body.key!=='string'||!body.key.trim()||body.key.trim().length>256||/\s/.test(body.key.trim()))return res.status(400).json({error:'Enter a nonempty PokéWallet key containing no whitespace, at most 256 characters',code:'INVALID_PROVIDER_KEY'});
  const key=body.key.trim();let db,began=false;
  try{db=await connect();await db.run('BEGIN IMMEDIATE');began=true;const changed=await db.run('UPDATE app_settings SET pokewallet_api_key=? WHERE id=1',[key]);if(changed.changes!==1)throw new Error('missing settings');const row=await db.get('SELECT pokewallet_api_key FROM app_settings WHERE id=1');if(row?.pokewallet_api_key!==key)throw new Error('verification failed');const result=describe(row);await db.run('COMMIT');began=false;return res.json({saved:true,...result});}
  catch{if(began)await db.run('ROLLBACK').catch(()=>{});return res.status(503).json({error:'Could not persist and verify the provider key',code:'PROVIDER_KEY_STORE_UNAVAILABLE'});}
  finally{if(db)await db.close().catch(()=>{});}
 });
 return router;
}
module.exports={createProviderKeysRouter};
