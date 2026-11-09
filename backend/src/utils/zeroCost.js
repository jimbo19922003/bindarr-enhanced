'use strict';
function parsePurchaseCost(body={}){
 const raw=body.purchase_price;
 if(raw==null||typeof raw==='string'&&!raw.trim())return {ok:true,amount:null,confirmedZero:false};
 const invalid=()=>({ok:false,status:400,code:'INVALID_PURCHASE_COST',error:'Enter a valid nonnegative purchase cost with at most two decimal places, or leave it blank for unknown cost.'});
 if(!['string','number'].includes(typeof raw)||typeof raw==='string'&&!/^\d+(?:\.\d{1,2})?$/.test(raw.trim()))return invalid();
 const value=Number(raw),cents=Math.round(value*100);
 if(!Number.isFinite(value)||value<0||!Number.isSafeInteger(cents)||Math.abs(value*100-cents)>0.000001)return invalid();
 if(cents===0&&body.zero_cost_confirmed!==true)return {ok:false,status:409,code:'ZERO_COST_CONFIRMATION_REQUIRED',error:'Confirm zero purchase cost: if this card was a gift or obtained for free, confirm to record a known zero cost basis. Otherwise enter the amount paid.'};
 return {ok:true,amount:cents/100,confirmedZero:cents===0};
}
async function prepare(db){
 const columns=await db.all('PRAGMA table_info(collection)');
 if(!columns.some(column=>column.name==='zero_cost_confirmed'))await db.run('ALTER TABLE collection ADD COLUMN zero_cost_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(zero_cost_confirmed IN (0,1))');
 for(const statement of require('./salesRepository').schema.split(';').map(value=>value.trim()).filter(Boolean))await db.run(statement);
 await db.run(`CREATE TRIGGER IF NOT EXISTS collection_confirmed_zero_basis AFTER INSERT ON collection WHEN NEW.zero_cost_confirmed=1 BEGIN
 SELECT CASE WHEN NEW.purchase_price IS NULL OR NEW.purchase_price!=0 OR NEW.list_type!='collection' THEN RAISE(ABORT,'Invalid confirmed zero acquisition') END;
 INSERT INTO card_acquisition_lot(user_id,collection_id,source,original_quantity,remaining_quantity,original_basis_cents,remaining_basis_cents,currency) VALUES(NEW.user_id,NEW.id,'direct',NEW.quantity,NEW.quantity,0,0,'USD');
 END`);
}
module.exports={parsePurchaseCost,prepare};
