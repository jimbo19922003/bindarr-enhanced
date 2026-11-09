// provider-keys-consolidated-v1
import { useEffect, useState } from 'react';
import LocalCatalogImportPanel from './LocalCatalogImportPanel';
import ArtworkRecoveryPanel from './ArtworkRecoveryPanel';

export default function LocalCatalogStatusPanel() {
  const [language, setLanguage] = useState('en');
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [syncState, setSyncState] = useState(null);
  const [syncError, setSyncError] = useState('');
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setBusy(true); setError(''); setData(null);
    fetch(`/api/admin/local-catalog?lang=${encodeURIComponent(language)}`, {signal:controller.signal,cache:'no-store'})
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result; })
      .then(result => { if (live) setData(result); })
      .catch(failure => { if (live && failure.name !== 'AbortError') setError(failure.message); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; controller.abort(); };
  }, [language, refresh]);
  useEffect(() => {
    let live = true;
    let timer = 0;
    const read = () => fetch('/api/admin/local-catalog/sync-status', {cache:'no-store'})
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result; })
      .then(result => { if (!live) return; setSyncState(result); if (result.running) timer = window.setTimeout(read, 3000); else if (syncing) { setSyncing(false); setRefresh(value => value + 1); } })
      .catch(failure => { if (live) setSyncError(failure.message); });
    read();
    return () => { live = false; window.clearTimeout(timer); };
  }, [syncing, refresh]);
  const startSync = async () => {
    setSyncing(true); setSyncError('');
    try {
      const response = await fetch('/api/admin/local-catalog/sync', {method:'POST', cache:'no-store'});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setSyncState(result);
    } catch (failure) {
      setSyncError(failure.message);
      setSyncing(false);
    }
  };
  const choices = [{code:'en',name:'English'}, ...(data?.availableLanguages || []).filter(item => item.code !== 'en')];
  return <section className="glass-panel" style={{marginBottom:'1rem'}}>
    <h3 style={{marginTop:0}}>Pokémon catalogue</h3>
    <div style={{display:'flex',gap:'0.75rem',alignItems:'center',flexWrap:'wrap'}}>
      <label>Language <select className="input-control" value={language} onChange={event => setLanguage(event.target.value)}>
        {choices.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
      </select></label>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{busy ? 'Checking…' : 'Refresh status'}</button>
    </div>
    {busy && <p role="status">Reading installed catalogue status.</p>}
    {error && <p role="alert">{error} Catalogue status could not be verified.</p>}
    {data && <>
      <p role="status">{data.snapshot ? `Installed: ${Number(data.summary?.metadataCards || 0).toLocaleString()} cards.` : 'No local catalogue installed for this language.'}</p>
      <p>Local search: {data.localModeEnabled ? 'enabled' : 'disabled; the configured provider handles searches'}.</p>
      {data.snapshot && <p>{Number(data.summary?.missingReferences || 0).toLocaleString()} cards have no provider image reference. Existing image links and scanner readiness are not verified by this check.</p>}
      <p>Catalogue search, artwork recovery and price refresh are separate. Saving a provider key does not automatically retry a cached artwork failure or enable remote catalogue fallback.</p>
    </>}
    <div style={{display:'flex',gap:'0.75rem',alignItems:'center',flexWrap:'wrap',marginTop:'0.75rem'}}>
      <button type="button" className="btn btn-primary" disabled={syncing || syncState?.running || syncState?.enabled === false} onClick={startSync}>{syncState?.running || syncing ? 'Syncing English catalogue…' : 'Sync English catalogue'}</button>
      <span role="status">{syncState?.enabled === false ? 'Automatic sync is turned off (POKEMON_CATALOG_AUTOSYNC=0).' : syncState?.running ? 'Import is running. This page updates when it finishes.' : syncState?.languages?.en?.state === 'updated' ? `English catalogue updated (${Number(syncState.languages.en.cardCount || 0).toLocaleString()} cards).` : syncState?.languages?.en?.state === 'unchanged' ? 'English catalogue is already current.' : 'A new instance starts this sync about 10 seconds after boot. It fills card metadata. The scanner image index is still under Scanner setup below.'}</span>
    </div>
    {syncError && <p role="alert">{syncError}</p>}
    <p>Provider credentials: Admin → API keys.</p>
    <details onToggle={event => setRecoveryOpen(event.currentTarget.open)} style={{marginTop:'1rem'}}>
      <summary style={{cursor:'pointer'}}>Artwork recovery</summary>
      {recoveryOpen && <ArtworkRecoveryPanel />}
    </details>
    <details onToggle={event => setMaintenanceOpen(event.currentTarget.open)} style={{marginTop:'1rem'}}>
      <summary style={{cursor:'pointer'}}>Advanced catalogue maintenance</summary>
      <p>For operators installing a staged metadata snapshot. Opening this section changes no data. Existing collection entries and saved provider keys are not removed.</p>
      {maintenanceOpen && <>
        {data?.snapshot && <>
          <p>Source revision: <code>{data.snapshot.commit}</code><br />Imported: {data.snapshot.importedAt}</p>
          {data.snapshot.scanRefreshRequired && <p role="status">This snapshot requests a scanner-index refresh.</p>}
          <div className="collection-table-wrapper" style={{maxHeight:260,overflow:'auto'}}>
            <table className="collection-table"><thead><tr><th>Set</th><th>Imported cards</th><th>Printed count</th><th>Image references</th><th>Missing references</th></tr></thead>
              <tbody>{(data.sets || []).map(set => <tr key={set.id}><td>{set.name} <code>{set.id}</code></td><td>{set.metadataCards}</td><td>{set.printedTotal ?? 'Unknown'}</td><td>{set.artworkReferences}</td><td>{set.missingReferences}</td></tr>)}</tbody>
            </table>
          </div>
        </>}
        <LocalCatalogImportPanel language={language} onImported={() => setRefresh(value => value + 1)} />
      </>}
    </details>
  </section>;
}
