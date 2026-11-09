'use strict';
const {createHash}=require('node:crypto');
const has=async(db,name)=>!!await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]);
const normalized=sql=>String(sql||'').replace(/\s+/g,'').replace(/IFNOTEXISTS/gi,'').replace(/;$/,'').toLowerCase();
const legacy="CREATE TRIGGER sales_protect_card_delete BEFORE DELETE ON collection WHEN EXISTS(SELECT 1 FROM card_acquisition_lot WHERE collection_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Acquisition history protects this copy from deletion'); END";
const quoted=name=>'\"'+name.replace(/\"/g,'\"\"')+'\"';
function jsonRow(alias,columns){return 'json_object('+columns.flatMap(column=>["'"+column.name.replace(/'/g,"''")+"'",alias+'.'+quoted(column.name)]).join(',')+')';}
async function prepare(db){
 if(!await has(db,'card_acquisition_lot'))return;
 const entryColumns=await db.all('PRAGMA table_info(collection)'),lotColumns=await db.all('PRAGMA table_info(card_acquisition_lot)');
 const guards=[];
 if(await has(db,'card_sale_record'))guards.push(["EXISTS(SELECT 1 FROM card_sale_record s JOIN card_acquisition_lot l ON l.id=s.lot_id WHERE l.collection_id=OLD.id)",'This card has sale history. Use the sale correction workflow; ordinary deletion cannot erase it.']);
 if(await has(db,'sealed_pull'))guards.push(["EXISTS(SELECT 1 FROM sealed_pull p WHERE p.collection_id=OLD.id OR instr(','||replace(COALESCE(p.filed_ids,''),' ','')||',',','||OLD.id||',')>0)",'This card belongs to a sealed opening. Change it through the opening workflow.']);
 if(await has(db,'opening_basis_copy'))guards.push(['EXISTS(SELECT 1 FROM opening_basis_copy b WHERE b.collection_id=OLD.id)','This card has finalized opening costs. Use the opening correction workflow.']);
 if(await has(db,'decks')&&await has(db,'deck_cards'))guards.push(["EXISTS(SELECT 1 FROM deck_cards dc JOIN decks d ON d.id=dc.deck_id WHERE d.user_id=OLD.user_id AND d.checked_out=1 AND dc.card_id=OLD.card_id AND dc.quantity>0)",'This card is required by a checked-out deck. Check the deck in before removing this acquisition.']);
 const marker='collection-removal-v1:'+createHash('sha256').update(JSON.stringify({entryColumns,lotColumns,guards})).digest('hex');
 const current=await db.get("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='sales_protect_card_delete'");
 if(current?.sql.includes(marker))return;
 if(current&&!current.sql.includes('collection-removal-v1:')&&normalized(current.sql)!==normalized(legacy))throw new Error('Unreviewed collection deletion trigger; refusing to replace custom accounting protections');
 const checks=guards.map(([condition,message])=>"SELECT CASE WHEN "+condition+" THEN RAISE(ABORT,'"+message.replace(/'/g,"''")+"') END;").join('\n');
 let began=false;
 try{
  await db.run('SAVEPOINT collection_removal_upgrade');began=true;
  await db.run("CREATE TABLE IF NOT EXISTS collection_removal_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,collection_id INTEGER NOT NULL,lot_id INTEGER NOT NULL,entry_json TEXT NOT NULL,acquisition_json TEXT NOT NULL,reason TEXT NOT NULL CHECK(reason='unsold_acquisition_removed'),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  await db.run("CREATE TRIGGER IF NOT EXISTS collection_removal_audit_no_update BEFORE UPDATE ON collection_removal_audit BEGIN SELECT RAISE(ABORT,'Collection removal audit is append-only'); END");
  await db.run("CREATE TRIGGER IF NOT EXISTS collection_removal_audit_no_delete BEFORE DELETE ON collection_removal_audit BEGIN SELECT RAISE(ABORT,'Collection removal audit is append-only'); END");
  await db.run('DROP TRIGGER IF EXISTS sales_protect_card_delete');
  await db.run(`CREATE TRIGGER sales_protect_card_delete BEFORE DELETE ON collection
   WHEN EXISTS(SELECT 1 FROM card_acquisition_lot WHERE collection_id=OLD.id)
   BEGIN
   -- ${marker}
   SELECT CASE WHEN OLD.list_type!='collection' OR EXISTS(SELECT 1 FROM card_acquisition_lot l WHERE l.collection_id=OLD.id AND (l.user_id IS NOT OLD.user_id OR l.source NOT IN ('direct','unknown') OR l.original_quantity IS NOT l.remaining_quantity OR l.remaining_quantity IS NOT OLD.quantity OR l.original_basis_cents IS NOT l.remaining_basis_cents)) THEN RAISE(ABORT,'Acquisition inventory or cost changed. Use the accounting correction workflow.') END;
   ${checks}
   INSERT INTO collection_removal_audit(user_id,collection_id,lot_id,entry_json,acquisition_json,reason) SELECT OLD.user_id,OLD.id,l.id,${jsonRow('OLD',entryColumns)},${jsonRow('l',lotColumns)},'unsold_acquisition_removed' FROM card_acquisition_lot l WHERE l.collection_id=OLD.id;
   DELETE FROM card_acquisition_lot WHERE collection_id=OLD.id AND user_id=OLD.user_id;
   END`);
  await db.run('RELEASE SAVEPOINT collection_removal_upgrade');began=false;
 }catch(error){if(began){await db.run('ROLLBACK TO SAVEPOINT collection_removal_upgrade').catch(()=>{});await db.run('RELEASE SAVEPOINT collection_removal_upgrade').catch(()=>{});}throw error;}
}
module.exports={prepare};
