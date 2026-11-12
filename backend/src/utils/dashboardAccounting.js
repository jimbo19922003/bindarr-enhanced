'use strict';
const {readAccounting}=require('./timelineAccounting');
const valid=n=>Number.isSafeInteger(n)&&n>=0;
const add=(a,b)=>{const n=a+b;if(!valid(n))throw new RangeError('Invalid recorded purchase total');return n;};
async function readRecordedSpending(db,user,game,valuation){
 const has=async name=>(await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]))?.name===name;
 const excluded=new Set();
 if(await has('sealed_pull'))for(const row of await db.all('SELECT collection_id,filed_ids FROM sealed_pull WHERE user_id=?',[user])){if(row.collection_id)excluded.add(row.collection_id);for(const id of String(row.filed_ids||'').split(',').map(Number))if(id>0)excluded.add(id);}
 const acquisitions=await has('card_acquisition_lot')?await db.all('SELECT * FROM card_acquisition_lot WHERE user_id=?',[user]):[];
 const lots=new Map(acquisitions.map(l=>[l.collection_id,l]));
 let knownCents=0,unknownCount=0;
 const cards=await db.all(`SELECT c.*,cc.game FROM collection c JOIN card_cache cc ON cc.id=c.card_id WHERE c.user_id=? AND c.list_type IN ('collection','sold')${game?' AND cc.game=?':''}`,game?[user,game]:[user]);
 for(const card of cards){
  const lot=lots.get(card.id);if(excluded.has(card.id)||lot?.source==='opening')continue;
  let cost=null;
  if(lot?.source==='direct'&&lot.currency==='USD'&&valid(lot.original_basis_cents))cost=lot.original_basis_cents;
  else if(typeof card.purchase_price==='number'&&card.purchase_price>0&&Number.isSafeInteger(card.quantity)&&card.quantity>0)cost=Math.round(card.purchase_price*100)*card.quantity;
  if(!valid(cost))unknownCount++;else knownCents=add(knownCents,cost);
 }
 const packFilter=await has('sealed_pack_lot')?' AND NOT EXISTS (SELECT 1 FROM sealed_pack_lot p WHERE p.lot_id=sealed_lot.id)':'';
 if((!game||game==='pokemon')&&await has('sealed_lot'))for(const lot of await db.all(`SELECT total_cost_cents,currency FROM sealed_lot WHERE user_id=?${packFilter}`,[user])){
  if(!valid(lot.total_cost_cents)){unknownCount++;continue;}const cost=await valuation.cents(lot.total_cost_cents,lot.currency);if(!valid(cost))unknownCount++;else knownCents=add(knownCents,cost);
 }
 return {knownCents,unknownCount,historyComplete:false,basis:'retained-acquisition-records',note:'Includes retained owned/sold card purchases and sealed lots, including archived lots. Rip contents are not a second purchase. Deleted purchases, missing costs, and unrecorded purchases may be absent; this is not a certified lifetime or net-contribution total.'};
}
async function readDashboardAccounting(db,user,game,valuation,portfolio,day){
 const accounting=await readAccounting(db,user,game,valuation,portfolio,day);
 const spending=await readRecordedSpending(db,user,game,valuation);
 const recordedRemainingCents=accounting.soldBasisCents>spending.knownCents?null:spending.knownCents-accounting.soldBasisCents;
 const value=Math.round(portfolio.totalValue*100);
 if(!valid(value))throw new RangeError('Invalid holdings value');
 const unrealizedGainCents=recordedRemainingCents==null?null:value-recordedRemainingCents;
 const totalGainCents=unrealizedGainCents==null||accounting.realizedGainCents==null?null:unrealizedGainCents+accounting.realizedGainCents;
 if((unrealizedGainCents!=null&&!Number.isSafeInteger(unrealizedGainCents))||(totalGainCents!=null&&!Number.isSafeInteger(totalGainCents)))throw new RangeError('Invalid portfolio gain');
 return {spending,accounting:{...accounting,version:3,recordedSpendingCents:spending.knownCents,recordedRemainingCents,spendingUnknownCount:spending.unknownCount,unrealizedGainCents,totalGainCents}};
}
async function readSummary({connect,user,game='',currency='USD',now=Date.now,portfolioFor,valuationFor}){
 if(!Number.isSafeInteger(user)||user<1)throw Object.assign(new Error('Authentication required'),{status:401});
 if(!['','pokemon','mtg','lorcana'].includes(game))throw Object.assign(new Error('Unsupported game'),{status:400});
 const makeValuation=valuationFor||require('./reportingValuation').createReportingValuation;
 const getPortfolio=portfolioFor||require('./currentPortfolio').currentPortfolio;
 const db=await connect();let began=false;
 try{
  await db.run('BEGIN');began=true;
  const valuation=makeValuation('USD'),display=makeValuation(currency);
  const portfolio=await getPortfolio(user,game,valuation,db);
  const zone=await require('./portfolioTimeZone').readTimeZone(db);
  const {accounting,spending}=await readDashboardAccounting(db,user,game,valuation,portfolio,require('./performanceHistory').dayAt(now(),zone));
  const money=async n=>n==null?null:Math.sign(n)*(await display.cents(Math.abs(n),'USD'))/100;
  const result={currency:display.target||currency,game,asOf:new Date(now()).toISOString(),recordedAcquisitionSpending:await money(spending.knownCents),spendingUnknownCount:spending.unknownCount,spendingHistoryComplete:false,spendingNote:spending.note,remainingBasis:accounting.unknownBasisCount?null:await money(accounting.remainingBasisCents),knownRemainingBasis:await money(accounting.remainingBasisCents),recordedRemainingInvestment:await money(accounting.recordedRemainingCents),soldBasis:await money(accounting.soldBasisCents),unknownSoldBasisCount:accounting.unknownSoldBasisCount,soldBasisExceedsSpending:accounting.soldBasisCents>spending.knownCents,realizedGain:await money(accounting.realizedGainCents),knownRealizedGain:await money(accounting.knownRealizedGainCents),unrealizedGain:await money(accounting.unrealizedGainCents),totalGain:await money(accounting.totalGainCents),unknownBasisCount:accounting.unknownBasisCount,unknownSaleCount:accounting.unknownSaleCount,unpricedCards:portfolio.cards.filter(card=>!(card.price_trend>0)).reduce((n,card)=>n+(card.quantity||1),0),unpricedSealed:portfolio.sealed.holdings.unpricedUnits||0,unpricedOpeningContents:accounting.extraUnpriced||0,staleRates:!!(valuation.metadata().staleRates||display.metadata().staleRates),returnPct:null,benchmarkAvailable:false};
  await db.run('COMMIT');began=false;return result;
 }catch(e){if(began)await db.run('ROLLBACK').catch(()=>{});throw e;}finally{await db.close();}
}
module.exports={readRecordedSpending,readDashboardAccounting,readSummary};
