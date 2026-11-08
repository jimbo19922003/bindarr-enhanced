// contextual-sales-v1
'use strict';
const {createHash}=require('node:crypto');
const {calculateSale}=require('./costBasis');
const cards=require('./salesRepository'), sealed=require('./sealedSalesRepository');
const opening=require('./salesOpeningIntegration'), protection=require('./salesInventoryProtection');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const has=async(db,name)=>!!await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]);
const registry=`CREATE TABLE IF NOT EXISTS sales_entry(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,payload_json TEXT NOT NULL,response_json TEXT NOT NULL,kind TEXT NOT NULL,sold_on TEXT NOT NULL,currency TEXT NOT NULL,gain_cents INTEGER,UNIQUE(user_id,request_key))`;
function input(body) {
 const v={kind:body.kind,id:body.id,quantity:body.quantity,proceedsCents:body.proceedsCents,feesCents:body.feesCents??0,currency:body.currency,soldOn:body.soldOn};
 if(!['card','sealed'].includes(v.kind)||![v.id,v.quantity].every(n=>Number.isSafeInteger(n)&&n>0)||![v.proceedsCents,v.feesCents].every(n=>Number.isSafeInteger(n)&&n>=0))throw fail(400,'Select an item and valid quantity, proceeds and fees');
 if(!['USD','EUR','GBP','CAD','AUD','JPY'].includes(v.currency))throw fail(400,'Unsupported currency');
 if(typeof v.soldOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.soldOn)||!Number.isFinite(Date.parse(v.soldOn))||new Date(v.soldOn).toISOString().slice(0,10)!==v.soldOn)throw fail(400,'Invalid sale date');
 if(v.kind==='card'&&(v.quantity!==1||v.currency!=='USD'))throw fail(400,'Select one physical card copy; card sales currently use USD');
 return v;
}
async function state(db,user,v) {
 if(v.kind==='sealed') {
  const lot=await db.get('SELECT l.*,p.name FROM sealed_lot l JOIN sealed_product p ON p.id=l.product_id AND p.user_id=l.user_id WHERE l.id=? AND l.user_id=? AND l.archived_at IS NULL AND p.archived_at IS NULL',[v.id,user]);
  if(!lot)throw fail(404,'Active owned sealed lot not found');
  if(lot.currency!==v.currency)throw fail(400,'Use the purchase lot currency for proceeds and fees');
  if(v.quantity>lot.remaining_quantity)throw fail(409,'Not enough sealed units remain');
  return {name:lot.name,source:'sealed',remainingQuantity:lot.remaining_quantity,remainingBasisCents:lot.remaining_cost_cents,productId:lot.product_id};
 }
 const copy=await db.get("SELECT c.*,cc.name FROM collection c JOIN card_cache cc ON cc.id=c.card_id WHERE c.id=? AND c.user_id=? AND c.list_type='collection'",[v.id,user]);
 if(!copy)throw fail(404,'Owned card copy not found');
 if(copy.quantity!==1)throw fail(409,'This entry must be split into physical copies before selling');
 let lot=null,mapping=null;
 if(await has(db,'card_acquisition_lot'))lot=await db.get('SELECT * FROM card_acquisition_lot WHERE collection_id=? AND user_id=?',[v.id,user]);
 if(await has(db,'opening_basis_copy'))mapping=await db.get('SELECT b.cost_cents,s.snapshot_json FROM opening_basis_copy b JOIN opening_basis_snapshot s ON s.opening_id=b.opening_id WHERE b.collection_id=? AND s.user_id=?',[v.id,user]);
 if(mapping) {const snap=JSON.parse(mapping.snapshot_json);if(!snap.lines.some(line=>line.cardId===copy.card_id&&line.copies.some(c=>c.collectionId===v.id&&c.costCents===mapping.cost_cents)))throw fail(409,'Opening copy identity needs reconciliation');}
 if(lot) {
  if(lot.remaining_quantity!==1)throw fail(409,'Acquisition lot inventory differs from the copy');
  if(mapping&&(lot.source!=='opening'||lot.original_basis_cents!==mapping.cost_cents))throw fail(409,'Conflicting acquisition basis');
  return {name:copy.name,cardId:copy.card_id,source:lot.source,remainingQuantity:1,remainingBasisCents:lot.remaining_basis_cents};
 }
 if(mapping)return {name:copy.name,cardId:copy.card_id,source:'opening',remainingQuantity:1,remainingBasisCents:mapping.cost_cents};
 const pull=await db.get("SELECT id FROM sealed_pull WHERE user_id=? AND (collection_id=? OR instr(','||replace(COALESCE(filed_ids,''),' ','')||',',','||?||',')>0) LIMIT 1",[user,v.id,String(v.id)]);
 const basis=!pull&&typeof copy.purchase_price==='number'&&Number.isFinite(copy.purchase_price)&&copy.purchase_price>0?Math.round(copy.purchase_price*100):null;
 return {name:copy.name,cardId:copy.card_id,source:basis==null?'unknown':'direct',remainingQuantity:1,remainingBasisCents:basis};
}
function review(user,v,s) {
 const amounts=calculateSale({...v,remainingQuantity:s.remainingQuantity,remainingBasisCents:s.remainingBasisCents});
 const token=createHash('sha256').update(JSON.stringify({user,v,s})).digest('hex');
 return {...amounts,itemName:s.name,source:s.source,currency:v.currency,previewToken:token};
}
function createSalesApplication({connect}) {
 async function read(user,work) {
  if(!Number.isSafeInteger(user)||user<1)throw fail(401,'Authentication required');
  const db=await connect();let began=false;try{await db.run('BEGIN');began=true;const result=await work(db);await db.run('COMMIT');began=false;return result;}catch(e){if(began)await db.run('ROLLBACK').catch(()=>{});throw e;}finally{await db.close();}
 }
 return {
  items(user,{kind='card',q=''}={}) {
   if(!['card','sealed'].includes(kind))throw fail(400,'Choose card or sealed');
   const term='%'+String(q).slice(0,100)+'%';
   return read(user,async db=>{
    if(kind==='card'){const rows=await db.all("SELECT c.*,cc.name FROM collection c JOIN card_cache cc ON cc.id=c.card_id WHERE c.user_id=? AND c.list_type='collection' AND c.quantity=1 AND cc.name LIKE ? ORDER BY cc.name,c.id LIMIT 50",[user,term]);return rows.map(r=>({id:r.id,label:[r.name,`copy #${r.id}`,r.condition,r.printing,r.grader&&r.grade?`${r.grader} ${r.grade}`:null].filter(Boolean).join(' · '),currency:'USD',available:1}));}
    const rows=await db.all('SELECT l.id,l.currency,l.remaining_quantity,p.name FROM sealed_lot l JOIN sealed_product p ON p.id=l.product_id AND p.user_id=l.user_id WHERE l.user_id=? AND l.archived_at IS NULL AND p.archived_at IS NULL AND l.remaining_quantity>0 AND p.name LIKE ? ORDER BY p.name,l.id LIMIT 50',[user,term]);
    return rows.map(r=>({id:r.id,label:`${r.name} · lot #${r.id} · ${r.remaining_quantity} available · ${r.currency}`,currency:r.currency,available:r.remaining_quantity}));
   });
  },
  preview(user,body) {const v=input(body);return read(user,async db=>review(user,v,await state(db,user,v)));},
  async sell(user,body) {
   if(!Number.isSafeInteger(user)||user<1)throw fail(401,'Authentication required');
   const v=input(body);
   if(body.confirmed!==true||typeof body.previewToken!=='string'||typeof body.requestKey!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(body.requestKey))throw fail(400,'Review and explicitly confirm the sale');
   const payload=JSON.stringify({...v,previewToken:body.previewToken,allowUnknownBasis:body.allowUnknownBasis===true});
   const db=await connect();let began=false;
   try {
    await db.run('BEGIN IMMEDIATE');began=true;
    await opening.prepareSchema(db,cards.schema);await db.exec(sealed.schema);await db.exec(registry);await protection.install(db);
    const prior=await db.get('SELECT payload_json,response_json FROM sales_entry WHERE user_id=? AND request_key=?',[user,body.requestKey]);
    if(prior){if(prior.payload_json!==payload)throw fail(409,'Request key already used for different sale details');await db.run('COMMIT');began=false;return JSON.parse(prior.response_json);}
    const s=await state(db,user,v),checked=review(user,v,s);
    if(checked.previewToken!==body.previewToken)throw fail(409,'Inventory or cost changed. Review the sale again.');
    if(checked.realizedGainCents==null&&body.allowUnknownBasis!==true)throw fail(400,'Acknowledge that unknown basis prevents calculating realized gain');
    let record;const result={...checked,kind:v.kind,soldOn:v.soldOn,quantity:v.quantity,proceedsCents:v.proceedsCents,feesCents:v.feesCents};delete result.previewToken;
    if(v.kind==='card'){
     let lot=await db.get('SELECT * FROM card_acquisition_lot WHERE collection_id=? AND user_id=?',[v.id,user]);
     if(!lot){
      if(s.source==='opening')lot=await opening.createOpeningLot(db,user,v.id);
      else {const inserted=await db.run('INSERT INTO card_acquisition_lot (user_id,collection_id,source,original_quantity,remaining_quantity,original_basis_cents,remaining_basis_cents,currency) VALUES (?,?,?,1,1,?,?,?)',[user,v.id,s.source,s.remainingBasisCents,s.remainingBasisCents,'USD']);lot={id:inserted.lastID};}
     }
     await db.run('UPDATE card_acquisition_lot SET remaining_quantity=0,remaining_basis_cents=? WHERE id=? AND user_id=?',[checked.remainingBasisCents,lot.id,user]);
     const changed=await db.run("UPDATE collection SET list_type='sold' WHERE id=? AND user_id=? AND list_type='collection' AND quantity=1",[v.id,user]);if(changed.changes!==1)throw fail(409,'Card inventory changed');
     const request=JSON.stringify({lotId:lot.id,soldOn:v.soldOn,quantity:1,proceedsCents:v.proceedsCents,feesCents:v.feesCents});
     record=await db.run('INSERT INTO card_sale_record (user_id,lot_id,request_key,request_json,result_json,sold_on,quantity,proceeds_cents,fees_cents,sold_basis_cents,realized_gain_cents,currency,card_id) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?)',[user,lot.id,body.requestKey,request,JSON.stringify(result),v.soldOn,v.proceedsCents,v.feesCents,checked.soldBasisCents,checked.realizedGainCents,'USD',s.cardId]);
    }else{
     const request=JSON.stringify({lotId:v.id,soldOn:v.soldOn,quantity:v.quantity,proceedsCents:v.proceedsCents,feesCents:v.feesCents,currency:v.currency,notes:''});
     record=await db.run('INSERT INTO sealed_sale_record (user_id,lot_id,request_key,request_json,result_json,sold_on,quantity,proceeds_cents,fees_cents,sold_basis_cents,realized_gain_cents,currency,product_name,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[user,v.id,body.requestKey,request,JSON.stringify(result),v.soldOn,v.quantity,v.proceedsCents,v.feesCents,checked.soldBasisCents,checked.realizedGainCents,v.currency,s.name,'']);
     const changed=await db.run("UPDATE sealed_lot SET remaining_quantity=?,remaining_cost_cents=?,updated_at=datetime('now') WHERE id=? AND user_id=? AND remaining_quantity=? AND remaining_cost_cents=?",[checked.remainingQuantity,checked.remainingBasisCents,v.id,user,s.remainingQuantity,s.remainingBasisCents]);if(changed.changes!==1)throw fail(409,'Sealed inventory changed');
    }
    const response={...result,saleId:record.lastID};
    await db.run('INSERT INTO sales_entry (user_id,request_key,payload_json,response_json,kind,sold_on,currency,gain_cents) VALUES (?,?,?,?,?,?,?,?)',[user,body.requestKey,payload,JSON.stringify(response),v.kind,v.soldOn,v.currency,checked.realizedGainCents]);
    await db.run('COMMIT');began=false;return response;
   }catch(e){if(began)await db.run('ROLLBACK').catch(()=>{});throw e;}finally{await db.close();}
  },
  history(user,filters={}) {
   return read(user,db=>require('./salesReport').readReport(db,user,filters));
  }
 };
}
module.exports={createSalesApplication};
