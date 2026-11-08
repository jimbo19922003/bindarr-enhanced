import { useEffect, useRef, useState } from 'react';
import { artUrl, noteArtChanged, useCardArtIndex } from '../utils/cardArt';
import { issueUrl } from '../utils/repo';
import { useT } from '../utils/i18n';
const MAX_BYTES=8*1024*1024;
function isAdmin(){try{return JSON.parse(localStorage.getItem('bindarr_user')||'null')?.role==='admin';}catch{return false;}}
export default function CardArtEditor({card,hasProviderArt,showToast,onChanged}){
 const {t}=useT(),index=useCardArtIndex(),fileRef=useRef(null),controller=useRef(null);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const cardId=card?.card_id||card?.id,canEdit=isAdmin(),hasCustom=!!cardId&&index.has(cardId);
 const label=(key,fallback)=>{const value=t(key);return value&&value!==key?value:fallback;};
 useEffect(()=>()=>controller.current?.abort(),[cardId]);
 if(!cardId||!canEdit&&!hasCustom)return null;
 const report=text=>{setMessage(text);showToast?.(text);};
 async function upload(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;if(!file.type.startsWith('image/'))return report(label('art.notAnImage','Choose an image file.'));if(file.size>MAX_BYTES)return report(label('art.tooLarge','Image must be at most 8 MB.'));setBusy(true);try{const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error());reader.readAsDataURL(file);});const response=await fetch('/api/card-art/'+encodeURIComponent(cardId),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image})});if(!response.ok)throw new Error();noteArtChanged(cardId,true);onChanged?.();report(label('art.saved','Artwork saved for this printing.'));}catch{report(label('art.saveFailed','Could not save artwork.'));}finally{setBusy(false);}}
 async function remove(){if(!window.confirm('Remove this instance’s artwork override? Bundled or provider artwork may become visible again.'))return;setBusy(true);try{const response=await fetch('/api/card-art/'+encodeURIComponent(cardId),{method:'DELETE'});if(!response.ok)throw new Error();const result=await response.json();noteArtChanged(cardId,!!result.hasBundled);onChanged?.();report(label('art.removed','Local artwork override removed.'));}catch{report(label('art.removeFailed','Could not remove artwork.'));}finally{setBusy(false);}}
 async function retry(){setBusy(true);setMessage('Checking configured artwork providers.');const request=new AbortController();controller.current=request;try{const endpoint='/api/card-art/repair/'+encodeURIComponent(cardId);let response=await fetch(endpoint+'/retry',{method:'POST',cache:'no-store',signal:request.signal});let result=await response.json();if(!response.ok){report(response.status===429?'Retry is limited. Wait at least one minute.':response.status===409?'Artwork recovery is disabled in this backend.':'Could not start artwork recovery.');return;}for(let poll=0;result.state==='pending'&&poll<40;poll++){await new Promise(resolve=>setTimeout(resolve,1500));if(request.signal.aborted)return;response=await fetch(endpoint,{cache:'no-store',signal:request.signal});if(!response.ok)throw new Error();result=await response.json();}if(request.signal.aborted)return;if(result.state==='available'){noteArtChanged(cardId,true);onChanged?.();report('Artwork is available for this printing.');}else if(result.state==='pending')report('The job is still running. Check Artwork recovery in Admin.');else if(result.state==='not_eligible')report('This printing is not eligible for automatic repair. You can upload a verified image instead.');else report('No verified artwork was recovered. Check the provider results in Admin, or upload the correct image.');}catch{if(!request.signal.aborted)report('Artwork recovery request failed.');}finally{if(!request.signal.aborted)setBusy(false);}}
 async function contribute(){setBusy(true);try{const response=await fetch(artUrl(cardId));if(!response.ok)throw new Error();const blob=await response.blob(),href=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=href;anchor.download=cardId+'.png';document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(href),10000);window.open(issueUrl({labels:'card-art',title:'[Card art] '+(card.name||cardId),body:['Proposed artwork for this printing.','',`Card ID: ${cardId}`,`Name: ${card.name||''}`,`Set: ${card.set_name||''} (${card.set_id||''})`,`Number: ${card.number||''}`,`Language: ${card.language||''}`,'','Attach the downloaded PNG only if you have the right to share it. Review and submit this issue yourself.'].join('\n')}),'_blank','noopener');}catch{report(label('art.shareFailed','Could not prepare the artwork contribution.'));}finally{setBusy(false);}}
 return <div style={{marginTop:'0.75rem',width:'100%'}}>
  <button type="button" className="btn btn-secondary" aria-expanded={open} onClick={()=>setOpen(value=>!value)} disabled={busy}>{canEdit?'Change artwork':'Artwork actions'}</button>
  {open&&<div style={{marginTop:'0.75rem',display:'flex',flexDirection:'column',gap:'0.5rem'}}>
   <p>Artwork only: this does not change the printing, collection entry or price match. An override applies to everyone on this instance. Verify the set, number and language before uploading.</p>
   {canEdit&&<>
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} style={{display:'none'}} />
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>fileRef.current?.click()}>{hasCustom||hasProviderArt?label('art.replace','Upload replacement image'):label('art.add','Upload correct image')}</button>
    {!hasCustom&&!hasProviderArt&&String(cardId).startsWith('tcgdex-en-')&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={retry}>Retry missing artwork</button>}
    {hasCustom&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={remove}>{label('art.remove','Remove local override')}</button>}
   </>}
   {hasCustom&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={contribute}>{label('art.contribute','Prepare artwork contribution')}</button>}
   {busy&&<p role="status">Working…</p>}
   {message&&<p role="status">{message}</p>}
  </div>}
 </div>;
}
