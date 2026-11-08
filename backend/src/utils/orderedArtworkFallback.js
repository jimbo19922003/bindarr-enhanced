'use strict';
const known=new Set(['key_missing','key_rejected','rate_limited','not_found','set_unconfirmed','search_incomplete','ambiguous','image_unavailable','invalid_image','unsupported_language_or_game','upstream','card_changed','artwork_store_unavailable']);
async function orderedArtworkFallback(card,{carddex,pokewallet,download=false,accept}){
 const attempts=[];
 for(const [provider,client] of [['carddex',carddex],['pokewallet',pokewallet]]){
  try{const candidate=await client.lookup(card);if(!candidate){attempts.push({provider,status:'image_unavailable'});continue;}const bytes=download?await client.image(candidate):null;const accepted=download&&accept?await accept(bytes,candidate):undefined;attempts.push({provider,status:download?'downloaded':'matched'});return {candidate:{...candidate,provider},bytes,attempts,accepted};}
  catch(error){attempts.push({provider,status:known.has(error.code)?error.code:'upstream'});if(['card_changed','artwork_store_unavailable'].includes(error.code))throw Object.assign(new Error(error.code),{code:error.code,attempts});}
 }
 throw Object.assign(new Error('artwork_unavailable'),{code:'artwork_unavailable',attempts});
}
module.exports={orderedArtworkFallback};
