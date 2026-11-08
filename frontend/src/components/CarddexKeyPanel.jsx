import { useEffect, useState } from 'react';
const endpoint='/api/settings/provider-keys/carddex';
export default function CarddexKeyPanel(){
 const [key,setKey]=useState(''),[status,setStatus]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{let live=true;fetch(endpoint,{cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error();return response.json();}).then(value=>{if(live)setStatus(value);}).catch(()=>{if(live)setMessage('Could not read CardDex key status.');});return ()=>{live=false;};},[]);
 async function save(){const value=key.trim();if(!value||value.length>256||/\s/.test(value)){setMessage('Enter a nonempty key containing no whitespace, at most 256 characters.');return;}setBusy(true);setMessage('');try{const response=await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:value}),cache:'no-store'});if(!response.ok)throw new Error();const result=await response.json();if(result.saved!==true||result.savedKeyPresent!==true)throw new Error();setStatus(result);setKey('');setMessage('CardDex key saved and database persistence verified. Provider acceptance has not been tested.');}catch{setMessage('CardDex key could not be saved and verified. Please retry.');}finally{setBusy(false);}}
 return <section style={{border:'1px solid var(--border-glass)',borderRadius:'var(--radius-sm)',padding:'1rem',marginBottom:'1rem'}}>
  <h4 style={{marginTop:0}}>CardDex API key</h4>
  <p>Administrator-only, instance-wide credential for CardDex artwork lookups. Leave blank to keep the existing key. The saved key stays on the server; it is not returned to this form.</p>
  <p><a href="https://carddex.dev/" target="_blank" rel="noopener noreferrer">Get a CardDex key</a></p>
  <label htmlFor="carddex-key">CardDex API key</label>
  <input id="carddex-key" className="input-control" type="password" autoComplete="off" spellCheck={false} maxLength={256} disabled={busy} value={key} onChange={event=>setKey(event.target.value)} placeholder={status?.configured?'Configured — enter a replacement key':'Paste your CardDex API key'} />
  <p role="status">{status ? status.configured ? `Configured (${status.keySource==='environment'?'server environment':'saved instance setting'}).` : 'No CardDex key configured.' : 'Key status not yet available.'}</p>
  <button type="button" className="btn btn-primary" onClick={save} disabled={busy||!key.trim()}>{busy?'Saving…':'Save CardDex key'}</button>
  {message&&<p role="status">{message}</p>}
  <p>Stored in the instance SQLite database, not encrypted at rest by this feature. Protect the database and backups. Saving a key does not clear provider cooldowns or prove artwork coverage.</p>
 </section>;
}
