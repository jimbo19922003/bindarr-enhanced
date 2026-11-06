import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useT } from '../utils/i18n';

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

function SealedOpenings({ product, showToast, onChanged }) {
  const { t } = useT();
  const [rows, setRows] = useState([]);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const openable = (product.lots || []).filter(lot => !lot.archived_at && lot.remaining_quantity > 0);

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

  const start = () => {
    if (!openable.length) return;
    setDialog(true);
  };

  const saveOpening = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pulls = [];
    const count = Number(form.get('pull-count') || 0);
    for (let index = 0; index < count; index += 1) {
      const bulk = form.get(`bulk-${index}`) === '1';
      const name = String(form.get(`name-${index}`) || '').trim();
      const cardId = String(form.get(`card-${index}`) || '').trim();
      if (!name && !cardId && !bulk) continue;
      const pull = {
        name: name || t('sealed.otherCards'),
        quantity: Number(form.get(`qty-${index}`) || 1),
        card_id: cardId || undefined,
      };
      const current = String(form.get(`current-${index}`) || '').trim();
      const snapshot = String(form.get(`snapshot-${index}`) || '').trim();
      if (bulk) {
        if (current) pull.line_value = current;
        if (snapshot) pull.opened_line_value = snapshot;
      } else {
        if (current) pull.current_value = current;
        if (snapshot) pull.value_at_opening = snapshot;
      }
      pulls.push(pull);
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/sealed/lots/${form.get('lot_id')}/openings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opened_at: form.get('opened_at') || '',
          notes: form.get('notes') || '',
          entry_complete: form.get('entry_complete') === 'on',
          pulls,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
      setDialog(false);
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
        {openable.length > 0 && (
          <button className="btn btn-primary" type="button" onClick={start}>{t('sealed.openUnit')}</button>
        )}
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

      <div className={`drawer-backdrop ${dialog ? 'open' : ''}`} onClick={() => setDialog(false)} />
      <div className={`quick-add-drawer ${dialog ? 'open' : ''}`} style={{ maxWidth: '720px' }}>
        {dialog && openable.length > 0 && (
          <OpeningForm lots={openable} busy={busy} t={t} onClose={() => setDialog(false)} onSubmit={saveOpening} />
        )}
      </div>
    </section>
  );
}

