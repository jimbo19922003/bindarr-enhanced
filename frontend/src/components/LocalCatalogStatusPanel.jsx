import { useEffect, useState } from 'react';
import LocalCatalogImportPanel from './LocalCatalogImportPanel';
import CarddexKeyPanel from './CarddexKeyPanel';

export default function LocalCatalogStatusPanel() {
  const [language, setLanguage] = useState('en');
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
  const choices = [{code:'en',name:'English'}, ...(data?.availableLanguages || []).filter(item => item.code !== 'en')];
  return <section className="glass-panel" style={{marginBottom:'1rem'}}>
    <h3 style={{marginTop:0}}>Local Pokémon metadata</h3>
    <CarddexKeyPanel />
    <p>English-first snapshots. Metadata, artwork references and scanner readiness are separate.</p>
    <div style={{display:'flex',gap:'0.75rem',alignItems:'center',flexWrap:'wrap'}}>
      <label>Installed snapshot language <select className="input-control" value={language} onChange={event => setLanguage(event.target.value)}>
        {choices.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
      </select></label>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{busy ? 'Reading local status…' : 'Refresh local status'}</button>
    </div>
    {error && <p role="alert">{error} No readiness claim is available.</p>}
    {data && <>
      <p>Local API preview: {data.localModeEnabled ? 'enabled' : 'disabled; existing provider paths remain active'}.</p>
      {!data.snapshot ? <p role="status">No local snapshot is installed for this language. A successful repository build does not automatically install it here. Use the staged-bundle preview/install controls below; automatic delivery is not connected.</p> : <>
        <p>Source revision: <code>{data.snapshot.commit}</code><br />Imported (database time): {data.snapshot.importedAt}</p>
        <p>Snapshot metadata: {data.summary.metadataCards} cards. Cached rows: {data.summary.cachedRows}. Artwork references: {data.summary.artworkReferences}. Missing references: {data.summary.missingReferences}. Missing cache rows: {data.summary.missingCacheRows}.</p>
        <div className="collection-table-wrapper" style={{maxHeight:260,overflow:'auto'}}>
          <table className="collection-table"><thead><tr><th>Set</th><th>Imported cards</th><th>Official printed count</th><th>Artwork references</th><th>Missing references</th><th>Missing cache rows</th></tr></thead>
            <tbody>{data.sets.map(set => <tr key={set.id}><td>{set.name} <code>{set.id}</code></td><td>{set.metadataCards}</td><td>{set.printedTotal ?? 'Unknown'}</td><td>{set.artworkReferences}</td><td>{set.missingReferences}</td><td>{set.missingCacheRows}</td></tr>)}</tbody>
          </table>
        </div>
        {data.snapshot.scanRefreshRequired && <p role="status">This metadata snapshot requests a scanner-index refresh.</p>}
      </>}
      <p>Image downloads and local image files are not verified by this status endpoint. An artwork URL may still fail to load. Scanner readiness is not verified here.</p>
      <p>Artwork repair tries CardDex before PokéWallet for eligible missing English artwork. Provider matching and successful image downloads are verified separately from metadata readiness.</p>
    </>}
    <LocalCatalogImportPanel language={language} onImported={() => setRefresh(value => value + 1)} />
  </section>;
}
