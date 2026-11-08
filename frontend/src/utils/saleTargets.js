export function cardSaleTarget(card) {
 if(!card || ['wishlist','sold'].includes(card.list_type)) return null;
 const id=Number.isSafeInteger(card.entry_id)?card.entry_id:Number.isSafeInteger(card.id)&&card.card_id?card.id:null;
 if(!id||id<1) return null;
 return {kind:'card',id,label:`${card.name || 'Card'} · copy #${id}`,currency:'USD',available:1};
}
export function sealedSaleTarget(lot,product) {
 if(!lot||lot.archived_at||product?.archived_at||!Number.isSafeInteger(lot.id)||lot.id<1||!Number.isSafeInteger(lot.remaining_quantity)||lot.remaining_quantity<1)return null;
 return {kind:'sealed',id:lot.id,label:`${product?.name || 'Sealed product'} · lot #${lot.id}`,currency:lot.currency,available:lot.remaining_quantity};
}
