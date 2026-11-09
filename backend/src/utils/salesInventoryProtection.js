'use strict';
const exists=async(db,name)=>!!await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]);
async function differences(db,table,fields) {
  const columns=new Set((await db.all(`PRAGMA table_info(${table})`)).map(row=>row.name));
  return fields.filter(field=>columns.has(field)).map(field=>`NEW.${field} IS NOT OLD.${field}`).join(' OR ') || '0';
}
async function install(db) {
  if (await exists(db,'card_acquisition_lot')) {
    const identity=await differences(db,'collection',['id','user_id','card_id','purchase_price','printing','language','grader','grade','cert_number']);
    const acquisition=await differences(db,'card_acquisition_lot',['id','user_id','collection_id','source','original_quantity','original_basis_cents','currency']);
    await db.exec(`
    CREATE TRIGGER IF NOT EXISTS sales_protect_card_identity BEFORE UPDATE ON collection
    WHEN EXISTS(SELECT 1 FROM card_acquisition_lot WHERE collection_id=OLD.id) AND
    ((${identity}) OR NOT EXISTS(SELECT 1 FROM card_acquisition_lot l WHERE l.collection_id=OLD.id AND l.user_id=NEW.user_id AND
      ((l.remaining_quantity>0 AND NEW.list_type='collection' AND NEW.quantity=l.remaining_quantity) OR
       (l.remaining_quantity=0 AND NEW.list_type='sold' AND NEW.quantity=OLD.quantity))))
    BEGIN SELECT RAISE(ABORT,'Sales accounting protects this copy; use the sales or correction workflow'); END;
    CREATE TRIGGER IF NOT EXISTS sales_protect_card_delete BEFORE DELETE ON collection
    WHEN EXISTS(SELECT 1 FROM card_acquisition_lot WHERE collection_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'Acquisition history protects this copy from deletion'); END;
    CREATE TRIGGER IF NOT EXISTS sales_protect_acquisition BEFORE UPDATE ON card_acquisition_lot WHEN ${acquisition}
    BEGIN SELECT RAISE(ABORT,'Acquisition history requires an explicit correction'); END;
    CREATE TRIGGER IF NOT EXISTS card_sale_no_update BEFORE UPDATE ON card_sale_record
    BEGIN SELECT RAISE(ABORT,'Sale history requires an explicit correction record'); END;
    CREATE TRIGGER IF NOT EXISTS card_sale_no_delete BEFORE DELETE ON card_sale_record
    BEGIN SELECT RAISE(ABORT,'Sale history requires an explicit correction record'); END;
    `);
  }
  if (await exists(db,'sealed_sale_record')) {
    const acquisition=await differences(db,'sealed_lot',['id','user_id','product_id','quantity','total_cost_cents','currency','purchased_at']);
    await db.exec(`
    CREATE TRIGGER IF NOT EXISTS sales_protect_sealed_acquisition BEFORE UPDATE ON sealed_lot
    WHEN EXISTS(SELECT 1 FROM sealed_sale_record WHERE lot_id=OLD.id) AND
      ((${acquisition}) OR NEW.remaining_quantity>OLD.remaining_quantity OR NEW.remaining_cost_cents>OLD.remaining_cost_cents)
    BEGIN SELECT RAISE(ABORT,'This lot has sales; acquisition changes and restocking require a correction workflow'); END;
    `);
  }
  await require('./collectionRemoval').prepare(db);
}
async function hasSealedSales(db,lotId,userId) {
  if (!await exists(db,'sealed_sale_record')) return false;
  return !!await db.get('SELECT id FROM sealed_sale_record WHERE lot_id=? AND user_id=? LIMIT 1',[lotId,userId]);
}
function validateSealedLotEdit(existing,body,moneyToCents) {
  const proposed={
    quantity:body.quantity==null?existing.quantity:Number(body.quantity),
    remaining_quantity:body.remaining_quantity==null?existing.remaining_quantity:Number(body.remaining_quantity),
    total_cost_cents:body.total_cost==null?existing.total_cost_cents:moneyToCents(body.total_cost,'Total cost'),
    currency:body.currency==null?existing.currency:String(body.currency).trim().toUpperCase(),
    purchased_at:body.purchased_at==null?existing.purchased_at:body.purchased_at
  };
  if (Object.entries(proposed).some(([field,value])=>value!==existing[field])) throw new RangeError('This lot has sales. Quantity, acquisition cost, currency and purchase date require a correction workflow.');
}
module.exports={install,hasSealedSales,validateSealedLotEdit};
