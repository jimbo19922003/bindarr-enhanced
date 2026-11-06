import { useEffect, useRef, useState } from 'react';
import { X, Zap } from 'lucide-react';
import { useT } from '../utils/i18n';
import { langCode } from '../utils/languages';

function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

let lineKey = 0;
const nextKey = () => {
  lineKey += 1;
  return lineKey;
};

const emptyLine = (bulk = false) => ({
  key: nextKey(),
  name: '',
  quantity: '1',
  current_value: '',
  value_at_opening: '',
  line_value: '',
  bulk,
  card_id: '',
  matches: [],
  note: '',
});

function recoveryLabel(percent) {
  if (percent == null || Number.isNaN(Number(percent))) return '—';
  return `${Number(percent).toFixed(1)}%`;
}

function money(currency, amount) {
  if (amount == null || amount === '') return '—';
  return `${currency} ${amount}`;
}

function SealedOpenings({ product, showToast, onChanged, ripLot, onCloseRip }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);

  const reload = async () => {
    const response = await fetch(`/api/sealed/products/${product.id}/openings`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
    setRows(data.openings || []);
  };

  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const response = await fetch(`/api/sealed/products/${product.id}/openings`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
        if (!gone) setRows(data.openings || []);
      } catch (err) {
        if (!gone) showToast(err.message);
      }
    })();
    return () => { gone = true; };
  // showToast and t are new every render. Reload when the product changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const saveOpening = async (body) => {
    if (!ripLot) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/sealed/lots/${ripLot.id}/openings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
      if (onCloseRip) onCloseRip();
      showToast(t('sealed.openingSaved'));
      await reload();
      if (onChanged) await onChanged();
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const patchOpening = async (opening, patch) => {
    const response = await fetch(`/api/sealed/openings/${opening.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
    await reload();
  };

  const removeOpening = async (opening) => {
    const response = await fetch(`/api/sealed/openings/${opening.id}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
    setConfirmRemove(null);
    await reload();
    if (onChanged) await onChanged();
  };

  const currencies = [...new Set(rows.map(row => row.currency))];

  return (
    <section style={{ display: 'grid', gap: '0.7rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--text-strong)' }}>{t('sealed.openingsTitle')}</strong>
      </div>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t('sealed.openHint')}</p>
      {currencies.length > 1 && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t('sealed.oneCurrencyNote')}</p>
      )}
      {rows.length === 0 && (
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('sealed.openingsEmpty')}</p>
      )}
      {rows.map(opening => (
        <OpeningCard
          key={opening.id}
          opening={opening}
          t={t}
          confirmRemove={confirmRemove === opening.id}
          onAskRemove={() => setConfirmRemove(opening.id)}
          onCancelRemove={() => setConfirmRemove(null)}
          onPatch={patchOpening}
          onRemove={removeOpening}
          onReload={reload}
          showToast={showToast}
        />
      ))}

      <div className={`drawer-backdrop ${ripLot ? 'open' : ''}`} onClick={onCloseRip} />
      <div className={`quick-add-drawer ${ripLot ? 'open' : ''}`} style={{ maxWidth: '720px' }}>
        {ripLot && (
          <RipForm
            key={ripLot.id}
            product={product}
            lot={ripLot}
            busy={busy}
            t={t}
            showToast={showToast}
            onClose={onCloseRip}
            onSubmit={saveOpening}
          />
        )}
      </div>
    </section>
  );
}

function pullFromCard(card, product, currency) {
  const priceCurrency = String(card.price_currency || 'USD').toUpperCase();
  const usable = card.price_trend != null && card.price_trend !== '' && priceCurrency === currency;
  const image = typeof card.image_url === 'string' && /^https?:\/\//.test(card.image_url) ? card.image_url : '';
  return {
    key: nextKey(),
    name: card.name,
    card_id: card.id,
    set_name: card.set_name || product.set_name || '',
    number: card.number || '',
    image_url: image,
    quantity: 1,
    current_value: usable ? Number(card.price_trend).toFixed(2) : '',
    value_at_opening: '',
    bulk: false,
  };
}

