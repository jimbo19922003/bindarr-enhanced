'use strict';
const bad=message=>Object.assign(new Error(message),{status:400});
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
async function readReport(db,user,filters={}) {
 const beforeId=filters.beforeId==null?Number.MAX_SAFE_INTEGER:Number(filters.beforeId),limit=filters.limit==null?25:Number(filters.limit);
 if(!Number.isSafeInteger(beforeId)||beforeId<1||!Number.isSafeInteger(limit)||limit<1||limit>100)throw bad('Invalid history cursor');
 const clauses=['user_id=?'],params=[user];
 if(filters.kind){if(!['card','sealed'].includes(filters.kind))throw bad('Invalid sale type');clauses.push('kind=?');params.push(filters.kind);}
 if(filters.currency){if(!['USD','EUR','GBP','CAD','AUD','JPY'].includes(filters.currency))throw bad('Invalid currency');clauses.push('currency=?');params.push(filters.currency);}
 if(filters.from){if(!date(filters.from))throw bad('Invalid start date');clauses.push('sold_on>=?');params.push(filters.from);}
 if(filters.to){if(!date(filters.to))throw bad('Invalid end date');clauses.push('sold_on<=?');params.push(filters.to);}
 if(filters.from&&filters.to&&filters.from>filters.to)throw bad('Start date must not follow end date');
 if(!await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sales_entry'"))return {entries:[],groups:[],months:[],nextCursor:null};
 const source=await require('./saleAdjustments').effectiveSource(db,'sales_entry',true);
 const where=clauses.join(' AND ');
 const sums="COUNT(*) AS count,SUM(CASE WHEN gain_cents IS NULL THEN 1 ELSE 0 END) AS unknownCount,SUM(COALESCE(gain_cents,0)) AS knownGainCents,SUM(COALESCE(json_extract(response_json,'$.proceedsCents'),0)) AS grossCents,SUM(COALESCE(json_extract(response_json,'$.feesCents'),0)) AS feesCents,SUM(COALESCE(json_extract(response_json,'$.netProceedsCents'),0)) AS netCents,SUM(COALESCE(json_extract(response_json,'$.soldBasisCents'),0)) AS basisCents";
 const rows=await db.all(`SELECT id,response_json FROM ${source} WHERE ${where} AND id<? ORDER BY id DESC LIMIT ?`,[...params,beforeId,limit]);
 const groups=await db.all(`SELECT currency,${sums} FROM ${source} WHERE ${where} AND sale_status='active' GROUP BY currency`,params);
 const months=await db.all(`SELECT substr(sold_on,1,7) AS month,currency,${sums} FROM ${source} WHERE ${where} AND sale_status='active' GROUP BY month,currency ORDER BY month,currency`,params);
 for(const row of [...groups,...months])for(const key of ['count','unknownCount','knownGainCents','grossCents','feesCents','netCents','basisCents'])if(!Number.isSafeInteger(row[key]))throw Object.assign(new Error('Sales totals exceed safe numeric range'),{status:500});
 return {entries:rows.map(r=>({historyId:r.id,...JSON.parse(r.response_json)})),groups,months,nextCursor:rows.length===limit?rows[rows.length-1].id:null};
}
module.exports={readReport};
