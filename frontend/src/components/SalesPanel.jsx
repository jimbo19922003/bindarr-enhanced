import {useEffect,useState} from 'react';
import './SalesPanel.css';
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const cents=text=>{if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw new Error('Enter nonnegative amounts with up to two decimals.');const [whole,fraction='']=text.split('.');const n=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Amount is too large.');return Number(n);};
const money=(value,currency)=>value==null?'Unknown':new Intl.NumberFormat(undefined,{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);
async function request(url,body,signal){const res=await fetch(url,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal,cache:'no-store'});const data=await res.json();if(!res.ok)throw new Error(data.error||'Sales request failed');return data;}
export default function SalesPanel({statsTrigger,onUpdate,showToast}) {
 const [open,setOpen]=useState(false),[kind,setKind]=useState('card'),[query,setQuery]=useState(''),[items,setItems]=useState([]),[selected,setSelected]=useState('');
 const [quantity,setQuantity]=useState('1'),[proceeds,setProceeds]=useState(''),[fees,setFees]=useState('0'),[soldOn,setSoldOn]=useState(today);
 const [preview,setPreview]=useState(null),[ack,setAck]=useState(false),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [history,setHistory]=useState({entries:[],groups:[],nextCursor:null}),[historyError,setHistoryError]=useState('');
 const item=items.find(r=>String(r.id)===selected);
 useEffect(()=>{const listener=()=>setOpen(true);window.addEventListener('bindarr_open_sales',listener);return()=>window.removeEventListener('bindarr_open_sales',listener);},[]);
 useEffect(()=>{let current=true;request('/api/sales/history').then(data=>{if(current)setHistory(data);}).catch(err=>{if(current)setHistoryError(err.message);});return()=>{current=false;};},[statsTrigger]);
 useEffect(()=>{if(!open)return;const controller=new AbortController();const timer=setTimeout(()=>{request(`/api/sales/items?${new URLSearchParams({kind,q:query})}`,null,controller.signal).then(setItems).catch(err=>{if(err.name!=='AbortError')setError(err.message);});},200);return()=>{clearTimeout(timer);controller.abort();};},[open,kind,query,statsTrigger]);
 const clearReview=()=>{setPreview(null);setAck(false);setKey('');setError('');};
 const change=(setter,value)=>{setter(value);clearReview();};
 function payload(){if(!item)throw new Error('Select an exact copy or purchase lot.');return {kind,id:item.id,quantity:kind==='card'?1:Number(quantity),proceedsCents:cents(proceeds),feesCents:cents(fees),currency:item.currency,soldOn};}
 async function review(event){event.preventDefault();setBusy(true);setError('');try{const result=await request('/api/sales/preview',payload());setPreview(result);setKey(crypto.randomUUID());setAck(false);}catch(err){setError(err.message);}finally{setBusy(false);}}
 async function confirm(){setBusy(true);setError('');try{const result=await request('/api/sales',{...payload(),confirmed:true,previewToken:preview.previewToken,requestKey:key,allowUnknownBasis:ack});showToast?.(`Sale recorded: ${result.itemName}`);setPreview(null);setSelected('');setProceeds('');setOpen(false);onUpdate?.();window.dispatchEvent(new Event('bindarr_sales_changed'));setHistory(await request('/api/sales/history'));}catch(err){setError(err.message);}finally{setBusy(false);}}
 async function more(){try{const next=await request(`/api/sales/history?beforeId=${history.nextCursor}`);setHistory(old=>({...next,entries:[...old.entries,...next.entries]}));}catch(err){setHistoryError(err.message);}}
 return <section className="glass-panel sales-panel">
  <header><h3 className="chart-title">Sales</h3><button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>setOpen(v=>!v)}>{open?'Close':'Record sale'}</button></header>
  {open&&<form onSubmit={review}>
   <fieldset disabled={busy}><legend className="sales-sr-only">Sale details</legend>
    <div className="sales-kind" role="group" aria-label="Item type">{[['card','Single card'],['sealed','Sealed product']].map(([id,label])=><button type="button" key={id} className={`btn ${kind===id?'btn-primary':'btn-secondary'}`} aria-pressed={kind===id} onClick={()=>{change(setKind,id);setSelected('');setItems([]);setQuantity('1');}}>{label}</button>)}</div>
    <div className="sales-form-grid">
     <label>Find item<input value={query} onChange={e=>{change(setQuery,e.target.value);setSelected('');}} placeholder="Search by name" /></label>
     <label className="sales-item-select">{kind==='card'?'Exact card copy':'Purchase lot'}<select value={selected} required onChange={e=>change(setSelected,e.target.value)}><option value="">Select an item</option>{items.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
     <label>Sale date<input type="date" required value={soldOn} onChange={e=>change(setSoldOn,e.target.value)} /></label>
     <label>Quantity<input type="number" min="1" max={item?.available||1} step="1" required readOnly={kind==='card'} value={kind==='card'?'1':quantity} onChange={e=>change(setQuantity,e.target.value)} /></label>
     <label>Total proceeds ({item?.currency||'currency'})<input inputMode="decimal" required value={proceeds} onChange={e=>change(setProceeds,e.target.value)} placeholder="0.00" /></label>
     <label>Total fees ({item?.currency||'currency'})<input inputMode="decimal" required value={fees} onChange={e=>change(setFees,e.target.value)} /></label>
    </div>
    <small>Select the actual copy or lot sold. No automatic FIFO. Proceeds and fees are totals, not per-unit amounts.</small>
    {!preview&&<button className="btn btn-primary" type="submit">Review sale</button>}
   </fieldset>
   {preview&&<div className="sales-review"><h4>Review: {preview.itemName}</h4><dl><div><dt>Net proceeds</dt><dd>{money(preview.netProceedsCents,preview.currency)}</dd></div><div><dt>Cost basis · {preview.source}</dt><dd>{money(preview.soldBasisCents,preview.currency)}</dd></div><div><dt>Realized Loss/Gain</dt><dd>{money(preview.realizedGainCents,preview.currency)}</dd></div></dl>
    {preview.realizedGainCents==null&&<label className="sales-ack"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)} />Basis is unknown. Record proceeds without calculating profit. Unfinalized pack pulls are not treated as free.</label>}
    <button className="btn btn-primary" type="button" disabled={busy||(preview.realizedGainCents==null&&!ack)} onClick={confirm}>{busy?'Saving...':'Confirm sale'}</button><button className="btn btn-secondary" type="button" disabled={busy} onClick={clearReview}>Back to details</button>
   </div>}
  </form>}
  {error&&<p role="alert">{error}</p>}
  <details className="sales-history"><summary>Sale history{history.entries.length?` · ${history.entries.length} loaded`:''}</summary>
   {historyError&&<p role="alert">{historyError}</p>}
   {history.groups.map(g=><p key={g.currency}>{g.currency}: known realized {money(g.knownGainCents,g.currency)} · {g.unknownCount} sale(s) with unknown basis</p>)}
   {!history.entries.length?<p>No recorded sales yet.</p>:<div className="sales-table-scroll"><table><thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Net proceeds</th><th>Basis</th><th>Loss/Gain</th></tr></thead><tbody>{history.entries.map(r=><tr key={r.historyId}><td>{r.soldOn}</td><td>{r.itemName} · {r.kind}</td><td>{r.quantity}</td><td>{money(r.netProceedsCents,r.currency)}</td><td>{money(r.soldBasisCents,r.currency)}</td><td>{money(r.realizedGainCents,r.currency)}</td></tr>)}</tbody></table></div>}
   {history.nextCursor&&<button type="button" className="btn btn-secondary" onClick={more}>Load more</button>}
   <small>Sale history is preserved. Editing or reversing sales requires a correction workflow, which is not available in this version.</small>
  </details>
 </section>;
}
