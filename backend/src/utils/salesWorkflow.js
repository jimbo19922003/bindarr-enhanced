'use strict';
function createSalesWorkflow({cards,sealed}) {
  return {async recordSale(userId,{kind,...sale}) {
    if (kind==='card') {
      if (sale.currency && sale.currency!=='USD') throw Object.assign(new Error('Card sales currently use USD'),{status:400});
      return {kind:'card',sale:await cards.recordSale(userId,sale)};
    }
    if (kind==='sealed') return {kind:'sealed',sale:await sealed.recordSale(userId,sale)};
    throw Object.assign(new Error('Choose card or sealed'),{status:400});
  }};
}
module.exports={createSalesWorkflow};
