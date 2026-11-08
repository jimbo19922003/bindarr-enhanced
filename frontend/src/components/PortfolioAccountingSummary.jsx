import {useEffect,useState} from 'react';
import {Coins,ArrowUpRight} from 'lucide-react';
import {useT} from '../utils/i18n';
export default function PortfolioAccountingSummary({statsTrigger,game='',currency='USD'}){
 const {locale}=useT();
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();let current=true;setData(null);setError('');const params=new URLSearchParams({game,currency});fetch(`/api/stats/accounting?${params}`,{signal:controller.signal,cache:'no-store'}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||'Could not load portfolio accounting');return body;}).then(body=>{if(current)setData(body);}).catch(e=>{if(current&&e.name!=='AbortError')setError(e.message);});return()=>{current=false;controller.abort();};},[statsTrigger,game,currency]);
 const money=value=>value==null?'Unknown':new Intl.NumberFormat(locale,{style:'currency',currency:data?.currency||currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
 const cells=[
  ['Total Lifetime Spend','recordedAcquisitionSpending','Total recorded purchase spending, including retained sold-card purchases and archived sealed purchases. Sales do not reduce spending; rip contents are not counted as a second purchase. Deleted or unrecorded purchases may be missing.'],
  ['Unrealized Loss/Gain Total','unrealizedGain','Current holdings value less the acquisition cost of items still owned.'],
  ['Realized Loss/Gain Total','realizedGain','Cumulative net sale proceeds less sold-item acquisition cost, including corrections and excluding undone sales.']
 ];
 return <>{cells.map(([title,key,note])=>{const gain=key!=='recordedAcquisitionSpending',value=data?.[key],known=value!=null,positive=known&&value>=0;return <div key={key} className={`glass-panel metric-card ${gain&&known?(positive?'accent-gain-up':'accent-gain-down'):'accent-invested'}`}>
  <div className="metric-header"><span title={note}>{title}</span><span className="metric-icon">{gain?<ArrowUpRight size={18} style={{transform:known&&!positive?'rotate(90deg)':'none'}}/>:<Coins size={18}/>}</span></div>
  <div className="metric-value" style={gain&&known?{color:positive?'#22c55e':'#ef4444'}:undefined}>{error?'Unavailable':data?`${gain&&positive?'+':''}${money(value)}`:'Loading...'}</div>
  <div className="metric-footer">{key==='recordedAcquisitionSpending'?<><span title={data?.spendingNote||note}>Recorded purchases, including sold items.</span>{data&&data.spendingHistoryComplete===false&&<div>Historical records may be incomplete.</div>}{data?.spendingUnknownCount>0&&<div>Known subtotal; missing costs in {data.spendingUnknownCount} record(s).</div>}</>:key==='unrealizedGain'?<span title={note}>Items currently owned.{data&&value==null?' Pricing or cost information is incomplete.':''}</span>:<><span title={note}>Completed sales, after fees.</span>{data?.unknownSaleCount>0&&<div>Known subtotal: {money(data.knownRealizedGain)}; {data.unknownSaleCount} incomplete sale(s).</div>}</>}{error&&<div role="alert">{error}</div>}</div>
 </div>;})}</>;
}
