import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useT } from '../utils/i18n';
import RipForm from './RipForm';
import CardImage from './CardImage';
import { sealedPackGroups } from '../utils/sealedPackGroups';
// A rip files every card through the collection and prices it, so a large one is
// slow. Past this the request is abandoned rather than leaving the drawer stuck.
const SAVE_TIMEOUT_MS = 180000;
const money = (currency, amount) => amount == null || amount === '' ? '—' : `${currency} ${amount}`;
export default function SealedOpenings({ product, showToast, onChanged, ripLot, onCloseRip }) {
  const { t } = useT();
  const [saveStatus, setSaveStatus] = useState(null), pending = useRef(null);
  useEffect(() => () => pending.current?.abort(), []);
  const [rows, setRows] = useState([]), [busy, setBusy] = useState(false), [editing, setEditing] = useState(null), [loadingEdit, setLoadingEdit] = useState(false);
  const [conversions, setConversions] = useState([]), [activePack, setActivePack] = useState(null), [editingProduct, setEditingProduct] = useState(null);
  const reload = async () => {
    const response = await fetch(`/api/sealed/products/${product.id}/openings`), data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || t('sealed.errOpening')); setRows(data.openings || []); setConversions(data.conversions || []);
  };
  useEffect(() => {
    let gone = false; fetch(`/api/sealed/products/${product.id}/openings`).then(async response => {
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || t('sealed.errOpening')); if (!gone) { setRows(data.openings || []); setConversions(data.conversions || []); }
    }).catch(error => { if (!gone) showToast(error.message); }); return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);
  const changed = async () => { await reload(); await onChanged?.(); };
  const close = () => { if (busy) return; setSaveStatus(null); setEditing(null); setActivePack(null); setEditingProduct(null); if (ripLot) onCloseRip?.(); };
  const edit = async (opening, sourceProduct = product) => {
    if (busy || loadingEdit) return; setLoadingEdit(true);
    try {
      const response = await fetch(`/api/sealed/openings/${opening.id}`), data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening')); setEditing(data.opening); setEditingProduct(sourceProduct);
    } catch (error) { showToast(error.message); } finally { setLoadingEdit(false); }
  };
  const save = async body => {
    if (busy || (!editing && !ripLot && !activePack)) return; setBusy(true);
    const controller = new AbortController(), started = Date.now();
    pending.current = controller;
    setSaveStatus({ seconds: 0 });
    const tick = setInterval(() => setSaveStatus(current => current && !current.error ? { seconds: Math.round((Date.now() - started) / 1000) } : current), 1000);
    const timeout = setTimeout(() => controller.abort('timeout'), SAVE_TIMEOUT_MS);
    try {
      const response = await fetch(editing ? `/api/sealed/openings/${editing.id}/edit` : `/api/sealed/lots/${(activePack || ripLot).id}/openings`, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
      setSaveStatus(null); setEditing(null); setActivePack(null); setEditingProduct(null); if (ripLot) onCloseRip?.(); showToast(editing ? 'Rip changes saved' : t('sealed.openingSaved')); await changed();
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
  const saveValues = async (openingId, body) => {
    if (busy) return; setBusy(true);
    try {
      const response = await fetch(`/api/sealed/openings/${openingId}/conversion-values`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errOpening'));
      showToast(t(data.allocation_status === 'finalized' ? 'sealed.allocationFinalized' : 'sealed.allocationStillPending')); await changed();
    } catch (error) { showToast(error.message); } finally { setBusy(false); }
  };
  const drawer = !!(editing || ripLot || activePack);
  const formLot = editing ? { currency: editing.currency, total_cost: editing.cost } : activePack || ripLot;
  const formProduct = editingProduct || (activePack ? { ...activePack, id: activePack.product_id } : product);
  return <section style={{ display: 'grid', gap: '0.7rem' }}>
    <strong>{t('sealed.openingsTitle')}</strong><p>{t('sealed.openHint')}</p>
    {new Set(rows.map(row => row.currency)).size > 1 && <p>{t('sealed.oneCurrencyNote')}</p>}
    {!rows.length && <p>{t('sealed.openingsEmpty')}</p>}
    {rows.map(opening => {
      const converted = conversions.find(row => row.opening_id === opening.id);
      return <OpeningCard key={opening.id} opening={opening} t={t} onEdit={() => edit(opening)} onRemove={() => remove(opening)} disabled={busy || loadingEdit} conversion={converted}>
        {converted && <ConversionContents key={`${converted.opening_id}-${converted.allocation_status}-${JSON.stringify(converted.packs.map(pack => pack.market_value))}-${JSON.stringify(opening.pulls)}`}
          conversion={converted} opening={opening} t={t} disabled={busy || loadingEdit}
          onSave={body => saveValues(opening.id, body)}
          onOpen={pack => { setSaveStatus(null); setActivePack({ ...pack, source_product_name: product.name, source_product_type: product.product_type, cost_pending: converted.allocation_status === 'pending' }); }}
          onEdit={(child, pack) => edit(child, { ...pack, id: pack.product_id })}
          onRemove={remove} />}
      </OpeningCard>;
    })}
    <div className={`drawer-backdrop ${drawer ? 'open' : ''}`} onClick={close} />
    <div className={`quick-add-drawer ${drawer ? 'open' : ''}`} style={{ maxWidth: 720 }}>
      {drawer && <RipForm key={editing ? `edit-${editing.id}` : `new-${formLot.id}-${!!ripLot?.convert}`} product={formProduct} lot={formLot} existingOpening={editing} convertToPacks={!editing && !!ripLot?.convert} busy={busy} saveStatus={saveStatus} onStopWaiting={stopWaiting} t={t} showToast={showToast} onClose={close} onSubmit={save} />}
    </div>
  </section>;
}
function OpeningCard({ opening, t, onEdit, onRemove, disabled, conversion, children }) {
  const [open, setOpen] = useState(false), [confirm, setConfirm] = useState(false), [removing, setRemoving] = useState(false);
  const stats = opening.analytics, currency = opening.currency;
  const recovery = opening.cost_pending || stats.cost_recovery_percent == null ? '—' : `${Number(stats.cost_recovery_percent).toFixed(1)}%`;
  const metrics = [[t('sealed.openingCost'), opening.cost_pending ? t('sealed.allocationPending') : money(currency, stats.cost)], [t('sealed.recordedPulls'), stats.recorded_quantity],
    [t('sealed.knownValue'), money(currency, stats.known_value)], [t('sealed.valueAtOpening'), stats.opened_value == null ? t('sealed.noSnapshot') : money(currency, stats.opened_value)],
    [t('sealed.estimatedDifference'), opening.cost_pending ? '—' : money(currency, stats.value_difference)], [t('sealed.recovery'), recovery]];
  return <article className="glass-panel" style={{ padding: '0.9rem', display: 'grid', gap: '0.65rem' }}>
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`opening-details-${opening.id}`} style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', background: 'transparent', border: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
      <span>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {conversion ? `${t('sealed.convertedProduct')} · ` : ''}{t('sealed.openedOn')} {opening.opened_at}</span>
      <span>{t('sealed.recordedPulls')} {stats.recorded_quantity} · {money(currency, stats.known_value)} · {opening.cost_pending ? t('sealed.allocationPending') : recovery}</span>
    </button>
    {open && <div id={`opening-details-${opening.id}`} style={{ display: 'grid', gap: '0.65rem', marginLeft: '1.25rem', paddingLeft: '0.75rem', borderLeft: '1px solid var(--border-glass)' }}>
      <button className="btn btn-secondary" type="button" onClick={onEdit} disabled={disabled || removing} style={{ justifySelf: 'start' }}>{conversion ? t('sealed.editPromos') : 'Edit rip / add cards'}</button>
      {opening.notes && <p>{opening.notes}</p>}
      {opening.cost_pending && <p role="status">{t('sealed.pendingCostHelp')}</p>}
      {conversion && <p>{t('sealed.conversionSummary', { count: conversion.packs.length, cost: money(currency, conversion.source_cost) })}</p>}
      <div>{stats.entry_complete ? t('sealed.entryComplete') : t('sealed.entryIncomplete')} · {stats.unpriced_quantity > 0 ? t('sealed.unpricedPulls', { count: stats.unpriced_quantity }) : t('sealed.pricesComplete')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.55rem' }}>{metrics.map(([label, value]) => <div key={label}><small>{label}</small><div style={{ fontWeight: 700 }}>{value}</div></div>)}</div>
      <p>{t('sealed.notProfit')}</p>
      {stats.opened_value != null && stats.missing_snapshot_quantity > 0 && <p>{t('sealed.missingSnapshot', { count: stats.missing_snapshot_quantity })}</p>}
      {conversion && <strong>{t('sealed.promos')}</strong>}
      {opening.pulls.map(pull => <div key={pull.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', borderTop: '1px solid var(--border-glass)', paddingTop: '0.45rem' }}>
        {pull.card_id && <CardImage card={pull} style={{ width: 30, height: 42, objectFit: 'contain' }} />}
        <span style={{ flex: 1 }}>{pull.name} × {pull.quantity}<small style={{ display: 'block' }}>{[pull.set_name, pull.number].filter(Boolean).join(' · ')}</small></span>
        <span>{pull.line_value != null ? money(currency, pull.line_value) : pull.current_value != null ? money(currency, pull.current_value) : t('sealed.marketUnknown')}</span>
      </div>)}
      {children}
      {confirm ? <div><p>Remove this opening and its automatically filed collection copies, and return the unit to sealed inventory?</p>
        <button className="btn btn-secondary" type="button" disabled={removing || disabled} onClick={async () => { setRemoving(true); try { await onRemove(); } finally { setRemoving(false); setConfirm(false); } }}>Confirm removal</button>
        <button className="btn btn-secondary" type="button" disabled={removing} onClick={() => setConfirm(false)}>{t('common.cancel')}</button>
      </div> : <button className="btn btn-secondary" type="button" onClick={() => setConfirm(true)} disabled={disabled || removing}>Remove opening</button>}
    </div>}
  </article>;
}

function ConversionContents({ conversion, opening, t, disabled, onSave, onOpen, onEdit, onRemove }) {
  const [packValues, setPackValues] = useState(() => Object.fromEntries(conversion.packs.map(pack => [pack.id, pack.market_value ?? ''])));
  const [promoValues, setPromoValues] = useState(() => Object.fromEntries(opening.pulls.map(pull => [pull.id, pull.opened_line_value ?? (pull.value_at_opening == null ? '' : (Number(pull.value_at_opening) * pull.quantity).toFixed(2))])));
  const pending = conversion.allocation_status === 'pending';
  const groups = sealedPackGroups(conversion.packs.map(pack => ({ ...pack, parent_opening_id: conversion.opening_id })));
  return <section style={{ display: 'grid', gap: '0.65rem' }}>
    <h4>{t('sealed.packContents')}</h4>
    <p>{t(pending ? 'sealed.pendingCostHelp' : 'sealed.frozenMarketSplit')}</p>
    {pending && <form onSubmit={e => { e.preventDefault(); onSave({ packs: conversion.packs.map(pack => ({ lot_id: pack.id, market_value: packValues[pack.id] })), promos: opening.pulls.map(pull => ({ pull_id: pull.id, market_value: promoValues[pull.id] })) }); }} style={{ display: 'grid', gap: '0.45rem' }}>
      <p>{t('sealed.marketValuesHelp', { currency: opening.currency })}</p>
      {groups.map(group => <label key={group.key}>{group.lots[0].name} × {group.quantity}
        <input className="input-control" inputMode="decimal" value={packValues[group.lots[0].id]} disabled={disabled}
          onChange={e => { const value = e.target.value; setPackValues(current => ({ ...current, ...Object.fromEntries(group.lots.map(pack => [pack.id, value])) })); }} />
      </label>)}
      {opening.pulls.map(pull => <label key={pull.id}>{t('sealed.promoMarketValue', { name: pull.name, count: pull.quantity, currency: opening.currency })}
        <input className="input-control" inputMode="decimal" value={promoValues[pull.id]} disabled={disabled} onChange={e => setPromoValues(current => ({ ...current, [pull.id]: e.target.value }))} />
      </label>)}
      <button className="btn btn-secondary" type="submit" disabled={disabled}>{t('sealed.saveMarketValues')}</button>
    </form>}
    {groups.map(group => {
      const pack = group.lots[0];
      const next = group.lots.find(item => item.remaining_quantity > 0 && !item.archived_at && !item.product_archived_at);
      const hasOpenings = group.lots.some(item => item.openings.length > 0);
      return <div key={group.key} style={{ padding: '0.65rem', borderLeft: '2px solid var(--border-glass)', display: 'grid', gap: '0.5rem' }}>
        <strong>{pack.name} × {group.quantity}</strong>
        <span>{t('sealed.onHand', { count: group.remaining })} · {pending ? t('sealed.allocationPending') : money(pack.currency, (group.costCents / 100).toFixed(2))}</span>
        {next && <button className="btn btn-primary" type="button" disabled={disabled} onClick={() => onOpen(next)}>{t('sealed.letItRip')}</button>}
        <details open={hasOpenings}><summary>{t('sealed.packDetails')}</summary>
          {group.lots.map((item, index) => <div key={item.id}>
            <strong>{t('sealed.packNumber', { number: index + 1 })}</strong>
            <span> · {t(item.remaining_quantity ? 'sealed.packUnopened' : 'sealed.packOpened')} · {pending ? t('sealed.allocationPending') : money(item.currency, item.total_cost)}</span>
            {item.openings.map(child => <OpeningCard key={child.id} opening={child} t={t} onEdit={() => onEdit(child, item)} onRemove={() => onRemove(child)} disabled={disabled} />)}
          </div>)}
        </details>
      </div>;
    })}
  </section>;
}
