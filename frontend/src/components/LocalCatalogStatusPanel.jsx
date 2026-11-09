import { useEffect, useRef, useState } from 'react';
import LocalCatalogImportPanel from './LocalCatalogImportPanel';
import ArtworkRecoveryPanel from './ArtworkRecoveryPanel';
import CatalogArtworkCoverage from './CatalogArtworkCoverage';
import { useT } from '../utils/i18n';

const number = value => Number(value || 0).toLocaleString();
const languageNames = {en:'English',ja:'Japanese',de:'German',fr:'French',es:'Spanish',it:'Italian',pt:'Portuguese',ko:'Korean',ru:'Russian','zh-tw':'Chinese (Traditional)','zh-cn':'Chinese (Simplified)',id:'Indonesian',th:'Thai'};
const languageOptions = Object.entries(languageNames).map(([code,name]) => ({code,name}));

export default function LocalCatalogStatusPanel({onBuildScan, scanProgress}) {
  const {t} = useT();
  const [language, setLanguage] = useState('en');
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(null);
  const [sets, setSets] = useState([]);
  const [selectedSet, setSelectedSet] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [setsLoading, setSetsLoading] = useState(false);
  const [modeLoading, setModeLoading] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [setsError, setSetsError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const buildAfterSync = useRef(null);
  const buildScanRef = useRef(onBuildScan);
  buildScanRef.current = onBuildScan;
  const syncPhase = job?.phase;

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/admin/local-catalog?lang=${encodeURIComponent(language)}`, {signal:controller.signal,cache:'no-store'})
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result; })
      .then(result => { if (live) setData(result); })
      .catch(failure => { if (live && failure.name !== 'AbortError') setError(failure.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [language, refresh]);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setSetsLoading(true);
    setSetsError('');
    fetch(`/api/admin/local-catalog/sets?lang=${encodeURIComponent(language)}`, {signal:controller.signal,cache:'no-store'})
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result; })
      .then(result => {
        if (!live) return;
        const available = result.sets || [];
        setSets(available);
        setSelectedSet(current => available.some(set => set.id === current) ? current : (available[0]?.id || ''));
        if (result.job) setJob(result.job);
      })
      .catch(failure => { if (live && failure.name !== 'AbortError') setSetsError(failure.message); })
      .finally(() => { if (live) setSetsLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [language]);

  useEffect(() => {
    if (!['checking','fetching','saving'].includes(syncPhase)) return undefined;
    let live = true;
    let inflight = false;
    const poll = async () => {
      if (inflight) return;
      inflight = true;
      try {
        const response = await fetch('/api/admin/local-catalog/sets/job', {cache:'no-store'});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (!live || !result.job) return;
        setJob(result.job);
        if (result.job.phase === 'done') {
          setRefresh(value => value + 1);
          if (buildAfterSync.current) {
            const requestedSets = buildAfterSync.current;
            buildAfterSync.current = null;
            const syncedSetIds = result.job.result?.synced_set_ids || [];
            const scanSets = requestedSets.length === sets.length
              ? syncedSetIds
              : requestedSets.filter(setId => syncedSetIds.includes(setId));
            if (scanSets.length) {
              buildScanRef.current?.('pokemon', languageNames[language] || language, scanSets);
            } else {
              setError(t('localCatalog.noScanSetsAvailable'));
            }
          }
        }
      } catch (failure) {
        if (live) setError(failure.message);
      } finally { inflight = false; }
    };
    const timer = setInterval(poll, 1000);
    poll();
    return () => { live = false; clearInterval(timer); };
  }, [syncPhase, language, sets.length, t]);

  const updateMode = async enabled => {
    setModeLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/local-catalog/mode', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setData(previous => previous ? {...previous,localModeEnabled:result.localModeEnabled} : previous);
    } catch (failure) { setError(failure.message); }
    finally { setModeLoading(false); }
  };

  const syncSets = async withScanner => {
    const selected = sets.find(item => item.id === selectedSet);
    if (selectedOnly && !selected) return;
    const ids = selectedOnly ? [selected.id] : sets.map(item => item.id);
    const confirmation = withScanner
      ? selectedOnly ? 'localCatalog.confirmSyncSelectedAndScan' : 'localCatalog.confirmSyncAllAndScan'
      : selectedOnly ? 'localCatalog.confirmSyncSelected' : 'localCatalog.confirmSyncAll';
    const confirmed = window.confirm(t(confirmation, {
      set: selected?.name || '',
      id: selected?.id || '',
      language: languageNames[language] || language,
      count: number(ids.length),
    }));
    if (!confirmed) return;
    buildAfterSync.current = withScanner ? ids : null;
    setError('');
    setJob(null);
    try {
      const request = selectedOnly ? {language, setId:selected.id} : {language, allSets:true};
      const response = await fetch('/api/admin/local-catalog/sets', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,confirmed:true})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setJob(result.job);
    } catch (failure) {
      buildAfterSync.current = null;
      setError(failure.message);
    }
  };

  const refreshSets = async () => {
    setSetsLoading(true);
    setSetsError('');
    try {
      const response = await fetch(`/api/admin/local-catalog/sets?lang=${encodeURIComponent(language)}`, {cache:'no-store'});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setSets(result.sets || []);
      setSelectedSet(current => (result.sets || []).some(set => set.id === current) ? current : (result.sets?.[0]?.id || ''));
    } catch (failure) { setSetsError(failure.message); }
    finally { setSetsLoading(false); }
  };

  const set = sets.find(item => item.id === selectedSet);
  const syncRunning = job && ['checking','fetching','saving'].includes(job.phase);
  const syncPercent = job?.setCount
    ? Math.min(100, Math.round(((job.completedSets || 0) + (job.total ? (job.done || 0) / job.total : 0)) * 100 / job.setCount))
    : 0;
  const scanRunning = scanProgress?.game === 'pokemon' && scanProgress.lang === (languageNames[language] || language);
  const importedAt = data?.snapshot?.importedAt ? new Date(data.snapshot.importedAt).toLocaleString() : '';

  return <section className="glass-panel" style={{display:'flex',flexDirection:'column',gap:'0.9rem',marginBottom:'1rem'}}>
    <div>
      <h3 style={{margin:'0 0 0.35rem',color:'var(--text-strong)',fontSize:'1.1rem'}}>{t('localCatalog.title')}</h3>
      <p style={{margin:0,color:'var(--text-secondary)',fontSize:'0.82rem',lineHeight:1.5}}>
        {t('localCatalog.intro')}
      </p>
    </div>

    <div style={{display:'flex',gap:'0.75rem',alignItems:'center',flexWrap:'wrap'}}>
      <label>{t('localCatalog.language')} <select className="select-control" value={language} onChange={event => { setLanguage(event.target.value); setJob(null); }} disabled={syncRunning}>
        {languageOptions.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
      </select></label>
      <button type="button" className="btn btn-secondary btn-sm" onClick={refreshSets} disabled={setsLoading || syncRunning}>{t('localCatalog.refreshSets')}</button>
    </div>
    <label style={{display:'flex',gap:'0.45rem',alignItems:'center',fontSize:'0.82rem',color:'var(--text-strong)'}}>
      <input type="checkbox" checked={selectedOnly} onChange={event => setSelectedOnly(event.target.checked)} disabled={syncRunning || !sets.length} />
      {t('localCatalog.selectedSetOnly')}
    </label>
    {selectedOnly && <label>{t('localCatalog.set')} <select className="select-control" value={selectedSet} onChange={event => setSelectedSet(event.target.value)} disabled={setsLoading || !sets.length || syncRunning}>
      {sets.map(item => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
    </select></label>}
    {setsLoading && <p role="status" style={{margin:0,color:'var(--text-secondary)',fontSize:'0.8rem'}}>{t('localCatalog.loadingSets')}</p>}
    {setsError && <p role="alert" style={{margin:0,color:'var(--accent-red)'}}>{setsError}</p>}

    <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap'}}>
      <button type="button" className="btn btn-primary" onClick={() => syncSets(false)} disabled={!sets.length || (selectedOnly && !set) || syncRunning}>
        {selectedOnly ? t('localCatalog.syncSet') : t('localCatalog.syncAllSets', {count:number(sets.length)})}
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => syncSets(true)} disabled={!sets.length || (selectedOnly && !set) || syncRunning || !onBuildScan}>
        {selectedOnly ? t('localCatalog.syncAndScan') : t('localCatalog.syncAllAndScan', {count:number(sets.length)})}
      </button>
    </div>

    {syncRunning && <div role="status" style={{display:'grid',gap:'0.4rem'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:'0.5rem',flexWrap:'wrap',fontSize:'0.8rem',color:'var(--text-secondary)'}}>
        <span>{job.message}</span>
        {job.setCount > 0 && <span>{t('localCatalog.setProgress', {done:number(job.completedSets || 0), current:number(job.setIndex || 0), total:number(job.setCount)})} · {syncPercent}%</span>}
      </div>
      {job.total > 0 && <progress aria-label="Set metadata sync progress" max="100" value={syncPercent} style={{width:'100%',accentColor:'var(--accent-red)'}} />}
    </div>}
    {job && !syncRunning && <p role={job.phase === 'failed' ? 'alert' : 'status'} style={{margin:0,color:job.phase === 'failed' ? 'var(--accent-red)' : 'var(--text-secondary)',fontSize:'0.82rem'}}>{job.message}</p>}
    {scanRunning && <div role="status" style={{display:'grid',gap:'0.35rem',fontSize:'0.8rem',color:'var(--text-secondary)'}}>
      <span>{t('localCatalog.scannerProgress', {phase: scanProgress.phase === 'cache' ? t('localCatalog.loadingCardData') : t('localCatalog.buildingImageIndex'), message: scanProgress.message || '', done: number(scanProgress.done), total: number(scanProgress.total || 0), stopping: scanProgress.cancelled ? ` · ${t('localCatalog.stopping')}` : ''})}</span>
      {scanProgress.total > 0 && <progress aria-label="Scanner index build progress" max="100" value={Math.min(100, Math.round((scanProgress.done || 0) * 100 / scanProgress.total))} style={{width:'100%',accentColor:'var(--accent-red)'}} />}
    </div>}

    {data && <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'0.75rem',flexWrap:'wrap',borderTop:'1px solid var(--border-glass)',paddingTop:'0.75rem'}}>
      <div style={{fontSize:'0.82rem',color:'var(--text-secondary)'}}>
        <strong style={{color:'var(--text-strong)'}}>{data.snapshot ? t('localCatalog.syncedSummary', {cards: number(data.summary?.metadataCards), sets: number(data.snapshot.setCount)}) : t('localCatalog.noSyncedData')}</strong>
        {data.snapshot && <div>{t('localCatalog.snapshotUpdated', {date: importedAt})} {t('localCatalog.onlySelectedSetUpdated')}</div>}
      </div>
      <label style={{display:'flex',gap:'0.45rem',alignItems:'center',fontSize:'0.82rem',color:'var(--text-strong)'}}>
        <input type="checkbox" checked={!!data.localModeEnabled} disabled={modeLoading} onChange={event => updateMode(event.target.checked)} />
        {t('localCatalog.strictSearch')}
      </label>
    </div>}
    {loading && <p role="status" style={{margin:0,color:'var(--text-secondary)',fontSize:'0.8rem'}}>{t('localCatalog.checkingLocalData')}</p>}
    {error && <p role="alert" style={{margin:0,color:'var(--accent-red)'}}>{error}</p>}
    {data?.localModeEnabled && !data.snapshot && <p role="alert" style={{margin:0,color:'var(--accent-yellow)'}}>{t('localCatalog.missingLocalData')}</p>}

    <CatalogArtworkCoverage key={language} language={language} data={data?.language === language ? data : null} onChanged={() => setRefresh(value => value + 1)} />

    <details open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
      <summary style={{cursor:'pointer',color:'var(--text-secondary)',fontSize:'0.82rem'}}>{t('localCatalog.advancedTools')}</summary>
      <p style={{color:'var(--text-secondary)',fontSize:'0.78rem',lineHeight:1.45}}>{t('localCatalog.bundleDescription')}</p>
      <LocalCatalogImportPanel language={language} onImported={() => setRefresh(value => value + 1)} />
      <ArtworkRecoveryPanel />
    </details>
  </section>;
}
