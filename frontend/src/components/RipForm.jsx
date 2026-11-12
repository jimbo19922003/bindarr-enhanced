import OpeningBasisPanel from './OpeningBasisPanel';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { langCode } from '../utils/languages';
import { draftOwnership, candidateOwnership, isBinderUpgrade } from '../utils/ripOwnership';
import { canSplitRipLine, splitRipLine, MAX_RIP_LINES } from '../utils/ripLines';
import { resolveCardPrice } from '../utils/resolveCardPrice';
import { availablePrintings, preferredPrinting, exactPrintingPrice } from '../utils/availablePrintings';
import CardImage from './CardImage';
import PriceQuoteDetails from './PriceQuoteDetails';
let nextLine = 0;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const normalizedNumber = value => String(value || '').replace(/^#/, '').split('/')[0].trim().toLowerCase().replace(/^0+(?=\d)/, '');
const initialPull = pull => ({ ...pull, key: `saved-${pull.id}`, quantity: String(pull.quantity), bulk: !pull.card_id, lineMode: pull.line_value != null, current_value: String(pull.current_value ?? ''), line_value: String(pull.line_value ?? ''), value_at_opening: String(pull.value_at_opening ?? '') });
function OwnershipBadge({ info, loading }) {
  if (!info) return null;
  const fresh = info.kind === 'new' || info.kind === 'first';
  return <span title={info.title} data-ownership={info.kind} style={{ display: 'inline-block', margin: '0.25rem 0', padding: '0.15rem 0.4rem', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, color: fresh ? 'var(--type-grass)' : 'var(--text-secondary)', border: '1px solid var(--border-glass)' }}>{info.kind === 'unknown' && loading ? 'Checking ownership…' : info.text}</span>;
}
// What the server will value a new card line at: the printing's own quote when
// the provider has one, otherwise the card's general market price as an estimate.
function lineQuote(card, printing) {
  const exact = exactPrintingPrice(card, printing);
  if (exact > 0) return { amount: exact, estimate: false };
  const general = Number(resolveCardPrice(card));
  return general > 0 && Number.isFinite(general) ? { amount: general, estimate: true } : null;
}
export default function RipForm({ product, lot, existingOpening, convertToPacks = false, busy, saveStatus, onStopWaiting, t, showToast, onClose, onSubmit }) {
  const editing = !!existingOpening, currency = existingOpening?.currency || lot.currency;
  const conversionCents = convertToPacks ? BigInt(lot.remaining_cost_cents) / BigInt(lot.remaining_quantity) : null;
  const conversionCost = conversionCents == null ? null : `${conversionCents / 100n}.${String(conversionCents % 100n).padStart(2, '0')}`;
  const inputRef = useRef(null), chosen = useRef(false), request = useRef(0), mutation = useRef(null), live = useRef(true);
  const [openedAt, setOpenedAt] = useState(() => existingOpening?.opened_at || today());
  const [notes, setNotes] = useState(() => existingOpening?.notes || '');
  const [packGroups, setPackGroups] = useState(() => [{ key: ++nextLine, name: t('sealed.defaultPackName', { name: product.set_name || product.name }), set_name: product.set_name || '', set_id: product.set_id || '', quantity: '1', market_value: '' }]);
  const [promosComplete, setPromosComplete] = useState(true);
  const [sets, setSets] = useState([]), [setId, setSetId] = useState(''), [resolved, setResolved] = useState(null), [setError, setSetError] = useState(false);
  const [query, setQuery] = useState(''), [pulls, setPulls] = useState(() => (existingOpening?.pulls || []).map(initialPull));
  const [removed, setRemoved] = useState([]), [matches, setMatches] = useState([]), [looking, setLooking] = useState(false);
  const [owned, setOwned] = useState({}), [ownedPrintings, setOwnedPrintings] = useState({}), [ownershipPending, setOwnershipPending] = useState(0), [ownershipError, setOwnershipError] = useState(false);
  const language = langCode(product.language || 'en');
  useEffect(() => {
    const requestRef = request;
    live.current = true;
    inputRef.current?.focus();
    return () => { live.current = false; requestRef.current++; };
  }, []);
  const loadOwnership = async cardIds => {
    const ids = [...new Set(cardIds.filter(Boolean))]; if (!ids.length) return;
    if (live.current) setOwnershipPending(value => value + 1);
    try {
      const response = await fetch('/api/sealed/rip-ownership', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ card_ids: ids, ...(editing ? { opening_id: existingOpening.id } : {}) }) });
      const data = await response.json().catch(() => ({})); if (!response.ok || !data.counts) throw new Error('ownership');
      const counts = Object.fromEntries(ids.map(id => [id, Number.isSafeInteger(data.counts[id]) && data.counts[id] >= 0 ? data.counts[id] : null]));
      const printings = Object.fromEntries(ids.map(id => [id, Array.isArray(data.printings?.[id]) ? data.printings[id] : null]));
      if (live.current) { setOwned(previous => ({ ...previous, ...counts })); setOwnedPrintings(previous => ({ ...previous, ...printings })); setOwnershipError(false); }
    } catch {
      if (live.current) { setOwned(previous => ({ ...previous, ...Object.fromEntries(ids.map(id => [id, null])) })); setOwnedPrintings(previous => ({ ...previous, ...Object.fromEntries(ids.map(id => [id, null])) })); setOwnershipError(true); }
    } finally { if (live.current) setOwnershipPending(value => Math.max(0, value - 1)); }
  };
  useEffect(() => {
    void loadOwnership((existingOpening?.pulls || []).map(pull => pull.card_id));
    // The keyed form owns a stable opening snapshot throughout an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingOpening?.id]);
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
  const statuses = draftOwnership(pulls, owned, editing);
  const changeSet = value => { chosen.current = true; request.current++; setLooking(false); setSetId(value); setMatches([]); inputRef.current?.focus(); };
  const addCard = async card => {
    const ticket = request.current;
    if (pulls.length >= MAX_RIP_LINES) { showToast(t('sealed.maxLines', { count: MAX_RIP_LINES })); return; }
    if (String(card.id).startsWith('tcgdex-en-')) {
      setLooking(true);
      try {
        const response = await fetch(`/api/cards/${encodeURIComponent(card.id)}/price-quote`);
        if (!response.ok) throw new Error(t('pricing.refreshFailed'));
        card = { ...card, ...await response.json() };
        if (!live.current || ticket !== request.current) return;
      } catch (error) {
        if (live.current && ticket === request.current) showToast(error.message);
        return;
      } finally { if (live.current && ticket === request.current) setLooking(false); }
    }
    const printing = preferredPrinting(card), sequence = ++nextLine;
    const incoming = { key: `new-${sequence}`, added_order: sequence, card_id: card.id, name: card.name, number: card.number || '', set_name: card.set_name || selected?.name || '',
      image_url: /^https?:\/\//.test(card.image_url || '') ? card.image_url : '', quantity: '1', current_value: '', value_at_opening: '', bulk: false, lineMode: false,
      printing, card, language: card.language || product.language || 'English', condition: 'Near Mint' };
    // Each add is its own line: duplicates are often different printings.
    setPulls(current => [incoming, ...current]);
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
      const found = Array.isArray(data) ? data : [];
      await loadOwnership(found.map(card => card.id)); if (ticket !== request.current) return;
      const exact = found.filter(card => byNumber ? normalizedNumber(card.number) === normalizedNumber(typed) : String(card.name || '').toLowerCase() === typed.toLowerCase());
      if (setId && exact.length === 1) await addCard(exact[0]); else { setMatches(found); if (!found.length) showToast(t('sealed.ripNone', { query: typed, set: searchSetLabel })); }
    } catch (error) { if (ticket === request.current) showToast(error.message); } finally { if (ticket === request.current) { setLooking(false); inputRef.current?.focus(); } }
  };
  const editPull = (key, field, value) => setPulls(current => current.map(pull => pull.key === key ? { ...pull, [field]: value } : pull));
  const split = pull => {
    if (pulls.length - 1 + Number(pull.quantity) > MAX_RIP_LINES) { showToast(t('sealed.maxLines', { count: MAX_RIP_LINES })); return; }
    setPulls(current => splitRipLine(current, pull.key, () => ++nextLine));
  };
  const atLineLimit = () => { if (pulls.length < MAX_RIP_LINES) return false; showToast(t('sealed.maxLines', { count: MAX_RIP_LINES })); return true; };
  const remove = pull => { setRemoved(current => [pull, ...current]); setPulls(current => current.filter(row => row.key !== pull.key)); };
  const submit = event => {
    event.preventDefault(); if (busy || looking) return;
    const payload = { opened_at: openedAt, notes, entry_complete: convertToPacks ? promosComplete : true, pulls: pulls.map(pull => {
      const row = { name: pull.name.trim() || t('sealed.otherCards'), quantity: Number(pull.quantity), card_id: pull.card_id || '', set_name: pull.set_name || '', number: pull.number || '', ...(pull.image_url ? { image_url: pull.image_url } : {}) };
      if (pull.id) { row.id = pull.id; if (pull.lineMode) { if (pull.line_value !== '') row.line_value = pull.line_value; } else if (pull.current_value !== '') row.current_value = pull.current_value; }
      else if (pull.bulk) { if (pull.line_value.trim()) row.line_value = pull.line_value.trim(); if (pull.value_at_opening.trim()) row.opened_line_value = pull.value_at_opening.trim(); }
      else { row.printing = pull.printing; if (String(pull.current_value || '').trim()) row.current_value = String(pull.current_value).trim(); }
      return row;
    }) };
    if (convertToPacks) payload.packs = packGroups.map(({ name, set_name, set_id, quantity, market_value }) => ({ name, set_name, set_id, quantity: Number(quantity), market_value, language: product.language || 'English' }));
    if (editing || convertToPacks) {
      if (editing) payload.base = existingOpening;
      const signature = JSON.stringify(payload);
      if (mutation.current?.signature !== signature) mutation.current = { signature, id: crypto.randomUUID() };
      payload.request_id = mutation.current.id;
    }
    onSubmit(payload);
  };
  return <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', width: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
      <div><h3 style={{ margin: 0 }}>{convertToPacks ? t('sealed.convertToPacks') : editing ? 'Edit rip' : t('sealed.letItRip')}</h3><p>{product.name || product.set_name}</p>
        <p>{existingOpening?.cost_pending || lot.cost_pending ? t('sealed.pendingCostHelp') : editing ? `Original opening cost: ${currency} ${existingOpening.cost} — unchanged by editing` : convertToPacks ? t('sealed.conversionSourceCost', { cost: `${currency} ${conversionCost}` }) : t('sealed.ripLot', { cost: `${currency} ${lot.total_cost}`, date: lot.purchased_at ? ` on ${lot.purchased_at}` : '' })}</p></div>
      <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy} aria-label={t('common.cancel')}><X size={18} /></button>
    </div>
    {editing && <OpeningBasisPanel openingId={existingOpening.id} />}
    <p>Saving recalculates allocated opening costs from the saved opening-time values and revised quantities. The original opening cost is unchanged. Missing values remain pending; allocations frozen by a sale require a correction workflow.</p>
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
      {convertToPacks && <section style={{ display: 'grid', gap: '0.6rem' }}>
        <h4>{t('sealed.packContents')}</h4>
        <p>{t('sealed.conversionHelp', { currency })}</p>
        {packGroups.map(group => <div key={group.key} style={{ border: '1px solid var(--border-glass)', padding: '0.6rem', display: 'grid', gap: '0.4rem' }}>
          {['name', 'set_name', 'quantity', 'market_value'].map(field => <label key={field}>{t(`sealed.packField.${field}`, { currency })}
            <input className="input-control" type={field === 'quantity' ? 'number' : 'text'} min={field === 'quantity' ? 1 : undefined} max={field === 'quantity' ? 500 : undefined}
              required={field === 'name' || field === 'quantity'} inputMode={field === 'market_value' ? 'decimal' : undefined} value={group[field]}
              onChange={e => setPackGroups(current => current.map(row => row.key === group.key ? { ...row, [field]: e.target.value, ...(field === 'set_name' ? { set_id: '' } : {}) } : row))} />
          </label>)}
          {packGroups.length > 1 && <button className="btn btn-secondary" type="button" onClick={() => setPackGroups(current => current.filter(row => row.key !== group.key))}>{t('sealed.removePackGroup')}</button>}
        </div>)}
        <button className="btn btn-secondary" type="button" disabled={packGroups.length >= 20} onClick={() => setPackGroups(current => [...current, { key: ++nextLine, name: '', set_name: '', set_id: '', quantity: '1', market_value: '' }])}>{t('sealed.addPackGroup')}</button>
        <h4>{t('sealed.promos')}</h4>
        <label><input type="checkbox" checked={promosComplete} onChange={e => setPromosComplete(e.target.checked)} /> {t('sealed.promosComplete')}</label>
      </section>}
      <h4 style={{ margin: 0 }}>Searching: {searchSetLabel}</h4>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input ref={inputRef} className="input-control" placeholder={t('sealed.ripQuery')} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } }} />
        <button className="btn btn-secondary" type="button" onClick={lookup} disabled={looking}>{t('sealed.addPull')}</button>
      </div>
      {ownershipError && <small role="status">Ownership check unavailable. Unknown cards are not marked as new.</small>}
      {matches.map(card => <button className="btn btn-secondary" type="button" key={card.id} disabled={looking} onClick={() => addCard(card)} style={{ justifyContent: 'flex-start', gap: '0.5rem' }}>
        <CardImage card={card} style={{ width: 30, height: 42, objectFit: 'contain' }} /><span>#{card.number} {card.name} — {card.set_name}<br /><OwnershipBadge info={candidateOwnership(card.id, pulls, owned, editing)} loading={ownershipPending > 0} /></span>
      </button>)}
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'grid', gap: '0.5rem' }}>
        {pulls.map(pull => <div key={pull.key} style={{ border: '1px solid var(--border-glass)', padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}>
          <div>{pull.bulk ? pull.name : `#${pull.number} ${pull.name} — ${pull.set_name}`} {editing && <small>{pull.id ? '(recorded)' : '(new entry)'}</small>}</div>
          <OwnershipBadge info={statuses[pull.key]} loading={ownershipPending > 0} />
          {!pull.bulk && !pull.id && <label>{t('card.printing')}<select className="input-control" value={pull.printing} onChange={e => editPull(pull.key, 'printing', e.target.value)}>
            {availablePrintings(pull.card).options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>{!availablePrintings(pull.card).verified && <small>{t('card.printingUnverified')}</small>}</label>}
          {!pull.bulk && !pull.id && owned[pull.card_id] > 0 && isBinderUpgrade(pull.printing, ownedPrintings[pull.card_id]) && <span title={t('sealed.binderUpgradeHelp')} style={{ display: 'block', color: 'var(--type-grass)', fontSize: '0.72rem', fontWeight: 600 }}>{t('sealed.binderUpgrade')}</span>}
          {!pull.bulk && pull.id && <small style={{ display: 'block' }}>{`${currency} ${pull.current_value || '—'}`}</small>}
          {!pull.bulk && !pull.id && <QuoteLine card={pull.card} printing={pull.printing} currency={currency} t={t} />}
          <label>{t('card.quantity')}<input className="input-control" type="number" min="1" max="5000" required value={pull.quantity} onChange={e => editPull(pull.key, 'quantity', e.target.value)} /></label>
          {!pull.bulk && !pull.id && <label>{t('sealed.valueEach', { currency })}<input className="input-control" inputMode="decimal" placeholder={t('sealed.valueAuto')} value={pull.current_value} onChange={e => editPull(pull.key, 'current_value', e.target.value)} /></label>}
          {canSplitRipLine(pull) && <button className="btn btn-secondary" type="button" onClick={() => split(pull)}>{t('sealed.splitLines')}</button>}
          {pull.bulk && <label>{pull.id && !pull.lineMode ? t('sealed.pullValue') : t('sealed.lineValue')}<input className="input-control" value={pull.id && !pull.lineMode ? pull.current_value : pull.line_value} onChange={e => editPull(pull.key, pull.id && !pull.lineMode ? 'current_value' : 'line_value', e.target.value)} /></label>}
          <button className="btn btn-secondary" type="button" onClick={() => remove(pull)}>{pull.id ? 'Remove from rip' : Number(pull.quantity) > 1 ? 'Remove line' : t('search.undo')}</button>
        </div>)}
      </div>
      {removed.length > 0 && <button className="btn btn-secondary" type="button" onClick={() => { if (atLineLimit()) return; const [last, ...rest] = removed; setPulls(current => [last, ...current]); setRemoved(rest); }}>Undo last removal</button>}
      <button className="btn btn-secondary" type="button" onClick={() => !atLineLimit() && setPulls(current => [{ key: `new-${++nextLine}`, bulk: true, lineMode: true, card_id: '', name: t('sealed.otherCards'), quantity: '1', line_value: '', current_value: '', value_at_opening: '', set_name: product.set_name || '' }, ...current])}>{t('sealed.addBulk')}</button>
      <small>{convertToPacks ? t('sealed.conversionSaveHint') : 'Saving records this rip as complete. You can edit its contents later unless a sale has frozen the opening\'s acquisition basis.'}</small>
    </fieldset>
    {saveStatus && <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', color: saveStatus.error ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
      <span style={{ flex: 1 }}>{saveStatus.error || t('sealed.savingRip', { seconds: saveStatus.seconds })}</span>
      {!saveStatus.error && saveStatus.seconds >= 15 && onStopWaiting && <button className="btn btn-secondary" type="button" onClick={onStopWaiting}>{t('sealed.stopWaiting')}</button>}
    </div>}
    <div className="quick-add-footer"><div className="quick-add-footer-actions">
      <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
      <button className="btn btn-primary" type="submit" disabled={busy || looking}>{busy ? t('sealed.saving') : convertToPacks ? t('sealed.convertToPacks') : editing ? 'Save changes' : t('sealed.addToCollection')}</button>
    </div></div>
  </form>;
}
function QuoteLine({ card, printing, currency, t }) {
  const quote = lineQuote(card, printing), source = String(card?.price_currency || 'USD').toUpperCase();
  if (!quote) return <small style={{ display: 'block' }}>{t('card.printingUnpriced')}</small>;
  const price = `${source} ${quote.amount.toFixed(2)}`;
  return <><small style={{ display: 'block' }}>{quote.estimate ? t('sealed.printingEstimate', { printing, price, currency }) : t('sealed.printingQuote', { printing, price, currency })}</small><PriceQuoteDetails card={card} printing={printing} /></>;
}
