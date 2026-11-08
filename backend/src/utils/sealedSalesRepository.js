// sales-ui-v1
// sales-inventory-protection-v1
'use strict';
const { calculateSale } = require('./costBasis');
const schema = `
CREATE TABLE IF NOT EXISTS sealed_sale_record (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 lot_id INTEGER NOT NULL REFERENCES sealed_lot(id) ON DELETE RESTRICT,
 request_key TEXT NOT NULL, request_json TEXT NOT NULL, result_json TEXT NOT NULL,
 sold_on TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
 proceeds_cents INTEGER NOT NULL CHECK(proceeds_cents>=0), fees_cents INTEGER NOT NULL CHECK(fees_cents>=0),
 sold_basis_cents INTEGER NOT NULL CHECK(sold_basis_cents>=0), realized_gain_cents INTEGER NOT NULL,
 currency TEXT NOT NULL, product_name TEXT NOT NULL, notes TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,request_key)
);
CREATE TRIGGER IF NOT EXISTS sealed_sale_no_update BEFORE UPDATE ON sealed_sale_record BEGIN SELECT RAISE(ABORT,'Sale history requires an explicit correction record'); END;
CREATE TRIGGER IF NOT EXISTS sealed_sale_no_delete BEFORE DELETE ON sealed_sale_record BEGIN SELECT RAISE(ABORT,'Sale history requires an explicit correction record'); END;
`;
const fail=(status,message)=>Object.assign(new Error(message),{status});
function positive(n,name) { if (!Number.isSafeInteger(n)||n<1) throw fail(400,`Invalid ${name}`); }
function amount(n) { if (!Number.isSafeInteger(n)||n<0) throw fail(400,'Money must be nonnegative integer minor units'); }
function createSealedSalesRepository({connect}) {
  return {
    async recordSale(userId,{lotId,requestKey,soldOn,quantity,proceedsCents,feesCents=0,currency,notes=''}) {
      positive(userId,'user');positive(lotId,'lot');positive(quantity,'quantity');amount(proceedsCents);amount(feesCents);
      if (typeof requestKey!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(requestKey)) throw fail(400,'Invalid idempotency key');
      if (typeof soldOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(soldOn)||!Number.isFinite(Date.parse(soldOn))||new Date(soldOn).toISOString().slice(0,10)!==soldOn) throw fail(400,'Invalid sale date');
      if (!['USD','EUR','GBP','CAD','AUD','JPY'].includes(currency)) throw fail(400,'Unsupported sale currency');
      if (typeof notes!=='string'||notes.length>1000) throw fail(400,'Notes must be at most 1000 characters');
      const request=JSON.stringify({lotId,soldOn,quantity,proceedsCents,feesCents,currency,notes});
      const db=await connect();let began=false;
      try {
        await db.run('BEGIN IMMEDIATE');began=true;await db.exec(schema);
        await require('./salesInventoryProtection').install(db);
        const prior=await db.get('SELECT id,request_json,result_json FROM sealed_sale_record WHERE user_id=? AND request_key=?',[userId,requestKey]);
        if (prior) {
          if (prior.request_json!==request) throw fail(409,'Idempotency key reused with different sale details');
          await db.run('COMMIT');began=false;return {...JSON.parse(prior.result_json),saleId:prior.id};
        }
        const lot=await db.get('SELECT l.*,p.name AS product_name FROM sealed_lot l JOIN sealed_product p ON p.id=l.product_id AND p.user_id=l.user_id WHERE l.id=? AND l.user_id=? AND l.archived_at IS NULL AND p.archived_at IS NULL',[lotId,userId]);
        if (!lot) throw fail(404,'Active owned sealed lot not found');
        if (lot.currency!==currency) throw fail(400,'Sale proceeds and fees must use the acquisition lot currency; no implicit FX conversion');
        if (quantity>lot.remaining_quantity||lot.remaining_quantity<1) throw fail(409,'Insufficient sealed quantity');
        const calculated=calculateSale({proceedsCents,feesCents,remainingBasisCents:lot.remaining_cost_cents,remainingQuantity:lot.remaining_quantity,quantity});
        const result={...calculated,currency,productName:lot.product_name,soldOn,quantity,proceedsCents,feesCents};
        const saved=await db.run('INSERT INTO sealed_sale_record (user_id,lot_id,request_key,request_json,result_json,sold_on,quantity,proceeds_cents,fees_cents,sold_basis_cents,realized_gain_cents,currency,product_name,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[userId,lotId,requestKey,request,JSON.stringify(result),soldOn,quantity,proceedsCents,feesCents,result.soldBasisCents,result.realizedGainCents,currency,lot.product_name,notes]);
        const changed=await db.run("UPDATE sealed_lot SET remaining_quantity=?,remaining_cost_cents=?,updated_at=datetime('now') WHERE id=? AND user_id=? AND remaining_quantity=? AND remaining_cost_cents=? AND archived_at IS NULL",[result.remainingQuantity,result.remainingBasisCents,lotId,userId,lot.remaining_quantity,lot.remaining_cost_cents]);
        if (changed.changes!==1) throw fail(409,'Sealed lot changed; reload before selling');
        await db.run('COMMIT');began=false;return {...result,saleId:saved.lastID};
      } catch(error) {if(began) await db.run('ROLLBACK').catch(()=>{});throw error;}
      finally {await db.close();}
    },
    async listSales(userId,{beforeId=Number.MAX_SAFE_INTEGER,limit=50}={}) {
      positive(userId,'user');positive(beforeId,'cursor');positive(limit,'limit');if(limit>200) throw fail(400,'Limit exceeds 200');
      const db=await connect();
      try {
        if (!await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sealed_sale_record'")) return [];
        return await db.all('SELECT id,lot_id,sold_on,quantity,proceeds_cents,fees_cents,sold_basis_cents,realized_gain_cents,currency,product_name,notes FROM sealed_sale_record WHERE user_id=? AND id<? ORDER BY id DESC LIMIT ?',[userId,beforeId,limit]);
      } finally {await db.close();}
    }
  };
}
module.exports={createSealedSalesRepository,schema};