function RipForm({ product, lot, busy, t, showToast, onClose, onSubmit }) {
  const inputRef = useRef(null);
  const [openedAt, setOpenedAt] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [setCode, setSetCode] = useState('');
  const [setNote, setSetNote] = useState('');
  const [number, setNumber] = useState('');
  const [pulls, setPulls] = useState([]);
  const [matches, setMatches] = useState([]);
  const [looking, setLooking] = useState(false);
  const [entryComplete, setEntryComplete] = useState(false);
  const [bulk, setBulk] = useState(false);
  const setLabel = product.set_name || setCode;

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    let gone = false;
    const params = new URLSearchParams({
      code: product.set_id || '',
      name: product.set_name || '',
      lang: langCode(product.language || 'en'),
    });
    (async () => {
      try {
        const response = await fetch(`/api/sealed/card-set?${params.toString()}`);
        const data = await response.json().catch(() => ({}));
        if (gone || !response.ok) return;
        if (data.set_id) {
          setSetCode(data.set_id);
          setSetNote('');
        } else if (product.set_id) {
          setSetNote(t('sealed.ripSetCode', { code: product.set_id }));
        }
      } catch { /* the set field stays editable */ }
    })();
    return () => { gone = true; };
  // t is a new function every render. The set only needs to be resolved once per product.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.set_id, product.set_name, product.language]);

  const addCard = (card) => {
    setPulls(current => [pullFromCard(card, product, lot.currency), ...current]);
    setNumber('');
    setMatches([]);
    inputRef.current?.focus();
  };

  const lookupNumber = async () => {
    const typed = number.trim();
    if (!typed || looking) return;
    if (!setCode.trim()) {
      showToast(t('sealed.ripNeedsSet'));
      return;
    }
    setLooking(true);
    try {
      const params = new URLSearchParams({
        number: typed,
        set: setCode.trim(),
        scope: 'internet',
        game: 'pokemon',
        lang: langCode(product.language || 'en'),
        page: '1',
        limit: '10',
      });
      const response = await fetch(`/api/search?${params.toString()}`);
      const data = await response.json().catch(() => ([]));
      if (!response.ok) {
        showToast(data.error || t('sealed.errOpening'));
        return;
      }
      const found = Array.isArray(data) ? data : [];
      const exact = found.filter(card => String(card.number) === typed || parseInt(card.number, 10) === parseInt(typed, 10));
      const hit = exact.length === 1 ? exact[0] : (found.length === 1 ? found[0] : null);
      if (!hit) {
        if (found.length === 0) showToast(t('search.errNoSuchNumber', { number: typed, set: setLabel || setCode }));
        setMatches(found);
        return;
      }
      addCard(hit);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLooking(false);
      inputRef.current?.focus();
    }
  };

  const submit = (event) => {
    event.preventDefault();
    onSubmit({
      opened_at: openedAt,
      notes,
      entry_complete: entryComplete,
      pulls: pulls.map(pull => {
        if (pull.bulk) {
          return {
            name: pull.name.trim() || t('sealed.otherCards'),
            quantity: Number(pull.quantity) || 1,
            set_name: product.set_name || '',
            ...(pull.line_value.trim() ? { line_value: pull.line_value.trim() } : {}),
            ...(pull.value_at_opening.trim() ? { opened_line_value: pull.value_at_opening.trim() } : {}),
          };
        }
        return {
          name: pull.name,
          card_id: pull.card_id,
          quantity: pull.quantity,
          set_name: pull.set_name,
          number: pull.number,
          ...(pull.image_url ? { image_url: pull.image_url } : {}),
          ...(pull.current_value.trim() ? { current_value: pull.current_value.trim() } : {}),
          ...(pull.value_at_opening.trim() ? { value_at_opening: pull.value_at_opening.trim() } : {}),
        };
      }),
    });
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ color: 'var(--text-strong)', fontSize: '1.25rem', margin: 0 }}>{t('sealed.letItRip')}</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            {t('sealed.ripLot', { cost: `${lot.currency} ${lot.total_cost}`, date: lot.purchased_at ? ` on ${lot.purchased_at}` : '' })}
          </p>
        </div>
        <button className="btn btn-secondary btn-icon-only" type="button" onClick={onClose} style={{ borderRadius: '50%' }} aria-label={t('common.cancel')}>
          <X size={18} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>{t('sealed.openedOn')}</label>
          <input className="input-control" type="date" value={openedAt} onChange={e => setOpenedAt(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>{t('sealed.set')}</label>
          <input className="input-control" value={setCode} onChange={e => setSetCode(e.target.value)} aria-label={t('sealed.set')} />
          {product.set_name && <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{product.set_name}</p>}
          {setNote && <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{setNote}</p>}
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>{t('sealed.notes')}</label>
          <input className="input-control" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Zap size={18} style={{ color: 'var(--accent-yellow)' }} />
        <strong style={{ color: 'var(--text-strong)' }}>{setLabel ? t('search.rapidToSet', { set: setLabel }) : t('search.rapid')}</strong>
      </div>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{setCode.trim() ? t('sealed.ripReady') : t('sealed.ripNeedsSet')}</p>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          ref={inputRef}
          className="input-control"
          inputMode="numeric"
          placeholder={t('search.rapidNumberPlaceholder')}
          value={number}
          onChange={e => setNumber(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookupNumber(); } }}
          style={{ flex: '1 1 10rem', fontSize: '1.05rem', fontWeight: 700 }}
        />
        <button className="btn btn-secondary" type="button" onClick={lookupNumber} disabled={looking}>{t('sealed.addPull')}</button>
      </div>
      {matches.length > 0 && (
        <div style={{ display: 'grid', gap: '0.3rem' }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('sealed.ripSeveral', { count: matches.length, number: number.trim() })}</p>
          {matches.map(card => (
            <button key={card.id} className="btn btn-secondary" type="button" onClick={() => addCard(card)} style={{ justifyContent: 'flex-start' }}>
              #{card.number} {card.name}
            </button>
          ))}
        </div>
      )}
      {pulls.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '240px', overflowY: 'auto' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{t('search.addedThisSession', { count: pulls.length })}</div>
          {pulls.map(pull => (
            <div key={pull.key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.4rem 0.55rem', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--text-strong)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pull.bulk ? pull.name || t('sealed.otherCards') : `#${pull.number} ${pull.name}`}
                {pull.current_value ? ` · ${lot.currency} ${pull.current_value}` : ''}
              </span>
              {pull.bulk && (
                <>
                  <input className="input-control" type="number" min="1" value={pull.quantity} aria-label={t('card.quantity')} style={{ width: '4.2rem' }} onChange={e => setPulls(current => current.map(item => item.key === pull.key ? { ...item, quantity: e.target.value } : item))} />
                  <input className="input-control" value={pull.line_value} aria-label={t('sealed.lineValue')} placeholder={t('sealed.lineValue')} style={{ width: '6rem' }} onChange={e => setPulls(current => current.map(item => item.key === pull.key ? { ...item, line_value: e.target.value } : item))} />
                </>
              )}
              <button className="btn btn-secondary" type="button" onClick={() => setPulls(current => current.filter(item => item.key !== pull.key))}>{t('search.undo')}</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => {
            setBulk(true);
            setPulls(current => [{ key: nextKey(), bulk: true, name: t('sealed.otherCards'), quantity: '1', line_value: '', value_at_opening: '', current_value: '' }, ...current]);
          }}
        >
          {t('sealed.addBulk')}
        </button>
      </div>
      {bulk && <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('sealed.bulkHint')}</p>}
      <label style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
        <input type="checkbox" checked={entryComplete} onChange={e => setEntryComplete(e.target.checked)} />
        {t('sealed.markComplete')}
      </label>
      <div className="quick-add-footer">
        <div className="quick-add-footer-actions">
          <button className="btn btn-secondary" type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" type="submit" disabled={busy}>{t('sealed.letItRip')}</button>
        </div>
      </div>
    </form>
  );
}

function OpeningCard({ opening, t, confirmRemove, onAskRemove, onCancelRemove, onPatch, onRemove, onReload, showToast }) {
  const stats = opening.analytics;
  const [draft, setDraft] = useState(emptyLine(false));
  const prices = stats.recorded_quantity === 0
    ? t('sealed.noPulls')
    : (stats.unpriced_quantity > 0
      ? t('sealed.unpricedPulls', { count: stats.unpriced_quantity })
      : t('sealed.pricesComplete'));

  const addPull = async (event) => {
    event.preventDefault();
    const body = {
      name: draft.name.trim() || (draft.bulk ? t('sealed.otherCards') : ''),
      quantity: Number(draft.quantity || 1),
      card_id: draft.card_id || undefined,
    };
    if (!body.name && !body.card_id) return;
    if (draft.bulk) {
      if (draft.line_value.trim()) body.line_value = draft.line_value.trim();
      if (draft.value_at_opening.trim()) body.opened_line_value = draft.value_at_opening.trim();
    } else {
      if (draft.current_value.trim()) body.current_value = draft.current_value.trim();
      if (draft.value_at_opening.trim()) body.value_at_opening = draft.value_at_opening.trim();
    }
    try {
      const response = await fetch(`/api/sealed/openings/${opening.id}/pulls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
      setDraft(emptyLine(false));
      await onReload();
    } catch (err) {
      showToast(err.message);
    }
  };

  const savePull = async (pull, event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const line = pull.line_value != null;
    const body = {
      name: pull.name,
      quantity: pull.quantity,
      card_id: pull.card_id || undefined,
      collection_id: pull.collection_id || undefined,
      set_name: pull.set_name,
      number: pull.number,
      image_url: pull.image_url,
    };
    const current = String(form.get('current') || '').trim();
    const snapshot = String(form.get('snapshot') || '').trim();
    if (line) {
      if (current) body.line_value = current;
      if (snapshot) body.opened_line_value = snapshot;
    } else {
      if (current) body.current_value = current;
      if (snapshot) body.value_at_opening = snapshot;
    }
    try {
      const response = await fetch(`/api/sealed/openings/${opening.id}/pulls/${pull.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
      await onReload();
    } catch (err) {
      showToast(err.message);
    }
  };

  const removePull = async (pull) => {
    try {
      const response = await fetch(`/api/sealed/openings/${opening.id}/pulls/${pull.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
      await onReload();
    } catch (err) {
      showToast(err.message);
    }
  };

  return (
    <article className="glass-panel" style={{ padding: '0.9rem', display: 'grid', gap: '0.65rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <strong style={{ color: 'var(--text-strong)' }}>
            {opening.opened_at ? `${t('sealed.openedOn')} ${opening.opened_at}` : t('sealed.openingsTitle')}
          </strong>
          {opening.notes && <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{opening.notes}</div>}
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-strong)', fontSize: '0.8rem', border: '1px solid var(--border-glass)', borderRadius: '999px', padding: '0.15rem 0.55rem' }}>
            {stats.entry_complete ? t('sealed.entryComplete') : t('sealed.entryIncomplete')}
          </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', border: '1px solid var(--border-glass)', borderRadius: '999px', padding: '0.15rem 0.55rem' }}>
            {prices}
          </span>
        </div>
      </div>
      {!stats.entry_complete && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('sealed.entryIncompleteHint')}</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.55rem' }}>
        <Stat label={t('sealed.openingCost')} value={money(opening.currency, stats.cost)} />
        <Stat label={t('sealed.recordedPulls')} value={String(stats.recorded_quantity)} />
        <Stat label={t('sealed.knownValue')} value={money(opening.currency, stats.known_value)} />
        <Stat label={t('sealed.valueAtOpening')} value={stats.opened_value == null ? t('sealed.noSnapshot') : money(opening.currency, stats.opened_value)} />
        <Stat label={t('sealed.estimatedDifference')} value={money(opening.currency, stats.value_difference)} />
        <Stat label={t('sealed.recovery')} value={recoveryLabel(stats.cost_recovery_percent)} />
      </div>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('sealed.notProfit')}</p>
      {stats.opened_value != null && stats.missing_snapshot_quantity > 0 && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
          {t('sealed.missingSnapshot', { count: stats.missing_snapshot_quantity })}
        </p>
      )}
      {opening.pulls.map(pull => (
        <form key={pull.id} onSubmit={event => savePull(pull, event)} style={{ display: 'grid', gridTemplateColumns: 'minmax(8rem, 1.4fr) repeat(3, minmax(6rem, 1fr)) auto', gap: '0.4rem', alignItems: 'end' }}>
          <div>
            <div style={{ fontWeight: 650, color: 'var(--text-strong)' }}>{pull.name} × {pull.quantity}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
              {[pull.set_name, pull.number].filter(Boolean).join(' · ') || (pull.line_value != null ? t('sealed.addBulk') : '')}
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>{pull.line_value != null ? t('sealed.lineValue') : t('sealed.pullValue')}</label>
            <input className="input-control" name="current" defaultValue={pull.line_value != null ? pull.line_value || '' : pull.current_value || ''} placeholder={t('sealed.marketUnknown')} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>{t('sealed.snapshotValue')}</label>
            <input className="input-control" name="snapshot" defaultValue={pull.opened_line_value != null ? pull.opened_line_value || '' : pull.value_at_opening || ''} />
          </div>
          <button className="btn btn-secondary" type="submit">{t('sealed.save')}</button>
          <button className="btn btn-secondary" type="button" onClick={() => removePull(pull)}>{t('sealed.removePull')}</button>
        </form>
      ))}
      <form onSubmit={addPull} style={{ display: 'grid', gridTemplateColumns: 'minmax(8rem, 1.4fr) 5rem minmax(6rem, 1fr) minmax(6rem, 1fr) auto', gap: '0.4rem', alignItems: 'end' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>{t('sealed.pullName')}</label>
          <input className="input-control" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder={draft.bulk ? t('sealed.otherCards') : t('sealed.pullName')} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>{t('card.quantity')}</label>
          <input className="input-control" type="number" min="1" value={draft.quantity} onChange={e => setDraft({ ...draft, quantity: e.target.value })} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>{draft.bulk ? t('sealed.lineValue') : t('sealed.pullValue')}</label>
          <input className="input-control" value={draft.bulk ? draft.line_value : draft.current_value} onChange={e => setDraft({ ...draft, [draft.bulk ? 'line_value' : 'current_value']: e.target.value })} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>{t('sealed.snapshotValue')}</label>
          <input className="input-control" value={draft.value_at_opening} onChange={e => setDraft({ ...draft, value_at_opening: e.target.value })} />
        </div>
        <button className="btn btn-secondary" type="submit">{draft.bulk ? t('sealed.addBulk') : t('sealed.addPull')}</button>
      </form>
      <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" type="button" onClick={() => setDraft(emptyLine(!draft.bulk))}>
          {draft.bulk ? t('sealed.addPull') : t('sealed.addBulk')}
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => onPatch(opening, { entry_complete: !opening.entry_complete }).catch(err => showToast(err.message))}>
          {opening.entry_complete ? t('sealed.markIncomplete') : t('sealed.markComplete')}
        </button>
        {!confirmRemove && (
          <button className="btn btn-secondary" type="button" onClick={onAskRemove}>{t('sealed.removeOpening')}</button>
        )}
        {confirmRemove && (
          <>
            <button className="btn btn-primary" type="button" onClick={() => onRemove(opening).catch(err => showToast(err.message))}>{t('sealed.removeOpeningConfirm')}</button>
            <button className="btn btn-secondary" type="button" onClick={onCancelRemove}>{t('common.cancel')}</button>
          </>
        )}
      </div>
    </article>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ color: 'var(--text-strong)', fontWeight: 650 }}>{value}</div>
    </div>
  );
}

export default SealedOpenings;
