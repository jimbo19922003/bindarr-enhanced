import { useCallback, useEffect, useRef, useState } from 'react';
import { noteArtChanged } from '../utils/cardArt';
const base='/api/card-art/repair';
const labels={key_missing:'API key missing',key_rejected:'Provider rejected authentication or access',rate_limited:'Provider cooldown',not_found:'No verified printing found',set_unconfirmed:'Set identity could not be confirmed',search_incomplete:'Provider search was incomplete',ambiguous:'Multiple possible matches',image_unavailable:'No accepted artwork candidate',invalid_image:'Image failed validation',upstream:'Provider request failed',card_changed:'Card metadata changed',artwork_store_unavailable:'Local image storage failed'};
const describe=rows=>Array.isArray(rows)?rows.map(row=>`${row.provider}: ${labels[row.status]||'Unavailable'}`).join('; '):'';
export default function ArtworkRecoveryPanel(){
 const [cards,setCards]=useState([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(''),[message,setMessage]=useState('');
 const retryRequest=useRef(null);
 const load=useCallback(async signal=>{try{const response=await fetch(base,{cache:'no-store',signal});if(!response.ok)throw new Error(response.status===409?'Artwork recovery is disabled in this backend.':response.status===401||response.status===403?'Administrator access is required.':'Could not read failed artwork jobs.');const data=await response.json();if(!signal?.aborted){setCards(Array.isArray(data.cards)?data.cards:[]);setLoaded(true);}}catch(error){if(!signal?.aborted)setMessage(error.message);}},[]);
 useEffect(()=>{const controller=new AbortController();load(controller.signal);return ()=>{controller.abort();retryRequest.current?.abort();};},[load]);
 async function retry(id){if(retryRequest.current)return;const controller=new AbortController();retryRequest.current=controller;const signal=controller.signal;setBusy(id);setMessage('Starting artwork recovery.');try{const endpoint=base+'/'+encodeURIComponent(id);let response=await fetch(endpoint+'/retry',{method:'POST',cache:'no-store',signal});let result=await response.json();if(!response.ok&&response.status!==429)throw new Error('Artwork recovery request failed.');let polls=0;while(result.state==='pending'&&polls<40){await new Promise(resolve=>setTimeout(resolve,1500));if(signal.aborted)return;response=await fetch(endpoint,{cache:'no-store',signal});if(!response.ok)throw new Error('Could not read artwork job status.');result=await response.json();polls++;}if(signal.aborted)return;if(result.state==='available'){noteArtChanged(id,true);setMessage('Artwork recovered. Visible card images can now use the local image.');}else if(result.state==='pending')setMessage('The job is still running. Refresh this panel to check it; no second retry was sent.');else if(result.state==='busy')setMessage(result.reason==='manual_retry_limit'?'Retry limit reached. Wait at least one minute before trying again.':'The artwork queue is busy. Try again shortly.');else if(result.state==='unavailable')setMessage(describe(result.attempts)||'No provider supplied verified artwork.');else setMessage('This card is not eligible for artwork recovery.');await load(signal);}catch(error){if(!signal.aborted)setMessage(error.message);}finally{retryRequest.current=null;if(!signal.aborted)setBusy('');}}
 return <section style={{marginTop:'0.75rem'}}>
  <p>Recent artwork failures are listed below. Retry after correcting configuration; provider cooldowns remain enforced. This does not add cards or change their identity.</p>
  <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={()=>load()}>Refresh artwork status</button>
  {loaded&&!cards.length&&<p>No failed artwork jobs are recorded. This is not a complete artwork-coverage check.</p>}
  <ul>{cards.map(card=><li key={card.cardId} style={{marginTop:'0.75rem'}}>
   <code>{card.cardId}</code><p>{describe(card.attempts)}</p>
   {card.retryAt&&<p>Automatic retry allowed after: {new Date(card.retryAt).toLocaleString()}</p>}
   <button type="button" className="btn btn-primary" disabled={!!busy} onClick={()=>retry(card.cardId)}>{busy===card.cardId?'Recovering…':'Retry artwork'}</button>
  </li>)}</ul>
  {message&&<p role="status">{message}</p>}
  <p>Manual retry is limited to once per card per minute and ten cards per minute per instance. Only the selected card’s negative job cache is expired; provider response caches and quota records are preserved.</p>
 </section>;
}
