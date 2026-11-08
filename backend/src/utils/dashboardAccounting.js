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
 if((!game||game==='pokemon')&&await has('sealed_lot'))for(const lot of await db.all('SELECT total_cost_cents,currency FROM sealed_lot WHERE user_id=?',[user])){
  if(!valid(lot.total_cost_cents)){unknownCount++;continue;}const cost=await valuation.cents(lot.total_cost_cents,lot.currency);if(!valid(cost))unknownCount++;else knownCents=add(knownCents,cost);
 }
 return {knownCents,unknownCount,historyComplete:false,basis:'retained-acquisition-records',note:'Includes retained owned/sold card purchases and sealed lots, including archived lots. Rip contents are not a second purchase. Deleted purchases, missing costs, and unrecorded purchases may be absent; this is not a certified lifetime or net-contribution total.'};
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
  let zone=process.env.PORTFOLIO_TIMEZONE||'UTC';try{new Intl.DateTimeFormat('en-US',{timeZone:zone});}catch{zone='UTC';}
  const accounting=await readAccounting(db,user,game,valuation,portfolio,require('./performanceHistory').dayAt(now(),zone));
  const spending=await readRecordedSpending(db,user,game,valuation);
  const money=async n=>n==null?null:Math.sign(n)*(await display.cents(Math.abs(n),'USD'))/100;
  const result={currency:display.target||currency,game,asOf:new Date(now()).toISOString(),recordedAcquisitionSpending:await money(spending.knownCents),spendingUnknownCount:spending.unknownCount,spendingHistoryComplete:false,spendingNote:spending.note,remainingBasis:accounting.unknownBasisCount?null:await money(accounting.remainingBasisCents),knownRemainingBasis:await money(accounting.remainingBasisCents),realizedGain:await money(accounting.realizedGainCents),knownRealizedGain:await money(accounting.knownRealizedGainCents),unrealizedGain:await money(accounting.unrealizedGainCents),totalGain:await money(accounting.totalGainCents),unknownBasisCount:accounting.unknownBasisCount,unknownSaleCount:accounting.unknownSaleCount,staleRates:!!(valuation.metadata().staleRates||display.metadata().staleRates),returnPct:null,benchmarkAvailable:false};
  await db.run('COMMIT');began=false;return result;
 }catch(e){if(began)await db.run('ROLLBACK').catch(()=>{});throw e;}finally{await db.close();}
}
module.exports={readRecordedSpending,readSummary};
