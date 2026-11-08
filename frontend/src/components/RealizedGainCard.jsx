import {useEffect,useState} from 'react';
import {Coins} from 'lucide-react';
import {useT} from '../utils/i18n';
export default function RealizedGainCard({statsTrigger,currency='USD'}) {
 const {t,locale}=useT();const [report,setReport]=useState(null),[error,setError]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const listener=()=>setRefresh(n=>n+1);window.addEventListener('bindarr_sales_changed',listener);return()=>window.removeEventListener('bindarr_sales_changed',listener);},[]);
 useEffect(()=>{let current=true;const controller=new AbortController();setError(false);fetch('/api/sales/history?limit=1',{signal:controller.signal,cache:'no-store'}).then(async res=>{if(!res.ok)throw new Error();return res.json();}).then(data=>{if(current)setReport(data);}).catch(err=>{if(current&&err.name!=='AbortError')setError(true);});return()=>{current=false;controller.abort();};},[statsTrigger,refresh]);
 const group=report?.groups.find(g=>g.currency===currency),known=group?group.count-group.unknownCount:0;
 const value=error||!report||(!group&&report.groups.length)|| (group&&!known)?null:(group?.knownGainCents||0)/100;
 const amount=value==null?'—':new Intl.NumberFormat(locale,{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
 return <div className={`glass-panel metric-card ${value==null?'':value>=0?'accent-gain-up':'accent-gain-down'}`}>
  <div className="metric-header"><span>{t('dash.realizedLossGain')}</span><span className="metric-icon"><Coins size={18} /></span></div>
  <div className="metric-value" style={{color:value==null?'var(--text-muted)':value>=0?'#22c55e':'#ef4444'}}>{amount}</div>
  <div className="metric-footer">{error?'Sales totals unavailable':`${currency} · ${group?.unknownCount||0} unknown-basis sale(s)`}<div><button type="button" className="sales-card-link" onClick={()=>window.dispatchEvent(new Event('bindarr_open_sales'))}>View / record sales</button></div></div>
 </div>;
}
