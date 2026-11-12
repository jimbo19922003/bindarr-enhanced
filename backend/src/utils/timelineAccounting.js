'use strict';
const {wholeOpeningBasis}=require('./openingGroupBasis');
const schema=`CREATE TABLE IF NOT EXISTS portfolio_accounting_daily(user_id INTEGER NOT NULL,game TEXT NOT NULL,currency TEXT NOT NULL,time_zone TEXT NOT NULL,day TEXT NOT NULL,recorded_at INTEGER NOT NULL,accounting_json TEXT NOT NULL,PRIMARY KEY(user_id,game,currency,time_zone,day))`;
const valid=n=>Number.isSafeInteger(n)&&n>=0;
const sum=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))throw new RangeError('Timeline amount exceeds safe numeric range');return n;};
async function readAccounting(db,user,game,valuation,portfolio,day){
 const tables=new Map();
 const has=async name=>{if(!tables.has(name))tables.set(name,(await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]))?.name===name);return tables.get(name);};
 const owned=portfolio.cards||[],ownedById=new Map(owned.map(c=>[c.entry_id,c]));
 const lots=await has('card_acquisition_lot')?await db.all('SELECT * FROM card_acquisition_lot WHERE user_id=?',[user]):[];
 const byLot=new Map(lots.map(l=>[l.collection_id,l]));
 const pulls=await has('sealed_pull')?await db.all('SELECT * FROM sealed_pull WHERE user_id=? ORDER BY id',[user]):[];
 const pullCopies=new Set();for(const p of pulls){if(p.collection_id)pullCopies.add(p.collection_id);for(const id of String(p.filed_ids||'').split(',').map(Number))if(id>0)pullCopies.add(id);}
 const snapshots=new Map();
 if(await has('opening_basis_snapshot'))for(const row of await db.all('SELECT opening_id,snapshot_json FROM opening_basis_snapshot WHERE user_id=?',[user]))snapshots.set(row.opening_id,JSON.parse(row.snapshot_json));
 const groupedCopies=new Set();
 let groupedOpeningCount=0,pendingAllocationCount=0,unresolvedOpeningCount=0;
 let unknownBasisCount=0,unknownSaleCount=0,unknownSoldBasisCount=0,remainingBasisCents=0,soldBasisCents=0,knownRealizedGainCents=0,extraUnpriced=0;
 if((!game||game==='pokemon')&&await has('sealed_opening')){
  for(const opening of await db.all('SELECT * FROM sealed_opening WHERE user_id=? ORDER BY id',[user])){
   const openingPulls=pulls.filter(p=>p.opening_id===opening.id);
   let allocationPending=false;
   if(!snapshots.has(opening.id)){
    const ids=openingPulls.flatMap(p=>String(p.filed_ids||'').split(',').map(Number));
    const candidate=ids.map(id=>ownedById.get(id)).find(Boolean);
    if(candidate){try{const result=await require('./completedRipBasis').forCopy(db,user,{...candidate,id:candidate.entry_id},opening.id);if(result.snapshot)snapshots.set(opening.id,result.snapshot);else allocationPending=['Some opening-time values are missing; multi-pull allocation is pending','Multi-pull opening values do not support an allocation'].includes(result.reason);}catch(e){if(e.status!==409)throw e;}}
   }
   const snapshot=snapshots.get(opening.id);
   if(!snapshot){
    const group=allocationPending?wholeOpeningBasis(opening,openingPulls,ownedById,byLot,pulls):null;
    if(group){
     for(const id of group.copyIds){if(groupedCopies.has(id))throw new Error('Conflicting grouped opening provenance');groupedCopies.add(id);}
     remainingBasisCents=sum(remainingBasisCents,group.costCents);groupedOpeningCount++;pendingAllocationCount++;continue;
    }
    unresolvedOpeningCount++;
    const hasOwnedCopy=openingPulls.some(p=>[p.collection_id,...String(p.filed_ids||'').split(',').map(Number)].some(id=>ownedById.has(id)));
    if(!hasOwnedCopy)unknownBasisCount++;
    continue;
   }
   if(snapshot.currency!=='USD'||!Array.isArray(snapshot.lines))throw new Error('Invalid opening basis snapshot');
   for(const line of snapshot.lines){if(!valid(line.unlinkedBasisCents))throw new Error('Invalid unlinked opening basis');remainingBasisCents=sum(remainingBasisCents,line.unlinkedBasisCents);if(!line.copies.length)extraUnpriced+=line.quantity;}
  }
 }
 const byCopy=new Map();for(const snapshot of snapshots.values())for(const line of snapshot.lines)for(const copy of line.copies){if(byCopy.has(copy.collectionId)||groupedCopies.has(copy.collectionId))throw new Error('Conflicting opening provenance');byCopy.set(copy.collectionId,{cost:copy.costCents,cardId:line.cardId});}
 for(const card of owned){
  if(groupedCopies.has(card.entry_id))continue;
  const quantity=card.quantity||1,lot=byLot.get(card.entry_id),mapping=byCopy.get(card.entry_id);let basis=null;
  if(lot){if(lot.currency==='USD'&&lot.remaining_quantity===quantity&&valid(lot.remaining_basis_cents)&&(!mapping||(lot.source==='opening'&&lot.original_basis_cents===mapping.cost&&mapping.cardId===card.card_id)))basis=lot.remaining_basis_cents;}
  else if(mapping){if(quantity===1&&mapping.cardId===card.card_id&&valid(mapping.cost))basis=mapping.cost;}
  else if(!pullCopies.has(card.entry_id)&&typeof card.purchase_price==='number'&&card.purchase_price>0){basis=Math.round(card.purchase_price*100)*quantity;if(!valid(basis))throw new Error('Invalid direct acquisition cost');}
  if(basis==null)unknownBasisCount+=quantity;else remainingBasisCents=sum(remainingBasisCents,basis);
 }
 if((!game||game==='pokemon')&&await has('sealed_lot'))for(const lot of await db.all('SELECT l.* FROM sealed_lot l JOIN sealed_product p ON p.id=l.product_id AND p.user_id=l.user_id WHERE l.user_id=? AND l.archived_at IS NULL AND p.archived_at IS NULL AND l.remaining_quantity>0',[user])){
  if(!valid(lot.remaining_cost_cents)){unknownBasisCount+=lot.remaining_quantity;continue;}const cost=await valuation.cents(lot.remaining_cost_cents,lot.currency);if(!valid(cost))unknownBasisCount+=lot.remaining_quantity;else remainingBasisCents=sum(remainingBasisCents,cost);
 }
 async function sales(table,card){
  if(!await has(table))return;
  const source=await require('./saleAdjustments').effectiveSource(db,table);
  const rows=await db.all(card?`SELECT r.* FROM ${source} r LEFT JOIN card_cache cc ON cc.id=r.card_id WHERE r.user_id=? AND r.sold_on<=?${game?' AND cc.game=?':''}`:`SELECT * FROM ${source} WHERE user_id=? AND sold_on<=?`,card&&game?[user,day,game]:[user,day]);
  for(const row of rows){
   if(valid(row.sold_basis_cents)){const basis=await valuation.cents(row.sold_basis_cents,row.currency);if(valid(basis))soldBasisCents=sum(soldBasisCents,basis);else unknownSoldBasisCount++;}
   else unknownSoldBasisCount++;
   if(row.currency!=='USD'||!valid(row.sold_basis_cents)||!valid(row.proceeds_cents)||!valid(row.fees_cents)||!Number.isSafeInteger(row.realized_gain_cents)){unknownSaleCount++;continue;}const gain=row.proceeds_cents-row.fees_cents-row.sold_basis_cents;if(gain!==row.realized_gain_cents)throw new Error('Recorded sale basis and gain differ');knownRealizedGainCents=sum(knownRealizedGainCents,gain);
  }
 }
 await sales('card_sale_record',true);if(!game||game==='pokemon')await sales('sealed_sale_record',false);
 const value=Math.round(portfolio.totalValue*100);if(!valid(value))throw new Error('Invalid holdings value');
 // Calculate unrealized gain: only null on unknown sales, treat missing basis as zero
 const unrealizedGainCents=unknownSaleCount?null:sum(value,-remainingBasisCents);
 const realizedGainCents=unknownSaleCount?null:knownRealizedGainCents;
 return {version:2,remainingBasisCents,unknownBasisCount,unknownSaleCount,unknownSoldBasisCount,soldBasisCents,knownRealizedGainCents,realizedGainCents,unrealizedGainCents,totalGainCents:realizedGainCents==null||unrealizedGainCents==null?null:sum(realizedGainCents,unrealizedGainCents),extraUnpriced,groupedOpeningCount,pendingAllocationCount,unresolvedOpeningCount};
}
function decoratePoint(legacy,row){
 const a=row.accounting||(row.accounting_json?JSON.parse(row.accounting_json):null);
 if(!a||![2,3].includes(a.version))return {...legacy,accountingVersion:1,legacyGain:legacy.gain,legacyGainPct:legacy.gainPct,legacyRecordedCost:legacy.invested,invested:null,gain:null,gainPct:null,realizedGain:null,unrealizedGain:null,totalGain:null};
 const money=n=>n==null?null:n/100;
 const reconstructed=a.version===3&&valid(a.recordedRemainingCents)&&valid(a.soldBasisCents)?a.recordedRemainingCents+a.soldBasisCents:null;
 const spending=valid(a.recordedSpendingCents)?a.recordedSpendingCents:reconstructed;
 const gainPct=a.version===3&&valid(spending)&&spending>0&&Number.isSafeInteger(a.totalGainCents)?Number((a.totalGainCents/spending*100).toFixed(6)):null;
 return {...legacy,accountingVersion:a.version,invested:a.version===3?money(a.recordedRemainingCents):a.unknownBasisCount?null:money(a.remainingBasisCents),gain:money(a.totalGainCents),gainPct,realizedGain:money(a.realizedGainCents),unrealizedGain:money(a.unrealizedGainCents),totalGain:money(a.totalGainCents),knownRealizedGain:money(a.knownRealizedGainCents),unknownBasisCount:a.unknownBasisCount,unknownSaleCount:a.unknownSaleCount,spendingUnknownCount:a.spendingUnknownCount||0,unpricedCards:(legacy.unpricedCards||0)+(a.extraUnpriced||0)};
}
async function save(db,dimensions,a){
 if(!a)return;const [user,game,currency,zone,day,timestamp]=dimensions;
 await db.run(`INSERT INTO portfolio_accounting_daily(user_id,game,currency,time_zone,day,recorded_at,accounting_json) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM portfolio_daily_performance WHERE user_id=? AND game=? AND currency=? AND time_zone=? AND day=? AND recorded_at=?) ON CONFLICT(user_id,game,currency,time_zone,day) DO UPDATE SET recorded_at=excluded.recorded_at,accounting_json=excluded.accounting_json WHERE excluded.recorded_at>=portfolio_accounting_daily.recorded_at`,[user,game,currency,zone,day,timestamp,JSON.stringify(a),...dimensions]);
}
module.exports={schema,readAccounting,decoratePoint,save};
