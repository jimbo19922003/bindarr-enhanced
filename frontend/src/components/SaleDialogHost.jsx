// sale-adjustments-v1
// completed-rip-basis-v1
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {useBackGuard} from '../utils/useBackGuard';
import './SalesPanel.css';
import './SalesWorkflow.css';
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const cents=text=>{if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw new Error('Use nonnegative amounts with up to two decimals.');const [w,f='']=text.split('.');const n=BigInt(w)*100n+BigInt(f.padEnd(2,'0'));if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Amount is too large');return Number(n);};
const money=(n,c)=>n==null?'Unknown':new Intl.NumberFormat(undefined,{style:'currency',currency:c,minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100);
async function post(url,body){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error||'Sales request failed');return result;}
const requestKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
export default function SaleDialogHost({showToast}) {
 const [target,setTarget]=useState(null),[date,setDate]=useState(today),[quantity,setQuantity]=useState('1'),[proceeds,setProceeds]=useState(''),[fees,setFees]=useState('0');
 const [preview,setPreview]=useState(null),[ack,setAck]=useState(false),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dialog=useRef(null),previousFocus=useRef(null),saving=useRef(false);
 const close=()=>{if(saving.current)return;setTarget(null);setTimeout(()=>{if(previousFocus.current?.isConnected)previousFocus.current.focus();},0);};
 useBackGuard(!!target,close);
 useEffect(()=>{const open=event=>{const t=event.detail;if(saving.current||!t||!['card','sealed'].includes(t.kind)||!Number.isSafeInteger(t.id)||t.id<1)return;previousFocus.current=document.activeElement;setTarget(t);setDate(today());setQuantity('1');setProceeds('');setFees('0');setPreview(null);setAck(false);setKey('');setError('');};window.addEventListener('bindarr_sell_item',open);return()=>window.removeEventListener('bindarr_sell_item',open);},[]);
 useEffect(()=>{if(!target)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';dialog.current?.focus();return()=>{document.body.style.overflow=previous;};},[target]);
 const reset=()=>{setPreview(null);setKey('');setAck(false);setError('');};
 function payload(){return {kind:target.kind,id:target.id,quantity:target.kind==='card'?1:Number(quantity),proceedsCents:cents(proceeds),feesCents:cents(fees),currency:target.currency,soldOn:date};}
 async function review(event){event.preventDefault();setBusy(true);saving.current=true;setError('');try{const result=await post('/api/sales/preview',payload());setPreview(result);setKey(requestKey());setAck(false);}catch(e){setError(e.message);}finally{setBusy(false);saving.current=false;}}
 async function confirm(){setBusy(true);saving.current=true;setError('');let result;try{result=await post('/api/sales',{...payload(),confirmed:true,previewToken:preview.previewToken,requestKey:key,allowUnknownBasis:ack});}catch(e){setError(e.message);}finally{setBusy(false);saving.current=false;}if(result){setTarget(null);showToast?.(`Sale recorded: ${result.itemName}`);window.dispatchEvent(new Event('bindarr_sales_changed'));try{await target.onSold?.(result);}catch(e){console.warn('Sale saved; inventory view refresh failed',e);}if(previousFocus.current?.isConnected)previousFocus.current.focus();}}
 function keyboard(event){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}if(event.key==='Tab'){const nodes=dialog.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]');const first=nodes[0],last=nodes[nodes.length-1];if(!first)return;if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first.focus();}}}
 if(!target)return null;
 return createPortal(<div className="sale-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
  <div className="glass-panel sale-dialog sales-panel" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="sale-dialog-title" aria-busy={busy} tabIndex={-1} onKeyDown={keyboard}>
   <header><div><h3 id="sale-dialog-title">{target.kind==='card'?'Sell this copy':'Sell from this lot'}</h3><small>{target.label}</small></div><button type="button" className="btn btn-secondary" aria-label="Close sale dialog" disabled={busy} onClick={close}><X size={18}/></button></header>
   <form onSubmit={review}><fieldset disabled={busy||!!preview}><legend className="sales-sr-only">Sale details</legend><div className="sales-form-grid">
    <label>Sale date<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label>Quantity<input type="number" min="1" max={target.available} step="1" required readOnly={target.kind==='card'} value={target.kind==='card'?'1':quantity} onChange={e=>setQuantity(e.target.value)}/></label>
    <label>Total proceeds ({target.currency})<input inputMode="decimal" required value={proceeds} onChange={e=>setProceeds(e.target.value)} placeholder="0.00"/></label>
    <label>Total fees ({target.currency})<input inputMode="decimal" required value={fees} onChange={e=>setFees(e.target.value)}/></label>
   </div></fieldset>
   {!preview&&<button type="submit" className="btn btn-primary" disabled={busy}>Review sale</button>}
   {preview&&<div className="sales-review"><dl><div><dt>Net proceeds</dt><dd>{money(preview.netProceedsCents,preview.currency)}</dd></div><div><dt>Cost basis · {preview.source}</dt><dd>{money(preview.soldBasisCents,preview.currency)}</dd></div><div><dt>Realized Loss/Gain</dt><dd>{money(preview.realizedGainCents,preview.currency)}</dd></div></dl>
    {preview.willFreezeOpening&&<small>Confirming also freezes this completed rip&apos;s cost allocation. Its acquisition details cannot be edited without a correction workflow.</small>}
    {preview.basisReason&&<small>{preview.basisReason}</small>}
    {preview.realizedGainCents==null&&<label className="sales-ack"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>Basis is unknown. Record proceeds without calculating profit; pack pulls are not treated as free.</label>}
    <div className="sales-confirm-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={reset}>Back</button><button type="button" className="btn btn-primary" disabled={busy||(preview.realizedGainCents==null&&!ack)} onClick={confirm}>{busy?'Saving...':'Confirm sale'}</button></div>
   </div>}
   {error&&<p role="alert">{error} Retry here or check Sales History before starting a new sale.</p>}
   <small>Totals, not per-unit prices. The selected copy/lot is fixed. No automatic FIFO. Correction and guarded undo are available in Sales History.</small>
   </form>
  </div>
 </div>,document.body);
}
