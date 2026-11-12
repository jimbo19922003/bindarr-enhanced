import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useT } from '../utils/i18n';
import RipForm from './RipForm';
import CardImage from './CardImage';
// A rip files every card through the collection and prices it, so a large one is
// slow. Past this the request is abandoned rather than leaving the drawer stuck.
const SAVE_TIMEOUT_MS = 180000;
const money = (currency, amount) => amount == null || amount === '' ? '—' : `${currency} ${amount}`;
export default function SealedOpenings({ product, showToast, onChanged, ripLot, onCloseRip }) {
  const { t } = useT();
  const [saveStatus, setSaveStatus] = useState(null), pending = useRef(null);
  useEffect(() => () => pending.current?.abort(), []);
  const [rows, setRows] = useState([]), [busy, setBusy] = useState(false), [editing, setEditing] = useState(null), [loadingEdit, setLoadingEdit] = useState(false);
  const reload = async () => {
    const response = await fetch(`/api/sealed/products/${product.id}/openings`), data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || t('sealed.errOpening')); setRows(data.openings || []);
  };
  useEffect(() => {
    let gone = false; fetch(`/api/sealed/products/${product.id}/openings`).then(async response => {
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || t('sealed.errOpening')); if (!gone) setRows(data.openings || []);
    }).catch(error => { if (!gone) showToast(error.message); }); return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);
  const changed = async () => { await reload(); await onChanged?.(); };
  const close = () => { if (busy) return; setSaveStatus(null); setEditing(null); if (ripLot) onCloseRip?.(); };
  const edit = async opening => {
    if (busy || loadingEdit) return; setLoadingEdit(true);
    try {
      const response = await fetch(`/api/sealed/openings/${opening.id}`), data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening')); setEditing(data.opening);
    } catch (error) { showToast(error.message); } finally { setLoadingEdit(false); }
  };
  const save = async body => {
    if (busy || (!editing && !ripLot)) return; setBusy(true);
    const controller = new AbortController(), started = Date.now();
    pending.current = controller;
    setSaveStatus({ seconds: 0 });
    const tick = setInterval(() => setSaveStatus(current => current && !current.error ? { seconds: Math.round((Date.now() - started) / 1000) } : current), 1000);
    const timeout = setTimeout(() => controller.abort('timeout'), SAVE_TIMEOUT_MS);
    try {
      const response = await fetch(editing ? `/api/sealed/openings/${editing.id}/edit` : `/api/sealed/lots/${ripLot.id}/openings`, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
      setSaveStatus(null); setEditing(null); if (ripLot) onCloseRip?.(); showToast(editing ? 'Rip changes saved' : t('sealed.openingSaved')); await changed();
    } catch (error) {
      // An abandoned request may still finish on the server, so refresh the list
      // and tell the owner to check it rather than inviting a duplicate save.
      const message = controller.signal.aborted ? t('sealed.saveAbandoned') : error.message || t('sealed.errOpening');
      setSaveStatus({ error: message }); showToast(message);
      if (controller.signal.aborted) await changed().catch(() => {});
    } finally { clearInterval(tick); clearTimeout(timeout); if (pending.current === controller) pending.current = null; setBusy(false); }
  };
  const stopWaiting = () => pending.current?.abort('stopped');
  const remove = async opening => {
    try {
      const response = await fetch(`/api/sealed/openings/${opening.id}`, { method: 'DELETE' }), data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening')); await changed();
    } catch (error) { showToast(error.message); }
  };
  const drawer = !!(editing || ripLot);
  return <section style={{ display: 'grid', gap: '0.7rem' }}>
    <strong>{t('sealed.openingsTitle')}</strong><p>{t('sealed.openHint')}</p>
    {new Set(rows.map(row => row.currency)).size > 1 && <p>{t('sealed.oneCurrencyNote')}</p>}
    {!rows.length && <p>{t('sealed.openingsEmpty')}</p>}
    {rows.map(opening => <OpeningCard key={opening.id} opening={opening} t={t} onEdit={() => edit(opening)} onRemove={() => remove(opening)} disabled={busy || loadingEdit} />)}
    <div className={`drawer-backdrop ${drawer ? 'open' : ''}`} onClick={close} />
    <div className={`quick-add-drawer ${drawer ? 'open' : ''}`} style={{ maxWidth: 720 }}>
      {drawer && <RipForm key={editing ? `edit-${editing.id}` : `new-${ripLot.id}`} product={product} lot={editing ? { currency: editing.currency, total_cost: editing.cost } : ripLot} existingOpening={editing} busy={busy} saveStatus={saveStatus} onStopWaiting={stopWaiting} t={t} showToast={showToast} onClose={close} onSubmit={save} />}
    </div>
  </section>;
}
function OpeningCard({ opening, t, onEdit, onRemove, disabled }) {
  const [open, setOpen] = useState(false), [confirm, setConfirm] = useState(false), [removing, setRemoving] = useState(false);
  const stats = opening.analytics, currency = opening.currency;
  const recovery = stats.cost_recovery_percent == null ? '—' : `${Number(stats.cost_recovery_percent).toFixed(1)}%`;
  const metrics = [[t('sealed.openingCost'), money(currency, stats.cost)], [t('sealed.recordedPulls'), stats.recorded_quantity],
    [t('sealed.knownValue'), money(currency, stats.known_value)], [t('sealed.valueAtOpening'), stats.opened_value == null ? t('sealed.noSnapshot') : money(currency, stats.opened_value)],
    [t('sealed.estimatedDifference'), money(currency, stats.value_difference)], [t('sealed.recovery'), recovery]];
  return <article className="glass-panel" style={{ padding: '0.9rem', display: 'grid', gap: '0.65rem' }}>
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`opening-details-${opening.id}`} style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', background: 'transparent', border: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
      <span>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {t('sealed.openedOn')} {opening.opened_at}</span>
      <span>{t('sealed.recordedPulls')} {stats.recorded_quantity} · {money(currency, stats.known_value)} · {recovery}</span>
    </button>
    {open && <div id={`opening-details-${opening.id}`} style={{ display: 'grid', gap: '0.65rem', marginLeft: '1.25rem', paddingLeft: '0.75rem', borderLeft: '1px solid var(--border-glass)' }}>
      <button className="btn btn-secondary" type="button" onClick={onEdit} disabled={disabled || removing} style={{ justifySelf: 'start' }}>Edit rip / add cards</button>
      {opening.notes && <p>{opening.notes}</p>}
      <div>{stats.entry_complete ? t('sealed.entryComplete') : t('sealed.entryIncomplete')} · {stats.unpriced_quantity > 0 ? t('sealed.unpricedPulls', { count: stats.unpriced_quantity }) : t('sealed.pricesComplete')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.55rem' }}>{metrics.map(([label, value]) => <div key={label}><small>{label}</small><div style={{ fontWeight: 700 }}>{value}</div></div>)}</div>
      <p>{t('sealed.notProfit')}</p>
      {stats.opened_value != null && stats.missing_snapshot_quantity > 0 && <p>{t('sealed.missingSnapshot', { count: stats.missing_snapshot_quantity })}</p>}
      {opening.pulls.map(pull => <div key={pull.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', borderTop: '1px solid var(--border-glass)', paddingTop: '0.45rem' }}>
        {pull.card_id && <CardImage card={pull} style={{ width: 30, height: 42, objectFit: 'contain' }} />}
        <span style={{ flex: 1 }}>{pull.name} × {pull.quantity}<small style={{ display: 'block' }}>{[pull.set_name, pull.number].filter(Boolean).join(' · ')}</small></span>
        <span>{pull.line_value != null ? money(currency, pull.line_value) : pull.current_value != null ? money(currency, pull.current_value) : t('sealed.marketUnknown')}</span>
      </div>)}
      {confirm ? <div><p>Remove this opening and its automatically filed collection copies, and return the unit to sealed inventory?</p>
        <button className="btn btn-secondary" type="button" disabled={removing || disabled} onClick={async () => { setRemoving(true); try { await onRemove(); } finally { setRemoving(false); setConfirm(false); } }}>Confirm removal</button>
        <button className="btn btn-secondary" type="button" disabled={removing} onClick={() => setConfirm(false)}>{t('common.cancel')}</button>
      </div> : <button className="btn btn-secondary" type="button" onClick={() => setConfirm(true)} disabled={disabled || removing}>Remove opening</button>}
    </div>}
  </article>;
}
