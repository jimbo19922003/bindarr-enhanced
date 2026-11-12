import { useEffect, useState } from 'react';
import { useT } from '../../utils/i18n';
import { tradeApi, amountToCents, centsToAmount, tradeItemDetails } from '../../utils/tradeApi';
import { Money } from '../TradeShared';

const cardLabel = card => [card.printed_name || card.name, ...tradeItemDetails(card)].filter(Boolean).join(' · ');

export default function CompleteTrade({ request, onClose, onDone }) {
  const { t } = useT();
  const [draft, setDraft] = useState(null);
  const [given, setGiven] = useState({});
  const [received, setReceived] = useState({});
  const [other, setOther] = useState('');
  const [cashIn, setCashIn] = useState('');
  const [cashOut, setCashOut] = useState('');
  const [date, setDate] = useState('');
  const [removeWanted, setRemoveWanted] = useState(true);
  const [acknowledge, setAcknowledge] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    tradeApi(`/api/trade/requests/${request.id}/completion`, { signal: controller.signal }).then(result => {
      setDraft(result);
      setGiven(Object.fromEntries(result.given.filter(copy => copy.available).map(copy => [copy.entry_id,
        { on: true, quantity: String(copy.quantity) }])));
      setReceived(Object.fromEntries(result.received.map(line => [line.index,
        { on: true, quantity: String(line.quantity), unit: centsToAmount(line.unit_cents ?? 0) }])));
      setCashIn(result.cash_in_cents ? centsToAmount(result.cash_in_cents) : '');
      setDate(result.completed_on);
    }).catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [request.id]);
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const edit = setter => value => { setter(value); setPreview(null); setAcknowledge(false); };
  const lines = draft ? draft.received.filter(line => received[line.index]?.on) : [];
  const parsed = lines.map(line => ({ index: line.index, quantity: Number(received[line.index].quantity),
    unit_cents: amountToCents(received[line.index].unit) }));
  const givenItems = draft ? draft.given.filter(copy => given[copy.entry_id]?.on).map(copy => ({
    entry_id: copy.entry_id, quantity: Number(given[copy.entry_id].quantity),
  })) : [];
  const amounts = { other: amountToCents(other), cashIn: amountToCents(cashIn), cashOut: amountToCents(cashOut) };
  const valid = parsed.every(line => Number.isSafeInteger(line.quantity) && line.quantity > 0 && line.unit_cents != null)
    && givenItems.every(line => Number.isSafeInteger(line.quantity) && line.quantity > 0
      && line.quantity <= (draft.given.find(copy => copy.entry_id === line.entry_id).max_quantity ?? 1))
    && Object.values(amounts).every(value => value != null) && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const body = {
    given: givenItems, received: parsed,
    other_received_cents: amounts.other, cash_in_cents: amounts.cashIn, cash_out_cents: amounts.cashOut,
    completed_on: date, remove_from_wishlist: removeWanted, allow_unknown_basis: acknowledge,
  };
  const run = async (work) => {
    setBusy(true); setError('');
    try { await work(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return <div className="modal-overlay trades-modal" role="dialog" aria-modal="true" aria-labelledby="complete-trade-title">
    <div className="glass-panel trades-dialog">
      <h3 id="complete-trade-title">{t('trades.complete.title', { id: request.id, contact: request.discord_contact })}</h3>
      <p className="trade-muted">{t('trades.complete.hint')}</p>
      {!draft && !error && <p role="status">{t('common.loading')}</p>}
      {draft && <>
        {draft.proposal_cash_cents > 0 && <p className="trade-muted">{t('trades.complete.proposalCash')} <Money cents={draft.proposal_cash_cents} currency={draft.proposal_currency} /></p>}
        <fieldset className="trades-fieldset">
          <legend>{t('trades.complete.given')}</legend>
          {!draft.given.length && <p className="trade-muted">{t('trades.complete.noneGiven')}</p>}
          {draft.given.map(copy => <div key={copy.entry_id} className="trades-line">
            <label><input type="checkbox" checked={!!given[copy.entry_id]?.on} disabled={busy || !copy.available}
              onChange={event => edit(setGiven)({ ...given, [copy.entry_id]: { ...given[copy.entry_id], on: event.target.checked } })} />
              {copy.available ? cardLabel(copy) : t('trades.complete.unavailable', { id: copy.entry_id })}</label>
            {copy.available && copy.kind === 'sealed' && <label>{t('trades.complete.quantity')}
              <input type="number" min="1" max={copy.max_quantity} step="1" value={given[copy.entry_id]?.quantity ?? ''}
                disabled={busy || !given[copy.entry_id]?.on} onChange={event => edit(setGiven)({
                  ...given, [copy.entry_id]: { ...given[copy.entry_id], quantity: event.target.value },
                })} />
            </label>}
            {copy.available && <span className="trade-muted"><Money cents={copy.value_cents} currency="USD" /></span>}
          </div>)}
        </fieldset>
        <fieldset className="trades-fieldset">
          <legend>{t('trades.complete.received')}</legend>
          {!draft.received.length && <p className="trade-muted">{t('trades.complete.noneReceived')}</p>}
          {draft.received.map(line => {
            const state = received[line.index];
            const set = patch => edit(setReceived)({ ...received, [line.index]: { ...state, ...patch } });
            return <div key={line.index} className="trades-line">
              <label><input type="checkbox" checked={state.on} disabled={busy} onChange={event => set({ on: event.target.checked })} /> {cardLabel(line)}</label>
              <label>{t('trades.complete.quantity')}
                <input type="number" min="1" max={1000} step="1" value={state.quantity} disabled={busy || !state.on}
                  onChange={event => set({ quantity: event.target.value })} />
              </label>
              <label>{t('trades.complete.unitValue')}
                <input type="number" min="0" step="0.01" inputMode="decimal" value={state.unit} disabled={busy || !state.on}
                  onChange={event => set({ unit: event.target.value })} />
              </label>
            </div>;
          })}
          <label>{t('trades.complete.other')}
            <input type="number" min="0" step="0.01" inputMode="decimal" value={other} disabled={busy} onChange={event => edit(setOther)(event.target.value)} />
          </label>
          <p className="trade-muted">{t('trades.complete.otherHint')}</p>
        </fieldset>
        <fieldset className="trades-fieldset trades-cash-row">
          <legend>{t('trades.complete.cash')}</legend>
          <label>{t('trades.complete.cashIn')}
            <input type="number" min="0" step="0.01" inputMode="decimal" value={cashIn} disabled={busy} onChange={event => edit(setCashIn)(event.target.value)} />
          </label>
          <label>{t('trades.complete.cashOut')}
            <input type="number" min="0" step="0.01" inputMode="decimal" value={cashOut} disabled={busy} onChange={event => edit(setCashOut)(event.target.value)} />
          </label>
          <label>{t('trades.complete.date')}
            <input type="date" value={date} disabled={busy} onChange={event => edit(setDate)(event.target.value)} />
          </label>
        </fieldset>
        <label><input type="checkbox" checked={removeWanted} disabled={busy} onChange={event => edit(setRemoveWanted)(event.target.checked)} /> {t('trades.complete.removeWanted')}</label>
        <p className="trade-muted">{t('trades.complete.accountingHint')}</p>
        {!valid && <p role="alert">{t('trades.complete.invalid')}</p>}
        {preview && <div className="trades-preview" aria-live="polite">
          <h4>{t('trades.complete.previewTitle')}</h4>
          <p>{t('trades.complete.receivedValue')}: <Money cents={preview.received_cents} currency="USD" /> · {t('trades.complete.proceeds')}: <Money cents={preview.proceeds_cents} currency="USD" /></p>
          <ul>{preview.given.map(copy => <li key={copy.entry_id}>
            {copy.quantity}x {copy.name}: {t('trades.complete.soldFor')} <Money cents={copy.proceeds_cents} currency="USD" /> · {t('trades.complete.basis')} <Money cents={copy.basis_cents} currency="USD" /> · {t('trades.complete.gain')} <Money cents={copy.gain_cents} currency="USD" />
          </li>)}</ul>
          {preview.received.length > 0 && <p>{t('trades.complete.addsCopies', { count: preview.received.reduce((sum, line) => sum + line.quantity, 0) })}</p>}
          <p><strong>{t('trades.complete.gain')}: <Money cents={preview.realized_gain_cents} currency="USD" /></strong></p>
          {preview.unknown_basis > 0 && <label><input type="checkbox" checked={acknowledge} disabled={busy} onChange={event => setAcknowledge(event.target.checked)} /> {t('trades.complete.acknowledge', { count: preview.unknown_basis })}</label>}
        </div>}
      </>}
      {error && <p role="alert">{error}</p>}
      <div className="trade-actions">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
        {draft && !preview && <button type="button" className="btn btn-primary" disabled={busy || !valid}
          onClick={() => run(async () => setPreview(await tradeApi(`/api/trade/requests/${request.id}/complete`, { method: 'POST', body: { ...body, preview: true } })))}>
          {t('trades.complete.review')}</button>}
        {preview && <button type="button" className="btn btn-primary" disabled={busy || (preview.unknown_basis > 0 && !acknowledge)}
          onClick={() => { if (window.confirm(t('trades.complete.confirm'))) run(async () => {
            await tradeApi(`/api/trade/requests/${request.id}/complete`, { method: 'POST', body });
            onDone();
          }); }}>{t('trades.complete.submit')}</button>}
      </div>
    </div>
  </div>;
}
