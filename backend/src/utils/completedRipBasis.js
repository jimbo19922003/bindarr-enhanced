// rip-unit-allocation-v1
const {openingLineValue}=require('./openingWeights');
'use strict';
const {allocateOpeningCost}=require('./costBasis');
const fail=message=>Object.assign(new Error(message),{status:409});
const has=async(db,name)=>!!await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]);
const valid=n=>Number.isSafeInteger(n)&&n>=0;
async function forCopy(db,user,copy,openingId) {
 const links=await db.all("SELECT opening_id FROM sealed_pull WHERE user_id=? AND (collection_id=? OR instr(','||replace(COALESCE(filed_ids,''),' ','')||',',','||?||',')>0)",[user,copy.id,String(copy.id)]);
 if(new Set(links.map(r=>r.opening_id)).size!==1)throw fail('Copy has ambiguous opening links; acquisition reconciliation is required');
 const opening=await db.get('SELECT * FROM sealed_opening WHERE id=? AND user_id=?',[openingId,user]);
 if(!opening)return {reason:'The linked opening is unavailable'};
 if(opening.entry_complete!==1)return {reason:'The opening is not marked Pull Complete'};
 if(opening.currency!=='USD')return {reason:'Historical non-USD opening basis requires an explicit conversion policy'};
 if(!valid(opening.cost_cents))throw fail('Invalid opening cost');
 const pulls=(await db.all('SELECT * FROM sealed_pull WHERE opening_id=? AND user_id=? ORDER BY id',[openingId,user])).map(row=>({...row,opened_line_cents:openingLineValue(row)}));
 if(!pulls.length)return {reason:'The opening has no recorded contents'};
 const sole=pulls.length===1;
 if(!sole&&pulls.some(row=>!valid(row.opened_line_cents)))return {reason:'Some opening-time values are missing; multi-pull allocation is pending'};
 const allocation=allocateOpeningCost(opening.cost_cents,pulls.map(row=>({id:String(row.id),openingValueCents:sole?1:row.opened_line_cents})),{complete:true});
 if(allocation.status!=='allocated')return {reason:'Multi-pull opening values do not support an allocation'};
 const costs=new Map(allocation.allocations.map(r=>[r.id,r.costCents])),seen=new Set(),lines=[];
 for(const row of pulls){
  if(!Number.isSafeInteger(row.quantity)||row.quantity<1||row.quantity>10000)throw fail('Invalid pull quantity');
  const raw=String(row.filed_ids||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(raw.some(id=>!/^[1-9][0-9]*$/.test(id)||!Number.isSafeInteger(Number(id))))throw fail('Invalid filed-copy identity');
  const ids=raw.map(Number);
  if(!ids.length&&row.collection_id!=null)return {reason:'A manually linked copy needs acquisition-source verification'};
  if(ids.length&&(ids.length!==row.quantity||!row.card_id||(row.collection_id!=null&&!ids.includes(row.collection_id))))throw fail('Pull quantity or identity differs from its filed copies');
  for(const id of ids){
   if(seen.has(id))throw fail('Copy linked more than once');seen.add(id);
   const owned=await db.get('SELECT * FROM collection WHERE id=? AND user_id=?',[id,user]);
   if(!owned||owned.list_type!=='collection'||owned.quantity!==1||owned.card_id!==row.card_id)throw fail('A filed opening copy changed or is no longer owned');
   if(await has(db,'card_acquisition_lot')&&await db.get('SELECT id FROM card_acquisition_lot WHERE collection_id=?',[id]))throw fail('Opening already has acquisition lots requiring reconciliation');
   if(await has(db,'opening_basis_copy')&&await db.get('SELECT collection_id FROM opening_basis_copy WHERE collection_id=?',[id]))throw fail('Copy already has finalized opening basis');
  }
  const costCents=costs.get(String(row.id));
  const splits=ids.length?allocateOpeningCost(costCents,ids.map(id=>({id:String(id),openingValueCents:1})),{complete:true}).allocations:[];
  lines.push({pullId:row.id,cardId:row.card_id||null,quantity:row.quantity,openingValueCents:valid(row.opened_line_cents)?row.opened_line_cents:null,costCents,copies:splits.map(s=>({collectionId:Number(s.id),costCents:s.costCents})),unlinkedBasisCents:ids.length?0:costCents});
 }
 const selected=lines.flatMap(line=>line.copies).find(c=>c.collectionId===copy.id);
 if(!selected)return {reason:'The card is not linked to a verified filed copy in this opening'};
 return {basisCents:selected.costCents,snapshot:{status:'finalized',version:1,method:sole?'sole-pull-cost':'relative-opening-line-value',openingId,currency:'USD',totalCostCents:opening.cost_cents,lines}};
}
// Caller owns the sale's BEGIN IMMEDIATE transaction and has rechecked the preview.
async function freeze(db,user,snapshot) {
 const {schema}=require('./openingBasisRepository');await db.exec(schema);
 const prior=await db.get('SELECT snapshot_json FROM opening_basis_snapshot WHERE opening_id=? AND user_id=?',[snapshot.openingId,user]);
 if(prior){if(prior.snapshot_json!==JSON.stringify(snapshot))throw fail('Opening basis changed; review the sale again');return;}
 await db.run('INSERT INTO opening_basis_snapshot (opening_id,user_id,snapshot_json) VALUES (?,?,?)',[snapshot.openingId,user,JSON.stringify(snapshot)]);
 for(const line of snapshot.lines)for(const copy of line.copies)await db.run('INSERT INTO opening_basis_copy (collection_id,opening_id,pull_id,cost_cents) VALUES (?,?,?,?)',[copy.collectionId,snapshot.openingId,line.pullId,copy.costCents]);
}
module.exports={forCopy,freeze};
