import { useEffect, useState } from 'react';
import CardArtEditor from './CardArtEditor';
import { useT } from '../utils/i18n';

export default function CatalogArtworkCoverage({ language, data, onChanged }) {
  const { t } = useT();
  const [setId, setSetId] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const sets = data?.sets || [];
  const selected = sets.find(set => set.id === setId);

  useEffect(() => {
    if (!selected) return undefined;
    const controller = new AbortController();
    setError('');
    setResult(null);
    const params = new URLSearchParams({ lang: language, set: setId, page: String(page) });
    fetch(`/api/admin/local-catalog/missing-artwork?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        return body;
      })
      .then(body => {
        const lastPage = Math.max(1, Math.ceil(body.total / 50));
        if (page > lastPage) setPage(lastPage);
        else setResult(body);
      })
      .catch(failure => { if (failure.name !== 'AbortError') setError(failure.message); });
    return () => controller.abort();
  }, [language, setId, page, refresh, selected]);

  if (!data?.snapshot) return null;
  const summary = data.summary;
  const number = value => Number(value || 0).toLocaleString();
  const changed = () => { setRefresh(value => value + 1); onChanged(); };
  return <section style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.75rem' }}>
    <h4>{t('localCatalog.artworkCoverage')}</h4>
    <p>{t('localCatalog.artworkSummary', {
      references: number(summary.artworkReferences),
      local: number(summary.localArtworkWithoutReference),
      missing: number(summary.missingArtwork),
    })}</p>
    <p>{t('localCatalog.artworkCoverageNote')}</p>
    <label>{t('localCatalog.artworkReviewSet')}{' '}
      <select className="select-control" value={selected ? setId : ''} onChange={event => {
        setSetId(event.target.value); setPage(1); setResult(null); setError('');
      }}>
        <option value="">{t('localCatalog.artworkChooseSet')}</option>
        {sets.map(set => <option key={set.id} value={set.id}>{set.name} ({set.id}) — {number(set.missingArtwork)}</option>)}
      </select>
    </label>
    {selected && <p>{t('localCatalog.artworkSetSummary', {
      references: number(selected.artworkReferences),
      local: number(selected.localArtworkWithoutReference),
      missing: number(selected.missingArtwork),
    })}</p>}
    {error && <p role="alert">{error}</p>}
    {selected && !result && !error && <p role="status">{t('localCatalog.artworkLoading')}</p>}
    {selected && result && <>
      {result.total === 0 && <p>{t('localCatalog.artworkNoMissing')}</p>}
      <ul>{result.cards.map(card => <li key={card.id}>
        {card.name} · {card.set_name} · #{card.number} · <code>{card.id}</code>
        <CardArtEditor card={card} hasProviderArt={false} onChanged={changed} />
      </li>)}</ul>
      {result.total > 50 && <div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t('localCatalog.artworkPrevious')}</button>{' '}
        <span>{t('localCatalog.artworkPage', { page, pages: Math.ceil(result.total / 50) })}</span>{' '}
        <button type="button" className="btn btn-secondary btn-sm" disabled={page * 50 >= result.total} onClick={() => setPage(value => value + 1)}>{t('localCatalog.artworkNext')}</button>
      </div>}
    </>}
  </section>;
}
