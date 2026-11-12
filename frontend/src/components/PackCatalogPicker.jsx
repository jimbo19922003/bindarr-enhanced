import { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';

const lower = value => String(value || '').trim().toLowerCase();

// The single booster pack from the source set, when the catalog offers exactly one.
function suggestedPack(results, setName, setId) {
  const name = lower(setName), id = lower(setId);
  const fits = results.filter(row => row.product_type === 'booster_pack'
    && ((name && lower(row.set_name) === name) || (id && lower(row.set_id) === id)));
  return fits.length === 1 ? fits[0] : null;
}

// Looks up a pack group in the sealed catalog (the Add sealed search) so a
// converted pack is linked to its catalog product and priced like one.
export default function PackCatalogPicker({ group, autoSearch = false, disabled, t, onPick }) {
  const [results, setResults] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ticket = useRef(0), autoRan = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; const tickets = ticket; return () => { live.current = false; tickets.current++; }; }, []);
  const search = useCallback(async auto => {
    const q = [group.set_name || group.name, 'booster pack'].filter(Boolean).join(' ').trim();
    if (q.length < 2) return;
    const mine = ++ticket.current;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/sealed/catalog?q=${encodeURIComponent(q)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errCatalog'));
      if (!live.current || mine !== ticket.current) return;
      const all = Array.isArray(data.results) ? data.results : [];
      const packs = all.filter(row => row.product_type === 'booster_pack');
      const shown = packs.length ? packs : all;
      const pick = auto ? suggestedPack(all, group.set_name, group.set_id) : null;
      if (pick) { setResults([]); onPick(pick); return; }
      setResults(shown);
      if (!shown.length) setError(t('sealed.catalogEmpty'));
    } catch (err) {
      if (live.current && mine === ticket.current) { setResults([]); setError(err.message); }
    } finally { if (live.current && mine === ticket.current) setBusy(false); }
  }, [group.name, group.set_name, group.set_id, onPick, t]);
  useEffect(() => {
    if (!autoSearch || autoRan.current) return;
    autoRan.current = true;
    void search(true);
  }, [autoSearch, search]);
  const choose = row => { setResults([]); setError(''); onPick(row); };
  return <div style={{ display: 'grid', gap: '0.35rem' }}>
    {group.provider_product_id
      ? <small data-testid="pack-catalog-linked">{t('sealed.packLinked', { name: group.name, price: group.catalog_market_price ? `${group.catalog_market_currency || 'USD'} ${group.catalog_market_price}` : t('sealed.packNoQuote') })}</small>
      : <button className="btn btn-secondary" type="button" disabled={disabled || busy} onClick={() => search(false)} style={{ justifySelf: 'start', gap: '0.35rem' }}>
        <Search size={14} /> {busy ? t('sealed.findingPackPrice') : t('sealed.findPackPrice')}
      </button>}
    {error && <small role="status">{error}</small>}
    {results.length > 0 && <div style={{ display: 'grid', gap: '0.3rem', maxHeight: 220, overflowY: 'auto' }}>
      {results.map(row => <button key={`${row.provider}:${row.provider_product_id}`} className="btn btn-secondary" type="button" disabled={disabled}
        onClick={() => choose(row)} style={{ justifyContent: 'flex-start', gap: '0.5rem', textAlign: 'left' }}>
        {row.image_url && <img src={row.image_url} alt="" style={{ width: 30, height: 42, objectFit: 'contain' }} />}
        <span>{row.name}<br /><small>{row.set_name || row.set_id}{row.market_price ? ` — ${row.market_currency || 'USD'} ${row.market_price}` : ''}</small></span>
      </button>)}
    </div>}
  </div>;
}
