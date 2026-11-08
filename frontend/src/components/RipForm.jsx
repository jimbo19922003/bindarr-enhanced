import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { langCode } from '../utils/languages';
import CardImage from './CardImage';

let nextLine = 0;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const normalizedNumber = value => String(value || '').replace(/^#/, '').split('/')[0].trim().toLowerCase().replace(/^0+(?=\d)/, '');

export default function RipForm({ product, lot, busy, t, showToast, onClose, onSubmit }) {
  const inputRef = useRef(null);
  const chosen = useRef(false);
  const request = useRef(0);
  const [openedAt, setOpenedAt] = useState(today);
  const [notes, setNotes] = useState('');
  const [sets, setSets] = useState([]);
  const [setId, setSetId] = useState('');
  const [resolved, setResolved] = useState(null);
  const [setError, setSetError] = useState(false);
  const [query, setQuery] = useState('');
  const [pulls, setPulls] = useState([]);
  const [matches, setMatches] = useState([]);
  const [looking, setLooking] = useState(false);
  const [entryComplete, setEntryComplete] = useState(false);
  const language = langCode(product.language || 'en');

  useEffect(() => { inputRef.current?.focus(); return () => { request.current++; }; }, []);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ code: product.set_id || '', name: product.set_name || '', lang: language });
    fetch(`/api/sets?game=pokemon&lang=${encodeURIComponent(language)}`)
      .then(async response => { if (!response.ok) throw new Error('sets'); return response.json(); })
      .then(data => { if (!cancelled) { setSets(Array.isArray(data) ? data.filter(row => row.id) : []); setSetError(false); } })
      .catch(() => { if (!cancelled) setSetError(true); });
    fetch(`/api/sealed/card-set?${params}`)
      .then(async response => { if (!response.ok) throw new Error('default set'); return response.json(); })
      .then(data => {
        if (cancelled || !data.set_id) return;
        setResolved({ id: data.set_id, name: data.set_name || product.set_name || data.set_id });
        if (!chosen.current) setSetId(data.set_id);
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [product.set_id, product.set_name, language]);

  const options = sets.slice();
  if (resolved && !options.some(row => row.id === resolved.id)) options.push(resolved);
  const selected = options.find(row => row.id === setId);
  const searchSetLabel = setId ? selected?.name || setId : 'All Pokémon sets';
  const changeSet = value => {
    chosen.current = true; request.current++; setLooking(false);
    setSetId(value); setMatches([]); inputRef.current?.focus();
  };
  const addCard = card => {
    const amount = Number(card.price_trend);
    const sourceCurrency = String(card.price_currency || 'USD').toUpperCase();
    const usable = Number.isFinite(amount) && amount > 0 && sourceCurrency === String(lot.currency).toUpperCase();
    const price = usable ? amount.toFixed(2) : '';
    setPulls(current => [{ key: ++nextLine, card_id: card.id, name: card.name, number: card.number || '',
      set_name: card.set_name || selected?.name || '',
      image_url: /^https?:\/\//.test(card.image_url || '') ? card.image_url : '',
      quantity: '1', current_value: price, value_at_opening: price,
      original_price: amount > 0 ? `${sourceCurrency} ${amount.toFixed(2)}` : '', bulk: false }, ...current]);
    setQuery(''); setMatches([]); inputRef.current?.focus();
  };
  const lookup = async () => {
    const typed = query.trim().replace(/^#/, '');
    if (!typed || looking) return;
    const byNumber = /^[A-Za-z]{0,8}\d+[A-Za-z★]?(?:\/[A-Za-z0-9]+)?$/.test(typed);
    if (!setId && byNumber) { showToast('Select a card set for number-only entry, or search all sets by card name.'); return; }
    const ticket = ++request.current; setLooking(true); setMatches([]);
    try {
      const params = new URLSearchParams({ game: 'pokemon', scope: 'internet', lang: language, page: '1', limit: '25' });
      if (setId) params.set('set', setId);
      params.set(byNumber ? 'number' : 'name', byNumber ? typed.split('/')[0] : typed);
      const response = await fetch(`/api/search?${params}`);
      const data = await response.json().catch(() => []);
      if (ticket !== request.current) return;
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
      const found = Array.isArray(data) ? data : [];
      const exact = found.filter(card => byNumber ? normalizedNumber(card.number) === normalizedNumber(typed) : String(card.name || '').toLowerCase() === typed.toLowerCase());
      if (setId && exact.length === 1) addCard(exact[0]);
      else { setMatches(found); if (!found.length) showToast(t('sealed.ripNone', { query: typed, set: searchSetLabel })); }
    } catch (error) { if (ticket === request.current) showToast(error.message); }
    finally { if (ticket === request.current) { setLooking(false); inputRef.current?.focus(); } }
  };
  const editPull = (key, field, value) => setPulls(current => current.map(pull => pull.key === key ? { ...pull, [field]: value } : pull));
  const submit = event => {
    event.preventDefault();
    onSubmit({ opened_at: openedAt, notes, entry_complete: entryComplete, pulls: pulls.map(pull => pull.bulk ? {
      name: pull.name.trim() || t('sealed.otherCards'), quantity: Number(pull.quantity) || 1, set_name: product.set_name || '',
      ...(pull.line_value.trim() ? { line_value: pull.line_value.trim() } : {}),
      ...(pull.value_at_opening.trim() ? { opened_line_value: pull.value_at_opening.trim() } : {}),
    } : { name: pull.name, card_id: pull.card_id, quantity: Number(pull.quantity), set_name: pull.set_name, number: pull.number,
      ...(pull.image_url ? { image_url: pull.image_url } : {}),
      ...(pull.current_value ? { current_value: pull.current_value } : {}),
      ...(pull.value_at_opening ? { value_at_opening: pull.value_at_opening } : {}),
    }) });
  };
  return <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', width: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
      <div><h3 style={{ margin: 0 }}>{t('sealed.letItRip')}</h3><p>{product.name || product.set_name}</p><p>{t('sealed.ripLot', { cost: `${lot.currency} ${lot.total_cost}`, date: lot.purchased_at ? ` on ${lot.purchased_at}` : '' })}</p></div>
      <button className="btn btn-secondary" type="button" onClick={onClose} aria-label={t('common.cancel')}><X size={18} /></button>
    </div>
    <label>{t('sealed.openedOn')}<input className="input-control" type="date" value={openedAt} onChange={e => setOpenedAt(e.target.value)} /></label>
    <label htmlFor="rip-card-set">Card search set</label>
    <select id="rip-card-set" className="input-control" value={setId} onChange={e => changeSet(e.target.value)}>
      <option value="">All Pokémon sets — search by name</option>
      {options.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).map(row => <option key={row.id} value={row.id}>{row.name} ({row.id})</option>)}
    </select>
    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
      Sealed product set: {product.set_name || 'Unspecified'}. Change the card search set to add classic, promo, or other included cards. Already-entered pulls stay in this rip.
    </p>
    {setError && <p role="status">Could not load the set list. Use all-set name search or the set ID override.</p>}
    <details><summary>Set ID override</summary><input className="input-control" aria-label="Card search set ID override" value={setId} onChange={e => changeSet(e.target.value)} /></details>
    <label>{t('sealed.notes')}<input className="input-control" value={notes} onChange={e => setNotes(e.target.value)} /></label>
    <h4 style={{ margin: 0 }}>Searching: {searchSetLabel}</h4>
    <div style={{ display: 'flex', gap: '0.5rem' }}>
      <input ref={inputRef} className="input-control" placeholder={t('sealed.ripQuery')} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } }} />
      <button className="btn btn-secondary" type="button" onClick={lookup} disabled={looking || busy}>{t('sealed.addPull')}</button>
    </div>
    {matches.map(card => <button className="btn btn-secondary" type="button" key={card.id} onClick={() => addCard(card)} style={{ justifyContent: 'flex-start', gap: '0.5rem' }}>
      <CardImage card={card} style={{ width: 30, height: 42, objectFit: 'contain' }} /> #{card.number} {card.name} — {card.set_name}
    </button>)}
    <div style={{ maxHeight: 260, overflowY: 'auto', display: 'grid', gap: '0.5rem' }}>
      {pulls.map(pull => <div key={pull.key} style={{ border: '1px solid var(--border-glass)', padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}>
        <div>{pull.bulk ? pull.name : `#${pull.number} ${pull.name} — ${pull.set_name}`}</div>
        {!pull.bulk && <small>{pull.current_value ? `${lot.currency} ${pull.current_value}` : pull.original_price ? `${pull.original_price} source quote; not yet valued in ${lot.currency}` : 'Unpriced'}</small>}
        {pull.bulk && <div style={{ display: 'flex', gap: '0.4rem' }}>
          <input className="input-control" aria-label={t('card.quantity')} type="number" min="1" value={pull.quantity} onChange={e => editPull(pull.key, 'quantity', e.target.value)} />
          <input className="input-control" aria-label={t('sealed.lineValue')} placeholder={t('sealed.lineValue')} value={pull.line_value} onChange={e => editPull(pull.key, 'line_value', e.target.value)} />
        </div>}
        <button className="btn btn-secondary" type="button" onClick={() => setPulls(current => current.filter(item => item.key !== pull.key))}>{t('search.undo')}</button>
      </div>)}
    </div>
    <button className="btn btn-secondary" type="button" onClick={() => setPulls(current => [{ key: ++nextLine, bulk: true, name: t('sealed.otherCards'), quantity: '1', line_value: '', value_at_opening: '' }, ...current])}>{t('sealed.addBulk')}</button>
    <label><input type="checkbox" checked={entryComplete} onChange={e => setEntryComplete(e.target.checked)} /> {t('sealed.markComplete')}</label>
    <div className="quick-add-footer"><div className="quick-add-footer-actions">
      <button className="btn btn-secondary" type="button" onClick={onClose}>{t('common.cancel')}</button>
      <button className="btn btn-primary" type="submit" disabled={busy || looking}>{t('sealed.addToCollection')}</button>
    </div></div>
  </form>;
}
