import { useEffect, useState } from 'react';

async function request(path = '', body) {
  const response = await fetch(`/api/admin/local-catalog/install${path}`, {method:body ? 'POST' : 'GET',cache:'no-store',...(body ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
export default function LocalCatalogImportPanel({language, onImported}) {
  const [commit, setCommit] = useState('');
  const [preview, setPreview] = useState(null);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let live = true; request().then(result => { if (live) setState(result); }).catch(failure => { if (live) setError(failure.message); }); return () => { live = false; }; }, []);
  const selected = preview?.language === language && preview?.commit === commit ? preview : null;
  const refresh = async () => { setBusy(true); setError(''); try { const next = await request(); setState(next); if (next.job?.phase === 'done') onImported?.(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
  const verify = async () => { setBusy(true); setError(''); setPreview(null); try { setPreview(await request('/preview',{commit,language})); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
  const install = async () => {
    if (!selected || !window.confirm(`Replace the active ${selected.language} metadata snapshot with ${selected.cardCount} cards from ${selected.commit}? Existing price fields and collection IDs are preserved. This does not download artwork or enable local mode.`)) return;
    setBusy(true); setError('');
    try { setState(previous => ({...previous,...{configured:previous?.configured},...{running:true}})); const next = await request('/apply',{previewId:selected.previewId,confirmed:true}); setState(previous => ({...previous,...next})); setPreview(null); } catch (failure) { setError(failure.message); await request().then(setState).catch(() => {}); } finally { setBusy(false); }
  };
  return <div style={{borderTop:'1px solid var(--border-glass)',paddingTop:'1rem',marginTop:'1rem'}}>
    <h4>Install a staged metadata bundle</h4>
    <p>The operator must stage a trusted build artifact in the server-configured POKEMON_CATALOG_BUNDLE_DIR. No browser URL or path is accepted. Automatic delivery is not connected.</p>
    {state && !state.configured && <p role="status">No server bundle directory is configured.</p>}
    <label>Pinned upstream commit <input className="input-control" value={commit} onChange={event => { setCommit(event.target.value.trim()); setPreview(null); }} placeholder="40-character upstream commit SHA" /></label>
    <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap',marginTop:'0.75rem'}}>
      <button type="button" className="btn btn-secondary" disabled={busy || state?.running || !state?.configured || !/^[a-f0-9]{40}$/.test(commit)} onClick={verify}>Verify and preview {language}</button>
      <button type="button" className="btn btn-primary" disabled={busy || state?.running || !selected} onClick={install}>Confirm metadata install</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={refresh}>Refresh import status</button>
    </div>
    {selected && <p>Verified preview: {selected.cardCount} cards, {selected.setCount} sets, {selected.artworkReferences} artwork references, {selected.missingArtworkReferences} missing references. Expires: {selected.expiresAt}. No data has been imported by previewing.</p>}
    {state?.job && <p role="status">Import {state.job.phase}: {state.job.language}, revision <code>{state.job.commit}</code>. {state.job.message || ''} {state.running ? 'Import runs in the background; refresh import status to check completion.' : ''}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