function OpeningForm({ lots, busy, t, onClose, onSubmit }) {
  const [lines, setLines] = useState([emptyLine(false)]);
  const [lotId, setLotId] = useState(String(lots[0].id));
  const lot = lots.find(item => String(item.id) === lotId) || lots[0];
  const currency = lot.currency;

  const lookup = async (key) => {
    const line = lines.find(item => item.key === key);
    const q = (line?.name || '').trim();
    if (q.length < 2) return;
    const response = await fetch(`/api/sealed/cards?q=${encodeURIComponent(q)}`);
    const data = await response.json().catch(() => ({}));
    const matches = response.ok ? (data.cards || []) : [];
    setLines(current => current.map(item => (item.key === key ? { ...item, matches, note: matches.length ? '' : t('sealed.noCardMatch') } : item)));
  };

  const choose = (key, card) => {
    const pricedHere = card.price != null && String(card.currency || '').toUpperCase() === currency;
    setLines(current => current.map(item => {
      if (item.key !== key) return item;
      return {
        ...item,
        card_id: card.id,
        name: card.name,
        matches: [],
        note: pricedHere ? '' : (card.currency ? t('sealed.currencySkipped', { currency: card.currency }) : ''),
        current_value: pricedHere && item.current_value === '' ? Number(card.price).toFixed(2) : item.current_value,
      };
    }));
  };

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', width: '100%' }}>
      <input type="hidden" name="pull-count" value={lines.length} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ color: 'var(--text-strong)', fontSize: '1.25rem', margin: 0 }}>{t('sealed.openTitle')}</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>{t('sealed.openHint')}</p>
        </div>
        <button className="btn btn-secondary btn-icon-only" type="button" onClick={onClose} style={{ borderRadius: '50%' }} aria-label={t('common.cancel')}>
          <X size={18} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>{t('sealed.lotToOpen')}</label>
          <select className="select-control" name="lot_id" value={lotId} onChange={e => setLotId(e.target.value)}>
            {lots.map(lot => (
              <option key={lot.id} value={lot.id}>
                {t('sealed.openLot', { remaining: lot.remaining_quantity, basis: `${lot.currency} ${lot.remaining_cost}` })}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>{t('sealed.openedOn')}</label>
          <input className="input-control" type="date" name="opened_at" />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>{t('sealed.notes')}</label>
          <input className="input-control" name="notes" />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '40vh', overflowY: 'auto' }}>
        {lines.map((line, index) => (
          <div key={line.key} style={{ display: 'grid', gap: '0.55rem', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
            <input type="hidden" name={`bulk-${index}`} value={line.bulk ? '1' : '0'} />
            <input type="hidden" name={`card-${index}`} value={line.card_id} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
              <strong style={{ color: 'var(--text-strong)', fontSize: '0.9rem' }}>{line.bulk ? t('sealed.addBulk') : t('sealed.addPull')}</strong>
              <button className="btn btn-secondary" type="button" onClick={() => setLines(current => current.filter(item => item.key !== line.key))}>{t('sealed.removePull')}</button>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>{t('sealed.pullName')}</label>
              <div style={{ display: 'flex', gap: '0.45rem' }}>
                <input className="input-control" name={`name-${index}`} value={line.name} onChange={e => setLines(current => current.map(item => item.key === line.key ? { ...item, name: e.target.value, card_id: '' } : item))} />
                {!line.bulk && (
                  <button className="btn btn-secondary" type="button" onClick={() => lookup(line.key)}>{t('sealed.findCard')}</button>
                )}
              </div>
              {line.note && <p style={{ margin: '0.3rem 0 0', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{line.note}</p>}
              {line.matches.length > 0 && (
                <div style={{ display: 'grid', gap: '0.25rem', marginTop: '0.35rem' }}>
                  {line.matches.map(card => (
                    <button key={card.id} className="btn btn-secondary" type="button" onClick={() => choose(line.key, card)} style={{ justifyContent: 'flex-start' }}>
                      {card.name}{card.set_name ? ` · ${card.set_name}` : ''}{card.number ? ` #${card.number}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t('card.quantity')}</label>
                <input className="input-control" name={`qty-${index}`} type="number" min="1" required value={line.quantity} onChange={e => setLines(current => current.map(item => item.key === line.key ? { ...item, quantity: e.target.value } : item))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{line.bulk ? t('sealed.lineValue') : t('sealed.pullValue')}</label>
                <input className="input-control" name={`current-${index}`} value={line.bulk ? line.line_value : line.current_value} placeholder={currency} onChange={e => setLines(current => current.map(item => item.key === line.key ? { ...item, [line.bulk ? 'line_value' : 'current_value']: e.target.value } : item))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t('sealed.snapshotValue')}</label>
                <input className="input-control" name={`snapshot-${index}`} value={line.value_at_opening} placeholder={t('sealed.snapshotOptional')} onChange={e => setLines(current => current.map(item => item.key === line.key ? { ...item, value_at_opening: e.target.value } : item))} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" type="button" onClick={() => setLines(current => [...current, emptyLine(false)])}>{t('sealed.addPull')}</button>
        <button className="btn btn-secondary" type="button" onClick={() => setLines(current => [...current, emptyLine(true)])}>{t('sealed.addBulk')}</button>
      </div>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('sealed.bulkHint')}</p>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('sealed.snapshotHint')}</p>
      <label style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
        <input type="checkbox" name="entry_complete" />
        {t('sealed.markComplete')}
      </label>
      <div className="quick-add-footer">
        <div className="quick-add-footer-actions">
          <button className="btn btn-secondary" type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" type="submit" disabled={busy}>{t('sealed.openUnit')}</button>
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
