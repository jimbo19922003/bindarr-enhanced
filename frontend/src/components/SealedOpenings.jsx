import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useT } from '../utils/i18n';
import RipForm from './RipForm';
import CardImage from './CardImage';

const money = (currency, amount) => amount == null || amount === '' ? '—' : `${currency} ${amount}`;
const recoveryLabel = value => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`;
const emptyLine = (bulk = false) => ({ name: '', quantity: '1', current_value: '', value_at_opening: '', line_value: '', card_id: '', bulk });

export default function SealedOpenings({ product, showToast, onChanged, ripLot, onCloseRip }) {
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
    fetch(`/api/sealed/products/${product.id}/openings`).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
      if (!gone) setRows(data.openings || []);
    }).catch(error => { if (!gone) showToast(error.message); });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);
  const changed = async () => { await reload(); if (onChanged) await onChanged(); };
  const saveOpening = async body => {
    if (!ripLot) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/sealed/lots/${ripLot.id}/openings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
      onCloseRip?.(); showToast(t('sealed.openingSaved')); await changed();
    } catch (error) { showToast(error.message); } finally { setBusy(false); }
  };
  const patchOpening = async (opening, patch) => {
    const response = await fetch(`/api/sealed/openings/${opening.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
    await changed();
  };
  const removeOpening = async opening => {
    const response = await fetch(`/api/sealed/openings/${opening.id}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
    setConfirmRemove(null); await changed();
  };
  return <section style={{ display: 'grid', gap: '0.7rem' }}>
    <strong>{t('sealed.openingsTitle')}</strong><p>{t('sealed.openHint')}</p>
    {new Set(rows.map(row => row.currency)).size > 1 && <p>{t('sealed.oneCurrencyNote')}</p>}
    {!rows.length && <p>{t('sealed.openingsEmpty')}</p>}
    {rows.map(opening => <OpeningCard key={opening.id} opening={opening} t={t} showToast={showToast}
      confirmRemove={confirmRemove === opening.id} onAskRemove={() => setConfirmRemove(opening.id)}
      onCancelRemove={() => setConfirmRemove(null)} onPatch={patchOpening} onRemove={removeOpening} onReload={changed} />)}
    <div className={`drawer-backdrop ${ripLot ? 'open' : ''}`} onClick={onCloseRip} />
    <div className={`quick-add-drawer ${ripLot ? 'open' : ''}`} style={{ maxWidth: 720 }}>
      {ripLot && <RipForm key={ripLot.id} product={product} lot={ripLot} busy={busy} t={t} showToast={showToast} onClose={onCloseRip} onSubmit={saveOpening} />}
    </div>
  </section>;
}

function Stat({ label, value }) {
  return <div><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</div><div style={{ fontWeight: 700 }}>{value}</div></div>;
}

function OpeningCard({ opening, t, confirmRemove, onAskRemove, onCancelRemove, onPatch, onRemove, onReload, showToast }) {
  const stats = opening.analytics;
  const [open, setOpen] = useState(false);
  const [openPull, setOpenPull] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(emptyLine());
  const [working, setWorking] = useState(false);
  const prices = !stats.recorded_quantity ? t('sealed.noPulls') : stats.unpriced_quantity > 0 ? t('sealed.unpricedPulls', { count: stats.unpriced_quantity }) : t('sealed.pricesComplete');
  const run = async action => {
    if (working) return;
    setWorking(true);
    try { await action(); } catch (error) { showToast(error.message); } finally { setWorking(false); }
  };
  const mutatePull = async (method, suffix, body) => {
    const response = await fetch(`/api/sealed/openings/${opening.id}/pulls${suffix}`, { method,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
    await onReload();
  };
  const addPull = event => {
    event.preventDefault();
    const body = { name: draft.name.trim() || (draft.bulk ? t('sealed.otherCards') : ''), quantity: Number(draft.quantity || 1), card_id: draft.card_id || undefined };
    if (!body.name && !body.card_id) return;
    if (draft.bulk) {
      if (draft.line_value.trim()) body.line_value = draft.line_value.trim();
      if (draft.value_at_opening.trim()) body.opened_line_value = draft.value_at_opening.trim();
    } else {
      if (draft.current_value.trim()) body.current_value = draft.current_value.trim();
      if (draft.value_at_opening.trim()) body.value_at_opening = draft.value_at_opening.trim();
    }
    run(async () => { await mutatePull('POST', '', body); setDraft(emptyLine(draft.bulk)); });
  };
  const savePull = (pull, event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const current = String(form.get('current') || '').trim();
    const snapshot = String(form.get('snapshot') || '').trim();
    const line = pull.line_value != null;
    const body = { name: pull.name, quantity: pull.quantity, card_id: pull.card_id || undefined, collection_id: pull.collection_id || undefined, set_name: pull.set_name, number: pull.number, image_url: pull.image_url };
    if (current) body[line ? 'line_value' : 'current_value'] = current;
    if (snapshot) body[line ? 'opened_line_value' : 'value_at_opening'] = snapshot;
    run(() => mutatePull('PUT', `/${pull.id}`, body));
  };
  return <article className="glass-panel" style={{ padding: '0.9rem', display: 'grid', gap: '0.65rem' }}>
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', background: 'transparent', border: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
      <span>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {opening.opened_at ? `${t('sealed.openedOn')} ${opening.opened_at}` : t('sealed.openingsTitle')}</span>
      <span>{money(opening.currency, stats.cost)} · {t('sealed.recordedPulls')} {stats.recorded_quantity} · {money(opening.currency, stats.known_value)} · {recoveryLabel(stats.cost_recovery_percent)}</span>
    </button>
    {open && <>
      {opening.notes && <div>{opening.notes}</div>}
      <div>{stats.entry_complete ? t('sealed.entryComplete') : t('sealed.entryIncomplete')} · {prices}</div>
      {!stats.entry_complete && <p>{t('sealed.entryIncompleteHint')}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.55rem' }}>
        <Stat label={t('sealed.openingCost')} value={money(opening.currency, stats.cost)} />
        <Stat label={t('sealed.recordedPulls')} value={String(stats.recorded_quantity)} />
        <Stat label={t('sealed.knownValue')} value={money(opening.currency, stats.known_value)} />
        <Stat label={t('sealed.valueAtOpening')} value={stats.opened_value == null ? t('sealed.noSnapshot') : money(opening.currency, stats.opened_value)} />
        <Stat label={t('sealed.estimatedDifference')} value={money(opening.currency, stats.value_difference)} />
        <Stat label={t('sealed.recovery')} value={recoveryLabel(stats.cost_recovery_percent)} />
      </div>
      <p>{t('sealed.notProfit')}</p>
      {stats.opened_value != null && stats.missing_snapshot_quantity > 0 && <p>{t('sealed.missingSnapshot', { count: stats.missing_snapshot_quantity })}</p>}
      {opening.pulls.map(pull => {
        const shown = openPull === pull.id;
        const snapshot = pull.opened_line_value != null ? pull.opened_line_value : pull.value_at_opening;
        return <div key={pull.id} style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.45rem' }}>
          <button type="button" onClick={() => setOpenPull(shown ? null : pull.id)} aria-expanded={shown} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%', background: 'transparent', border: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
            {pull.card_id && <CardImage card={pull} style={{ width: 30, height: 42, objectFit: 'contain' }} />}
            <span style={{ flex: 1 }}>{pull.name} × {pull.quantity}<small style={{ display: 'block' }}>{[pull.set_name, pull.number].filter(Boolean).join(' · ')}</small></span>
            <span>{pull.line_value != null ? money(opening.currency, pull.line_value) : pull.current_value != null ? money(opening.currency, pull.current_value) : t('sealed.marketUnknown')}</span>
          </button>
          {shown && <form onSubmit={event => savePull(pull, event)} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.45rem' }}>
            <label>{pull.line_value != null ? t('sealed.lineValue') : t('sealed.pullValue')}<input className="input-control" name="current" defaultValue={pull.line_value ?? pull.current_value ?? ''} /></label>
            <label>{t('sealed.snapshotValue')}<input className="input-control" name="snapshot" defaultValue={snapshot ?? ''} /></label>
            <button className="btn btn-secondary" type="submit" disabled={working}>{t('sealed.save')}</button>
            <button className="btn btn-secondary" type="button" disabled={working} onClick={() => run(() => mutatePull('DELETE', `/${pull.id}`))}>{t('sealed.removePull')}</button>
          </form>}
        </div>;
      })}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        <button className="btn btn-secondary" type="button" onClick={() => { setAdding(!adding); setDraft(emptyLine(false)); }}>{t('sealed.addPull')}</button>
        <button className="btn btn-secondary" type="button" onClick={() => { setAdding(true); setDraft(emptyLine(true)); }}>{t('sealed.addBulk')}</button>
      </div>
      {adding && <form onSubmit={addPull} style={{ display: 'grid', gap: '0.4rem' }}>
        <label>{t('sealed.pullName')}<input className="input-control" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>{t('card.quantity')}<input className="input-control" type="number" min="1" value={draft.quantity} onChange={e => setDraft({ ...draft, quantity: e.target.value })} /></label>
        <label>{draft.bulk ? t('sealed.lineValue') : t('sealed.pullValue')}<input className="input-control" value={draft.bulk ? draft.line_value : draft.current_value} onChange={e => setDraft({ ...draft, [draft.bulk ? 'line_value' : 'current_value']: e.target.value })} /></label>
        <label>{t('sealed.snapshotValue')}<input className="input-control" value={draft.value_at_opening} onChange={e => setDraft({ ...draft, value_at_opening: e.target.value })} /></label>
        <button className="btn btn-secondary" type="submit" disabled={working}>{t('sealed.save')}</button>
      </form>}
      <label><input type="checkbox" checked={!!opening.entry_complete} disabled={working} onChange={e => run(() => onPatch(opening, { entry_complete: e.target.checked }))} /> {t('sealed.markComplete')}</label>
      {confirmRemove ? <div><p>Remove this opening and its automatically filed collection cards, and return the unit to sealed inventory?</p>
        <button className="btn btn-secondary" type="button" disabled={working} onClick={() => run(() => onRemove(opening))}>Confirm removal</button>
        <button className="btn btn-secondary" type="button" onClick={onCancelRemove}>{t('common.cancel')}</button>
      </div> : <button className="btn btn-secondary" type="button" onClick={onAskRemove}>Remove opening</button>}
    </>}
  </article>;
}
