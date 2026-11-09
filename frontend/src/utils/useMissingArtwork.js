import { useEffect, useState } from 'react';
import { noteArtChanged } from './cardArt';
import { createArtworkRepairClient } from './artworkRepairClient.mjs';
const client=createArtworkRepairClient();
export function useMissingArtwork(cardId,eligible) {
 const [result,setResult]=useState(null);
 useEffect(()=>{if(!eligible||typeof cardId!=='string'||!cardId.startsWith('tcgdex-en-'))return undefined;let live=true;client.repair(cardId).then(value=>{if(!live)return;setResult({id:cardId,value});if(value.state==='available')noteArtChanged(cardId,true);});return ()=>{live=false;};},[cardId,eligible]);
 return result?.id===cardId?result.value:eligible&&typeof cardId==='string'&&cardId.startsWith('tcgdex-en-')?{state:'pending'}:null;
}
