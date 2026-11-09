'use strict';
const express=require('express');
const {forCopy}=require('../utils/completedRipBasis');
const router=express.Router();
const has=async(db,name)=>!!await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]);
async function inspect(db,user,openingId){
 const opening=await db.get('SELECT * FROM sealed_opening WHERE id=? AND user_id=?',[openingId,user]);
 if(!opening)throw Object.assign(new Error('Opening not found'),{status:404});
 if(await has(db,'opening_basis_snapshot')){const frozen=await db.get('SELECT snapshot_json FROM opening_basis_snapshot WHERE opening_id=? AND user_id=?',[openingId,user]);if(frozen)return {...JSON.parse(frozen.snapshot_json),status:'allocated',frozen:true};}
 const rows=await db.all('SELECT collection_id,filed_ids FROM sealed_pull WHERE opening_id=? AND user_id=? ORDER BY id',[openingId,user]);
 const ids=[...new Set(rows.flatMap(row=>String(row.filed_ids||'').split(',').map(Number).filter(id=>Number.isSafeInteger(id)&&id>0)))];
 if(opening.entry_complete!==1)return {status:'pending',reason:'Mark the rip Pull Complete before allocating its acquisition cost.'};
 for(const id of ids){const copy=await db.get('SELECT * FROM collection WHERE id=? AND user_id=?',[id,user]);if(copy){const result=await forCopy(db,user,copy,openingId);return result.snapshot?{...result.snapshot,status:'allocated',frozen:false}:{status:'pending',reason:result.reason};}}
 return {status:'pending',reason:'No verified filed collection copies were found. Review the rip-to-collection links.'};
}
async function read(req,res,byCopy){
 res.set('Cache-Control','private, no-store');
 if(!Number.isSafeInteger(req.user?.id)||req.user.id<1)return res.status(401).json({error:'Authentication required'});
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid record ID'});
 let db,began=false;
 try{
  db=await require('../utils/salesRepository').openConnection(require('../db').dbPath);await db.run('BEGIN');began=true;
  let openingId=id;
  if(byCopy){
   const copy=await db.get('SELECT id FROM collection WHERE id=? AND user_id=?',[id,req.user.id]);if(!copy)return res.status(404).json({error:'Collection copy not found'});
   const links=await db.all("SELECT opening_id FROM sealed_pull WHERE user_id=? AND (collection_id=? OR instr(','||replace(COALESCE(filed_ids,''),' ','')||',',','||?||',')>0)",[req.user.id,id,String(id)]);
   const openings=[...new Set(links.map(row=>row.opening_id))];
   if(!openings.length)return res.json({status:'not_opening'});
   if(openings.length!==1)return res.json({status:'pending',reason:'This copy has ambiguous rip links; reconciliation is required.'});
   openingId=openings[0];
  }
  let result;try{result=await inspect(db,req.user.id,openingId);}catch(error){if(error.status!==409)throw error;result={status:'pending',reason:error.message};}
  if(byCopy&&result.status==='allocated'){const cost=result.lines.flatMap(line=>line.copies).find(copy=>copy.collectionId===id);result=cost?{status:'allocated',currency:result.currency,openingId,allocatedCostCents:cost.costCents,frozen:result.frozen}:{status:'pending',reason:'The allocation does not contain this copy; review its rip link.'};}
  await db.run('COMMIT');began=false;return res.json(result);
 }catch(error){return res.status(error.status||503).json({error:error.status?error.message:'Opening allocation could not be read.'});}
 finally{if(db){if(began)await db.run('ROLLBACK').catch(()=>{});await db.close().catch(()=>{});}}
}
router.get('/sealed/openings/:id/allocation',(req,res)=>read(req,res,false));
router.get('/sealed/copies/:id/basis',(req,res)=>read(req,res,true));
module.exports=router;
module.exports.inspect=inspect;
