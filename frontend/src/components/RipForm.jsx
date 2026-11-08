import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { langCode } from '../utils/languages';
import CardImage from './CardImage';
let nextLine = 0;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const normalizedNumber = value => String(value || '').replace(/^#/, '').split('/')[0].trim().toLowerCase().replace(/^0+(?=\d)/, '');
const initialPull = pull => ({ ...pull, key: `saved-${pull.id}`, quantity: String(pull.quantity), bulk: !pull.card_id, lineMode: pull.line_value != null || pull.opened_line_value != null, current_value: String(pull.current_value ?? ''), line_value: String(pull.line_value ?? ''), value_at_opening: String(pull.value_at_opening ?? '') });
export default function RipForm({ product, lot, existingOpening, busy, t, showToast, onClose, onSubmit }) {
  const editing = !!existingOpening, currency = existingOpening?.currency || lot.currency;
  const inputRef = useRef(null), chosen = useRef(false), request = useRef(0), mutation = useRef(null);
  const [openedAt, setOpenedAt] = useState(() => existingOpening?.opened_at || today());
  const [notes, setNotes] = useState(() => existingOpening?.notes || '');
  const [sets, setSets] = useState([]), [setId, setSetId] = useState(''), [resolved, setResolved] = useState(null), [setError, setSetError] = useState(false);
  const [query, setQuery] = useState(''), [pulls, setPulls] = useState(() => (existingOpening?.pulls || []).map(initialPull));
  const [removed, setRemoved] = useState([]), [matches, setMatches] = useState([]), [looking, setLooking] = useState(false);
  const [entryComplete, setEntryComplete] = useState(() => !!existingOpening?.entry_complete);
  const language = langCode(product.language || 'en');
  useEffect(() => { inputRef.current?.focus(); return () => { request.current++; }; }, []);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ code: product.set_id || '', name: product.set_name || '', lang: language });
    fetch(`/api/sets?game=pokemon&lang=${encodeURIComponent(language)}`).then(async response => { if (!response.ok) throw new Error('sets'); return response.json(); })
      .then(data => { if (!cancelled) { setSets(Array.isArray(data) ? data.filter(row => row.id) : []); setSetError(false); } }).catch(() => { if (!cancelled) setSetError(true); });
    fetch(`/api/sealed/card-set?${params}`).then(async response => { if (!response.ok) throw new Error('default set'); return response.json(); }).then(data => {
      if (cancelled || !data.set_id) return; setResolved({ id: data.set_id, name: data.set_name || product.set_name || data.set_id }); if (!chosen.current) setSetId(data.set_id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [product.set_id, product.set_name, language]);
  const options = sets.slice(); if (resolved && !options.some(row => row.id === resolved.id)) options.push(resolved);
  const selected = options.find(row => row.id === setId), searchSetLabel = setId ? selected?.name || setId : 'All Pokémon sets';
  const changeSet = value => { chosen.current = true; request.current++; setLooking(false); setSetId(value); setMatches([]); inputRef.current?.focus(); };
  const addCard = card => {
    const amount = Number(card.price_trend), sourceCurrency = String(card.price_currency || 'USD').toUpperCase();
    const price = amount > 0 && Number.isFinite(amount) && sourceCurrency === currency ? amount.toFixed(2) : '';
    setPulls(current => [{ key: `new-${++nextLine}`, card_id: card.id, name: card.name, number: card.number || '', set_name: card.set_name || selected?.name || '',
      image_url: /^https?:\/\//.test(card.image_url || '') ? card.image_url : '', quantity: '1', current_value: price, value_at_opening: '', bulk: false, lineMode: false, original_price: amount > 0 ? `${sourceCurrency} ${amount.toFixed(2)}` : '' }, ...current]);
    setQuery(''); setMatches([]); inputRef.current?.focus();
  };
  const lookup = async () => {
    const typed = query.trim().replace(/^#/, ''); if (!typed || looking || busy) return;
    const byNumber = /^[A-Za-z]{0,8}\d+[A-Za-z★]?(?:\/[A-Za-z0-9]+)?$/.test(typed);
    if (!setId && byNumber) { showToast('Select a card set for number-only entry, or search all sets by card name.'); return; }
    const ticket = ++request.current; setLooking(true); setMatches([]);
    try {
      const params = new URLSearchParams({ game: 'pokemon', scope: 'internet', lang: language, page: '1', limit: '25' }); if (setId) params.set('set', setId); params.set(byNumber ? 'number' : 'name', byNumber ? typed.split('/')[0] : typed);
      const response = await fetch(`/api/search?${params}`), data = await response.json().catch(() => []); if (ticket !== request.current) return;
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
      const found = Array.isArray(data) ? data : [], exact = found.filter(card => byNumber ? normalizedNumber(card.number) === normalizedNumber(typed) : String(card.name || '').toLowerCase() === typed.toLowerCase());
      if (setId && exact.length === 1) addCard(exact[0]); else { setMatches(found); if (!found.length) showToast(t('sealed.ripNone', { query: typed, set: searchSetLabel })); }
    } catch (error) { if (ticket === request.current) showToast(error.message); } finally { if (ticket === request.current) { setLooking(false); inputRef.current?.focus(); } }
  };
  const editPull = (key, field, value) => setPulls(current => current.map(pull => pull.key === key ? { ...pull, [field]: value } : pull));
  const remove = pull => { setRemoved(current => [pull, ...current]); setPulls(current => current.filter(row => row.key !== pull.key)); };
  const submit = event => {
    event.preventDefault(); if (busy || looking) return;
    const payload = { opened_at: openedAt, notes, entry_complete: entryComplete, pulls: pulls.map(pull => {
      const row = { name: pull.name.trim() || t('sealed.otherCards'), quantity: Number(pull.quantity), card_id: pull.card_id || '', set_name: pull.set_name || '', number: pull.number || '', ...(pull.image_url ? { image_url: pull.image_url } : {}) };
      if (pull.id) { row.id = pull.id; if (pull.lineMode) { if (pull.line_value !== '') row.line_value = pull.line_value; } else if (pull.current_value !== '') row.current_value = pull.current_value; }
      else if (pull.bulk) { if (pull.line_value.trim()) row.line_value = pull.line_value.trim(); if (pull.value_at_opening.trim()) row.opened_line_value = pull.value_at_opening.trim(); }
      return row;
    }) };
    if (editing) {
      payload.base = existingOpening; const signature = JSON.stringify(payload);
      if (mutation.current?.signature !== signature) mutation.current = { signature, id: crypto.randomUUID() };
      payload.request_id = mutation.current.id;
    }
    onSubmit(payload);
  };
  return <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', width: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
      <div><h3 style={{ margin: 0 }}>{editing ? 'Edit rip' : t('sealed.letItRip')}</h3><p>{product.name || product.set_name}</p>
        <p>{editing ? `Original opening cost: ${currency} ${existingOpening.cost} — unchanged by editing` : t('sealed.ripLot', { cost: `${currency} ${lot.total_cost}`, date: lot.purchased_at ? ` on ${lot.purchased_at}` : '' })}</p></div>
      <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy} aria-label={t('common.cancel')}><X size={18} /></button>
    </div>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.9rem', minWidth: 0 }}>
      <label>{t('sealed.openedOn')}<input className="input-control" type="date" value={openedAt} onChange={e => setOpenedAt(e.target.value)} /></label>
      <label htmlFor="rip-card-set">Card search set</label>
      <select id="rip-card-set" className="input-control" value={setId} onChange={e => changeSet(e.target.value)}>
        <option value="">All Pokémon sets — search by name</option>
        {setId && !options.some(row => row.id === setId) && <option value={setId}>{setId}</option>}
        {options.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).map(row => <option key={row.id} value={row.id}>{row.name} ({row.id})</option>)}
      </select>
      <small>Sealed product set: {product.set_name || 'Unspecified'}. Changing the search set keeps the existing pulls.</small>
      {setError && <p role="status">Could not load the set list. Use all-set name search or a set ID override.</p>}
      <details><summary>Set ID override</summary><input className="input-control" aria-label="Card search set ID override" value={setId} onChange={e => changeSet(e.target.value)} /></details>
      <label>{t('sealed.notes')}<input className="input-control" value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <h4 style={{ margin: 0 }}>Searching: {searchSetLabel}</h4>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input ref={inputRef} className="input-control" placeholder={t('sealed.ripQuery')} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } }} />
        <button className="btn btn-secondary" type="button" onClick={lookup} disabled={looking}>{t('sealed.addPull')}</button>
      </div>
      {matches.map(card => <button className="btn btn-secondary" type="button" key={card.id} onClick={() => addCard(card)} style={{ justifyContent: 'flex-start', gap: '0.5rem' }}>
        <CardImage card={card} style={{ width: 30, height: 42, objectFit: 'contain' }} /> #{card.number} {card.name} — {card.set_name}
      </button>)}
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'grid', gap: '0.5rem' }}>
        {pulls.map(pull => <div key={pull.key} style={{ border: '1px solid var(--border-glass)', padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}>
          <div>{pull.bulk ? pull.name : `#${pull.number} ${pull.name} — ${pull.set_name}`} {editing && <small>{pull.id ? '(recorded)' : '(new)'}</small>}</div>
          {!pull.bulk && <small>{pull.id ? `${currency} ${pull.current_value || '—'}` : pull.original_price ? `${pull.original_price} source quote; valued in ${currency} on save` : 'Unpriced'}</small>}
          <label>{t('card.quantity')}<input className="input-control" type="number" min="1" max="5000" required value={pull.quantity} onChange={e => editPull(pull.key, 'quantity', e.target.value)} /></label>
          {pull.bulk && <label>{pull.id && !pull.lineMode ? t('sealed.pullValue') : t('sealed.lineValue')}<input className="input-control" value={pull.id && !pull.lineMode ? pull.current_value : pull.line_value} onChange={e => editPull(pull.key, pull.id && !pull.lineMode ? 'current_value' : 'line_value', e.target.value)} /></label>}
          <button className="btn btn-secondary" type="button" onClick={() => remove(pull)}>{pull.id ? 'Remove from rip' : t('search.undo')}</button>
        </div>)}
      </div>
      {removed.length > 0 && <button className="btn btn-secondary" type="button" onClick={() => { const [last, ...rest] = removed; setPulls(current => [last, ...current]); setRemoved(rest); }}>Undo last removal</button>}
      <button className="btn btn-secondary" type="button" onClick={() => setPulls(current => [{ key: `new-${++nextLine}`, bulk: true, lineMode: true, card_id: '', name: t('sealed.otherCards'), quantity: '1', line_value: '', current_value: '', value_at_opening: '', set_name: product.set_name || '' }, ...current])}>{t('sealed.addBulk')}</button>
      <label><input type="checkbox" checked={entryComplete} onChange={e => setEntryComplete(e.target.checked)} /> {t('sealed.markComplete')}</label>
    </fieldset>
    <div className="quick-add-footer"><div className="quick-add-footer-actions">
      <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
      <button className="btn btn-primary" type="submit" disabled={busy || looking}>{editing ? 'Save changes' : t('sealed.addToCollection')}</button>
    </div></div>
  </form>;
}
