'use strict';
const {createHash}=require('node:crypto');
const {calculateSale}=require('./costBasis');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const has=async(db,name)=>!!await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]);
const schema=`CREATE TABLE IF NOT EXISTS sale_adjustment(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id),history_id INTEGER NOT NULL REFERENCES sales_entry(id),kind TEXT NOT NULL CHECK(kind IN ('card','sealed')),sale_id INTEGER NOT NULL,revision INTEGER NOT NULL,action TEXT NOT NULL CHECK(action IN ('correct','undo')),sold_on TEXT NOT NULL,proceeds_cents INTEGER NOT NULL,fees_cents INTEGER NOT NULL,gain_cents INTEGER,response_json TEXT NOT NULL,reason TEXT NOT NULL,request_key TEXT NOT NULL,request_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,history_id,revision),UNIQUE(user_id,request_key));
CREATE TRIGGER IF NOT EXISTS sale_adjustment_no_update BEFORE UPDATE ON sale_adjustment BEGIN SELECT RAISE(ABORT,'Sale adjustments are append-only'); END;
CREATE TRIGGER IF NOT EXISTS sale_adjustment_no_delete BEFORE DELETE ON sale_adjustment BEGIN SELECT RAISE(ABORT,'Sale adjustments are append-only'); END;
CREATE TRIGGER IF NOT EXISTS sales_entry_no_update BEFORE UPDATE ON sales_entry BEGIN SELECT RAISE(ABORT,'Original sale history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS sales_entry_no_delete BEFORE DELETE ON sales_entry BEGIN SELECT RAISE(ABORT,'Original sale history is immutable'); END;
CREATE TABLE IF NOT EXISTS sale_restore_authorization(adjustment_id INTEGER PRIMARY KEY REFERENCES sale_adjustment(id),user_id INTEGER NOT NULL,lot_id INTEGER NOT NULL,old_quantity INTEGER NOT NULL,old_basis INTEGER NOT NULL,new_quantity INTEGER NOT NULL,new_basis INTEGER NOT NULL);`;
async function effectiveSource(db,table,includeUndone=false){
 if(!['sales_entry','card_sale_record','sealed_sale_record'].includes(table))throw new TypeError('Invalid sale source');
 const fields=(await db.all(`PRAGMA table_info(${table})`)).map(r=>r.name),adjusted=await has(db,'sale_adjustment'),registry=table==='sales_entry';
 const mapping=registry?{sold_on:'sold_on',gain_cents:'gain_cents',response_json:'response_json'}:{sold_on:'sold_on',proceeds_cents:'proceeds_cents',fees_cents:'fees_cents',realized_gain_cents:'gain_cents',result_json:'response_json'};
 const status=adjusted?"CASE WHEN a.action='undo' THEN 'undone' ELSE 'active' END":"'active'",revision=adjusted?'COALESCE(a.revision,0)':'0';
 const columns=fields.map(field=>{let expression=`r."${field}"`;if(adjusted&&mapping[field])expression=`CASE WHEN a.id IS NULL THEN r."${field}" ELSE a.${mapping[field]} END`;if(registry&&field==='response_json')expression=`json_set(${expression},'$.saleStatus',${status},'$.revision',${revision})`;return `${expression} AS "${field}"`;});
 const kind=table==='card_sale_record'?'card':'sealed';
 const join=!adjusted?'':registry?' LEFT JOIN sale_adjustment a ON a.user_id=r.user_id AND a.history_id=r.id AND a.id=(SELECT MAX(x.id) FROM sale_adjustment x WHERE x.user_id=r.user_id AND x.history_id=r.id)':` LEFT JOIN sale_adjustment a ON a.user_id=r.user_id AND a.kind='${kind}' AND a.sale_id=r.id AND a.id=(SELECT MAX(x.id) FROM sale_adjustment x WHERE x.user_id=r.user_id AND x.kind='${kind}' AND x.sale_id=r.id)`;
 return `(SELECT ${columns.join(',')},${status} AS sale_status,${revision} AS revision FROM ${table} r${join}${adjusted&&!includeUndone?" WHERE a.action IS NULL OR a.action!='undo'":''})`;
}
function input(body){
 if(!['correct','undo'].includes(body.action)||!Number.isSafeInteger(body.revision)||body.revision<0||typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>500)throw fail(400,'Choose an action, current revision, and a reason of 1-500 characters');
 if(['kind','id','quantity','currency','soldBasisCents'].some(k=>k in body))throw fail(400,'Item, quantity, currency and basis cannot be edited; undo and record a new sale');
 const v={action:body.action,revision:body.revision,reason:body.reason.trim()};
 if(v.action==='correct'){
  if(![body.proceedsCents,body.feesCents].every(n=>Number.isSafeInteger(n)&&n>=0))throw fail(400,'Use nonnegative integer monetary amounts');
  const d=body.soldOn;if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw fail(400,'Invalid sale date');
  Object.assign(v,{proceedsCents:body.proceedsCents,feesCents:body.feesCents,soldOn:d});
 }
 return v;
}
async function load(db,user,id){
 if(!await has(db,'sales_entry'))throw fail(404,'Sale not found');
 const entry=await db.get('SELECT * FROM sales_entry WHERE id=? AND user_id=?',[id,user]);if(!entry)throw fail(404,'Sale not found');
 const original=JSON.parse(entry.response_json),table=entry.kind==='card'?'card_sale_record':'sealed_sale_record';
 const record=await db.get(`SELECT * FROM ${table} WHERE id=? AND user_id=?`,[original.saleId,user]);
 if(!record||record.request_key!==entry.request_key||record.sold_basis_cents!==original.soldBasisCents||record.quantity!==original.quantity||record.currency!==original.currency)throw fail(409,'Sale identity or acquisition basis needs reconciliation');
 const latest=await has(db,'sale_adjustment')?await db.get('SELECT * FROM sale_adjustment WHERE user_id=? AND history_id=? ORDER BY id DESC LIMIT 1',[user,id]):null;
 return {entry,record,table,original,current:latest?JSON.parse(latest.response_json):original,revision:latest?.revision||0,undone:latest?.action==='undo'};
}
async function undoState(db,user,s){
 const source=await effectiveSource(db,s.table),last=await db.get(`SELECT id FROM ${source} WHERE user_id=? AND lot_id=? ORDER BY id DESC LIMIT 1`,[user,s.record.lot_id]);
 if(last?.id!==s.record.id)throw fail(409,'Undo the later active sale on this lot first');
 const expected=JSON.parse(s.record.result_json);
 if(s.entry.kind==='card'){
  const lot=await db.get('SELECT * FROM card_acquisition_lot WHERE id=? AND user_id=?',[s.record.lot_id,user]);
  const copy=lot&&await db.get('SELECT * FROM collection WHERE id=? AND user_id=?',[lot.collection_id,user]);
  if(!lot||!copy||lot.original_quantity!==1||lot.remaining_quantity!==0||lot.original_basis_cents!==s.record.sold_basis_cents||lot.remaining_basis_cents!==expected.remainingBasisCents||copy.quantity!==1||copy.list_type!=='sold'||copy.card_id!==s.record.card_id)throw fail(409,'The exact sold copy or its acquisition lot changed; undo is unsafe');
  return {lot,copy};
 }
 const lot=await db.get('SELECT l.*,p.archived_at AS product_archived_at FROM sealed_lot l JOIN sealed_product p ON p.id=l.product_id AND p.user_id=l.user_id WHERE l.id=? AND l.user_id=?',[s.record.lot_id,user]);
 if(!lot||lot.archived_at||lot.product_archived_at||lot.currency!==s.record.currency||lot.remaining_quantity!==expected.remainingQuantity||lot.remaining_cost_cents!==expected.remainingBasisCents)throw fail(409,'The sealed lot changed after this sale or is archived; undo is unsafe');
 const quantity=lot.remaining_quantity+s.record.quantity,basis=lot.remaining_cost_cents+s.record.sold_basis_cents;
 if(!Number.isSafeInteger(quantity)||!Number.isSafeInteger(basis)||quantity>lot.quantity||basis>lot.total_cost_cents)throw fail(409,'Restoration exceeds the original purchase');
 return {lot,quantity,basis};
}
async function prepare(db){
 await db.exec(schema);
 if(!await has(db,'sealed_sale_record'))return;
 const columns=new Set((await db.all('PRAGMA table_info(sealed_lot)')).map(r=>r.name));
 const immutable=['id','user_id','product_id','quantity','total_cost_cents','currency','purchased_at'].filter(k=>columns.has(k)).map(k=>`NEW.${k} IS NOT OLD.${k}`).join(' OR ')||'0';
 await db.exec(`DROP TRIGGER IF EXISTS sales_protect_sealed_acquisition;
 CREATE TRIGGER sales_protect_sealed_acquisition BEFORE UPDATE ON sealed_lot WHEN EXISTS(SELECT 1 FROM sealed_sale_record WHERE lot_id=OLD.id) AND ((${immutable}) OR ((NEW.remaining_quantity>OLD.remaining_quantity OR NEW.remaining_cost_cents>OLD.remaining_cost_cents) AND NOT EXISTS(SELECT 1 FROM sale_restore_authorization c JOIN sale_adjustment a ON a.id=c.adjustment_id JOIN sealed_sale_record r ON r.id=a.sale_id AND r.user_id=a.user_id WHERE a.action='undo' AND a.kind='sealed' AND c.user_id=OLD.user_id AND a.user_id=OLD.user_id AND c.lot_id=OLD.id AND r.lot_id=OLD.id AND c.old_quantity=OLD.remaining_quantity AND c.old_basis=OLD.remaining_cost_cents AND c.new_quantity=NEW.remaining_quantity AND c.new_basis=NEW.remaining_cost_cents))) BEGIN SELECT RAISE(ABORT,'This lot requires the guarded sale correction workflow'); END;`);
}
async function review(db,user,id,v){
 const s=await load(db,user,id);if(s.undone)throw fail(409,'Sale is already undone');if(s.revision!==v.revision)throw fail(409,'Sale changed; reload history before reviewing');
 const inventory=v.action==='undo'?await undoState(db,user,s):null;
 let after={...s.current};
 if(v.action==='correct'){const amounts=calculateSale({proceedsCents:v.proceedsCents,feesCents:v.feesCents,remainingBasisCents:s.record.sold_basis_cents,remainingQuantity:s.record.quantity,quantity:s.record.quantity});Object.assign(after,{proceedsCents:v.proceedsCents,feesCents:v.feesCents,soldOn:v.soldOn,netProceedsCents:amounts.netProceedsCents,realizedGainCents:amounts.realizedGainCents});}
 Object.assign(after,{saleStatus:v.action==='undo'?'undone':'active',revision:s.revision+1});
 const previewToken=createHash('sha256').update(JSON.stringify({user,id,v,current:s.current,inventory})).digest('hex');
 return {s,inventory,response:{before:s.current,after,action:v.action,reason:v.reason,previewToken,inventoryRestoration:v.action==='undo'?`${s.record.quantity} ${s.entry.kind==='card'?'exact card copy':'unit(s) to the original sealed lot'}; original sold basis restored`:null}};
}
function createSaleAdjustments({connect}){
 async function transaction(user,id,write,fn){
  if(!Number.isSafeInteger(user)||user<1)throw fail(401,'Authentication required');if(!Number.isSafeInteger(id)||id<1)throw fail(400,'Invalid sale ID');
  const db=await connect();let began=false;try{await db.run(write?'BEGIN IMMEDIATE':'BEGIN');began=true;const result=await fn(db);await db.run('COMMIT');began=false;return result;}catch(e){if(began)await db.run('ROLLBACK').catch(()=>{});throw e;}finally{await db.close();}
 }
 return {
  preview(user,id,body){const v=input(body);return transaction(user,id,false,async db=>(await review(db,user,id,v)).response);},
  audit(user,id){return transaction(user,id,false,async db=>{const s=await load(db,user,id);const events=await has(db,'sale_adjustment')?await db.all('SELECT revision,action,reason,created_at,response_json FROM sale_adjustment WHERE user_id=? AND history_id=? ORDER BY revision',[user,id]):[];return {original:s.original,current:s.current,revision:s.revision,saleStatus:s.undone?'undone':'active',events:events.map(e=>({...e,sale:JSON.parse(e.response_json),response_json:undefined}))};});},
  apply(user,id,body){
   const v=input(body);if(body.confirmed!==true||typeof body.previewToken!=='string'||typeof body.requestKey!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(body.requestKey))throw fail(400,'Review and explicitly confirm the adjustment');
   const request=JSON.stringify({id,...v,previewToken:body.previewToken});
   return transaction(user,id,true,async db=>{
    if(!await has(db,'sales_entry'))throw fail(404,'Sale not found');await prepare(db);
    const prior=await db.get('SELECT request_json,response_json FROM sale_adjustment WHERE user_id=? AND request_key=?',[user,body.requestKey]);
    if(prior){if(prior.request_json!==request)throw fail(409,'Request key used for different adjustment details');return JSON.parse(prior.response_json);}
    const checked=await review(db,user,id,v),{s,inventory}=checked;
    if(checked.response.previewToken!==body.previewToken)throw fail(409,'Sale or inventory changed; review again');
    const after=checked.response.after;
    const inserted=await db.run('INSERT INTO sale_adjustment(user_id,history_id,kind,sale_id,revision,action,sold_on,proceeds_cents,fees_cents,gain_cents,response_json,reason,request_key,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[user,id,s.entry.kind,s.record.id,after.revision,v.action,after.soldOn,after.proceedsCents,after.feesCents,after.realizedGainCents,JSON.stringify(after),v.reason,body.requestKey,request]);
    if(v.action==='undo'){
     if(s.entry.kind==='card'){
      const changed=await db.run('UPDATE card_acquisition_lot SET remaining_quantity=1,remaining_basis_cents=? WHERE id=? AND user_id=? AND remaining_quantity=0 AND remaining_basis_cents IS ?',[s.record.sold_basis_cents,inventory.lot.id,user,inventory.lot.remaining_basis_cents]);if(changed.changes!==1)throw fail(409,'Card acquisition changed');
      const restored=await db.run("UPDATE collection SET list_type='collection' WHERE id=? AND user_id=? AND list_type='sold' AND quantity=1",[inventory.copy.id,user]);if(restored.changes!==1)throw fail(409,'Card inventory changed');
     }else{
      const l=inventory.lot;await db.run('INSERT INTO sale_restore_authorization VALUES(?,?,?,?,?,?,?)',[inserted.lastID,user,l.id,l.remaining_quantity,l.remaining_cost_cents,inventory.quantity,inventory.basis]);
      const restored=await db.run("UPDATE sealed_lot SET remaining_quantity=?,remaining_cost_cents=?,updated_at=datetime('now') WHERE id=? AND user_id=? AND remaining_quantity=? AND remaining_cost_cents=?",[inventory.quantity,inventory.basis,l.id,user,l.remaining_quantity,l.remaining_cost_cents]);if(restored.changes!==1)throw fail(409,'Sealed inventory changed');
      await db.run('DELETE FROM sale_restore_authorization WHERE adjustment_id=?',[inserted.lastID]);
     }
    }
    return after;
   });
  }
 };
}
module.exports={createSaleAdjustments,effectiveSource};
