export function createZeroCostFetch(request,confirm){
 return async function(input,options={}){
  const path=typeof input==='string'?input.split('?')[0]:'';
  if(String(options.method||'GET').toUpperCase()!=='POST'||!['/api/collection','/api/collection/bulk-add'].includes(path)||typeof options.body!=='string'||options.signal?.aborted)return request(input,options);
  let body;try{body=JSON.parse(options.body);}catch{return request(input,options);}
  if(!body||Array.isArray(body)||typeof body!=='object')return request(input,options);
  const value=body.purchase_price;
  const explicit=value!==null&&value!==undefined&&['string','number'].includes(typeof value)&&String(value).trim()!=='';
  if(!explicit||Number(value)!==0||body.zero_cost_confirmed===true)return request(input,options);
  const cards=Array.isArray(body.card_ids)?body.card_ids.length:1,quantity=Math.max(1,parseInt(body.quantity,10)||1);
  const message=`Confirm zero purchase cost\n\nYou entered 0.00 per copy for ${cards*quantity} card copy/copies.\n\nIf these cards were gifts or obtained for free, confirm to record a known zero cost basis. Otherwise cancel and enter the amount paid.\n\nMarket value still counts toward your portfolio. Percentage return is not available when the cost basis is zero.`;
  if(!await confirm(message))return new Response(JSON.stringify({error:'Card not added. Zero purchase cost was not confirmed.',code:'ZERO_COST_CANCELLED'}),{status:409,headers:{'Content-Type':'application/json'}});
  return request(input,{...options,body:JSON.stringify({...body,zero_cost_confirmed:true})});
 };
}
export function installZeroCostConfirmation(target){const original=target.fetch.bind(target);target.fetch=createZeroCostFetch(original,message=>target.confirm(message));}
