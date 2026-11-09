'use strict';
const valid=n=>Number.isSafeInteger(n)&&n>=0;
function linkedIds(pull){const raw=String(pull.filed_ids||'').split(',').map(value=>value.trim()).filter(Boolean);if(raw.some(value=>! /^[1-9][0-9]*$/.test(value)||!Number.isSafeInteger(Number(value))))return null;return raw.map(Number);}
function wholeOpeningBasis(opening,pulls,ownedById,byLot,allPulls){
 if(opening.entry_complete!==1||opening.currency!=='USD'||!valid(opening.cost_cents)||!pulls.length)return null;
 const links=new Map();
 for(const pull of allPulls){const ids=linkedIds(pull);if(!ids)return null;for(const id of [...ids,...(pull.collection_id==null?[]:[pull.collection_id])]){if(!links.has(id))links.set(id,new Set());links.get(id).add(pull.opening_id);}}
 const copies=new Set();
 for(const pull of pulls){
  if(pull.opening_id!==opening.id||pull.user_id!==opening.user_id||!pull.card_id||!Number.isSafeInteger(pull.quantity)||pull.quantity<1)return null;
  const ids=linkedIds(pull);if(!ids||ids.length!==pull.quantity||!ids.length||pull.collection_id!=null&&!ids.includes(pull.collection_id))return null;
  for(const id of ids){const card=ownedById.get(id),source=links.get(id);if(copies.has(id)||!card||card.quantity!==1||card.list_type!=='collection'||card.card_id!==pull.card_id||card.user_id!=null&&card.user_id!==opening.user_id||byLot.has(id)||Number(card.purchase_price||0)>0||source?.size!==1||!source.has(opening.id))return null;copies.add(id);}
 }
 return {costCents:opening.cost_cents,copyIds:[...copies],allocationStatus:'pending'};
}
module.exports={wholeOpeningBasis};
