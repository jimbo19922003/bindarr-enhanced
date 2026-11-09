'use strict';
const fail=message=>Object.assign(new Error(message),{status:409});
const valid=n=>Number.isSafeInteger(n)&&n>=0;
function openingLineValue(row){
 if(!Number.isSafeInteger(row.quantity)||row.quantity<1)throw fail('Invalid pull quantity; opening allocation needs reconciliation');
 const line=row.opened_line_cents,unit=row.opened_unit_cents;
 if(line!=null&&!valid(line)||unit!=null&&!valid(unit))throw fail('Invalid saved opening-time value');
 const derived=unit==null?null:unit*row.quantity;
 if(derived!=null&&!valid(derived))throw fail('Opening-time line value exceeds its safe range');
 if(line!=null&&derived!=null&&line!==derived)throw fail('Saved opening unit and line values disagree; reconciliation is required');
 return line??derived;
}
function resizeOpeningLine(row,quantity){
 const value=openingLineValue(row);
 if(!Number.isSafeInteger(quantity)||quantity<1)throw fail('Invalid revised pull quantity');
 if(row.opened_line_cents==null)return null;
 if(row.opened_unit_cents!=null){const result=row.opened_unit_cents*quantity;if(!valid(result))throw fail('Revised opening value exceeds its safe range');return result;}
 const denominator=BigInt(row.quantity),result=Number((BigInt(value)*BigInt(quantity)+denominator/2n)/denominator);
 if(!valid(result))throw fail('Revised opening value exceeds its safe range');return result;
}
module.exports={openingLineValue,resizeOpeningLine};
