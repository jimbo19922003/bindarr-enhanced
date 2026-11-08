// sale-adjustments-v1
import {useEffect,useState} from 'react';
import {Bar,BarChart,CartesianGrid,Legend,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {getCurrency} from '../utils/formatPrice';
import './SalesPanel.css';
import './SalesWorkflow.css';
import SaleAdjustmentDialog from './SaleAdjustmentDialog';
const currencies=['USD','EUR','GBP','CAD','AUD','JPY'];
const money=(n,c)=>n==null?'Unknown':new Intl.NumberFormat(undefined,{style:'currency',currency:c,minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100);
async function read(params,signal){const response=await fetch(`/api/sales/history?${params}`,{signal,cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load sales');return data;}
export default function SalesHistory({statsTrigger}) {
 const [adjustment,setAdjustment]=useState(null);
 const [kind,setKind]=useState(''),[currency,setCurrency]=useState(()=>getCurrency()),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [report,setReport]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const params=new URLSearchParams();if(kind)params.set('kind',kind);if(currency)params.set('currency',currency);if(from)params.set('from',from);if(to)params.set('to',to);
 const query=params.toString();
 useEffect(()=>{const controller=new AbortController();let current=true;setBusy(true);setReport(null);setError('');read(query,controller.signal).then(data=>{if(current)setReport(data);}).catch(e=>{if(current&&e.name!=='AbortError')setError(e.message);}).finally(()=>{if(current)setBusy(false);});return()=>{current=false;controller.abort();};},[query,statsTrigger,refresh]);
 async function more(){setBusy(true);try{const p=new URLSearchParams(query);p.set('beforeId',report.nextCursor);const next=await read(p);setReport(old=>({...next,entries:[...old.entries,...next.entries]}));}catch(e){setError(e.message);}finally{setBusy(false);}}
 const chart=(report?.months||[]).filter(r=>r.currency===currency).map(r=>({...r,net:r.netCents/100,gain:r.knownGainCents/100}));
 return <div className="sales-report">
  {adjustment&&<SaleAdjustmentDialog key={`${adjustment.row.historyId}-${adjustment.action}`} {...adjustment} onClose={()=>setAdjustment(null)} onDone={()=>{setAdjustment(null);setRefresh(n=>n+1);}}/>}
  <header className="sales-report-heading"><h2>Sales History</h2><button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Refresh</button></header>
  <div className="glass-panel sales-report-filters">
   <label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
   <label>Type<select value={kind} onChange={e=>setKind(e.target.value)}><option value="">All items</option><option value="card">Cards</option><option value="sealed">Sealed</option></select></label>
   <label>Currency<select value={currency} onChange={e=>setCurrency(e.target.value)}><option value="">All currencies (separate)</option>{currencies.map(c=><option key={c}>{c}</option>)}</select></label>
  </div>
  {error&&<p role="alert">{error}</p>}{busy&&!report&&<p role="status">Loading sales...</p>}
  {report?.groups.map(g=><section className="glass-panel sales-report-summary" key={g.currency}><h3>{g.currency} · {g.count} sale(s)</h3><dl>{[['Gross proceeds',g.grossCents],['Fees',g.feesCents],['Net proceeds',g.netCents],['Known cost basis',g.basisCents],['Known realized Loss/Gain',g.count===g.unknownCount?null:g.knownGainCents]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money(value,g.currency)}</dd></div>)}</dl>{g.unknownCount>0&&<small>{g.unknownCount} sale(s) have unknown basis and are excluded from calculated profit.</small>}</section>)}
  {!!chart.length&&currency&&<section className="glass-panel sales-monthly"><h3>Monthly sales · {currency}</h3><div style={{height:260,minWidth:0}}><ResponsiveContainer width="100%" height="100%"><BarChart data={chart}><CartesianGrid vertical={false} stroke="var(--border-glass)"/><XAxis dataKey="month"/><YAxis width={80} tickFormatter={value=>money(value*100,currency)}/><Tooltip formatter={(value,name)=>[money(value*100,currency),name]} contentStyle={{background:'var(--bg-secondary)',borderColor:'var(--border-glass)'}}/><Legend/><Bar dataKey="net" name="Net proceeds" fill="#3b82f6"/><Bar dataKey="gain" name="Known realized Loss/Gain" fill="#10b981"/></BarChart></ResponsiveContainer></div></section>}
  {report&&<section className="glass-panel sales-panel"><h3>Transactions</h3>{!report.entries.length?<p>No sales match these filters.</p>:<div className="sales-table-scroll"><table><thead><tr><th>Sale date</th><th>Item</th><th>Type</th><th>Qty</th><th>Gross</th><th>Fees</th><th>Net</th><th>Basis</th><th>Loss/Gain</th><th>Status / actions</th></tr></thead><tbody>{report.entries.map(r=><tr key={r.historyId}><td>{r.soldOn}</td><td>{r.itemName}</td><td>{r.kind}</td><td>{r.quantity}</td><td>{money(r.proceedsCents,r.currency)}</td><td>{money(r.feesCents,r.currency)}</td><td>{money(r.netProceedsCents,r.currency)}</td><td>{money(r.soldBasisCents,r.currency)}</td><td>{money(r.realizedGainCents,r.currency)}</td><td><div>{r.saleStatus||'active'} · revision {r.revision||0}</div><button type="button" className="btn btn-secondary" onClick={()=>setAdjustment({row:r,action:'audit'})}>Audit</button>{r.saleStatus!=='undone'&&<><button type="button" className="btn btn-secondary" onClick={()=>setAdjustment({row:r,action:'correct'})}>Correct</button><button type="button" className="btn btn-secondary" onClick={()=>setAdjustment({row:r,action:'undo'})}>Undo</button></>}</td></tr>)}</tbody></table></div>}{report.nextCursor&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={more}>Load more</button>}<details><summary>Reporting notes</summary><p>Filters apply to sale dates; totals cover all matching records, not just the loaded page. Currencies stay separate with no FX conversion. Unknown-basis proceeds are included in sales totals, but no profit is invented. Corrected sales use their latest financial details. Undone sales remain visible for audit but are excluded from active totals. Saved historical timeline snapshots are not rewritten.</p></details></section>}
 </div>;
}
