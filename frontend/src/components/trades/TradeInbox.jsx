import { useCallback, useEffect, useState } from 'react';
import { useT } from '../../utils/i18n';
import { tradeApi, notifyTradesChanged } from '../../utils/tradeApi';
import { Balance, Money, ProposalCards } from '../TradeShared';
import CompleteTrade from './CompleteTrade';

const FILTERS = ['new', 'active', 'completed', 'declined', 'archived', 'all'];
const SETTABLE = ['new', 'active', 'declined', 'archived'];

function RequestNote({ request, busy, onSave }) {
  const { t } = useT();
  const [note, setNote] = useState(request.owner_note || '');
  return <div className="trades-note">
    <label>{t('trades.inbox.note')}
      <textarea maxLength={2000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
    </label>
    <button type="button" className="btn btn-secondary" disabled={busy || note === (request.owner_note || '')}
      onClick={() => onSave(note)}>{t('trades.inbox.saveNote')}</button>
  </div>;
}

function Execution({ execution }) {
  const { t } = useT();
  return <div className="trades-execution">
    <strong>{t('trades.inbox.completedOn', { date: execution.completed_on })}</strong>
    <p>{t('trades.history.gave', { count: execution.given.reduce((sum, line) => sum + (line.quantity ?? 1), 0) })} · {t('trades.history.received', { count: execution.received.reduce((sum, line) => sum + line.quantity, 0) })}</p>
    <p>{t('trades.complete.proceeds')}: <Money cents={execution.proceeds_cents} currency="USD" /> · {t('trades.complete.gain')}: <Money cents={execution.realized_gain_cents} currency="USD" /></p>
  </div>;
}

export default function TradeInbox({ showToast, onUpdate }) {
  const { t } = useT();
  const [filter, setFilter] = useState('new');
  const [counts, setCounts] = useState({});
  const [requests, setRequests] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [webhook, setWebhook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completing, setCompleting] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async signal => {
    const [inbox, totals, config] = await Promise.all([
      tradeApi(`/api/trade/requests?status=${filter}`, { signal }),
      tradeApi('/api/trade/requests/counts', { signal }),
      tradeApi('/api/trade/settings', { signal }),
    ]);
    setRequests(inbox.requests); setNextBefore(inbox.next_before); setCounts(totals);
    setWebhook(config.webhook_configured); setLoaded(true);
  }, [filter]);
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    load(controller.signal).catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [load]);

  const act = async work => {
    setBusy(true); setError('');
    try { await work(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const update = (request, body) => act(async () => {
    await tradeApi(`/api/trade/requests/${request.id}`, { method: 'PATCH', body });
    await load(); notifyTradesChanged();
  });
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return <section className="glass-panel trades-inbox">
    <div className="trade-actions">
      <h3>{t('trade.inbox')}</h3>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => act(() => load())}>{t('trade.refresh')}</button>
    </div>
    <p className="trade-muted">{t('trades.inbox.hint')}</p>
    <div className="trades-chips" role="tablist" aria-label={t('trades.inbox.filter')}>
      {FILTERS.map(status => <button key={status} type="button" role="tab" aria-selected={filter === status}
        className={`trades-chip ${filter === status ? 'active' : ''}`} onClick={() => setFilter(status)}>
        {t(`trades.status.${status}`)} <span className="tab-count-badge">{status === 'all' ? total : counts[status] || 0}</span>
      </button>)}
    </div>
    {error && <p role="alert">{error}</p>}
    {!loaded && !error && <p role="status">{t('common.loading')}</p>}
    {loaded && !requests.length && <p>{t('trades.inbox.empty')}</p>}
    {requests.map(request => <details key={request.id} className={`trade-inbox-item trades-status-${request.status}`}>
      <summary>
        <span className={`trades-status-pill ${request.status}`}>{t(`trades.status.${request.status}`)}</span>
        #{request.id} · {request.discord_contact} · {new Date(`${request.created_at.replace(' ', 'T')}Z`).toLocaleString()}
        {request.binder_name && <span className="trade-muted"> · {t('trades.inbox.via', { name: request.binder_name })}</span>}
        {request.proposal.summary.cash_cents > 0 && <span className="trade-muted"> · {t('trades.inbox.plusCash')} <Money cents={request.proposal.summary.cash_cents} currency={request.proposal.summary.currency} /></span>}
      </summary>
      <p>{t('trade.contact')}: <strong>{request.discord_contact}</strong></p>
      {request.message && <p className="trade-message">{request.message}</p>}
      <div className="trade-columns">
        <ProposalCards title={t('trade.owner.requested')} cards={request.proposal.requested} currency={request.proposal.summary.currency} />
        <ProposalCards title={t('trade.owner.offered')} cards={request.proposal.offered} currency={request.proposal.summary.currency} />
      </div>
      <Balance quote={request.proposal} ownerView />
      {request.execution && <Execution execution={request.execution} />}
      <RequestNote request={request} busy={busy} onSave={owner_note => update(request, { owner_note })} />
      <p role="status">{t(`trade.notification.${request.notification}`)}</p>
      <div className="trade-actions">
        {request.status !== 'completed' && <>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setCompleting(request)}>{t('trades.inbox.complete')}</button>
          <label>{t('trades.inbox.status')}
            <select value={request.status} disabled={busy} onChange={event => update(request, { status: event.target.value })}>
              {SETTABLE.map(status => <option key={status} value={status}>{t(`trades.status.${status}`)}</option>)}
            </select>
          </label>
        </>}
        {request.notification !== 'delivered' && <button type="button" className="btn btn-secondary" disabled={busy || !webhook}
          onClick={() => act(async () => {
            const result = await tradeApi(`/api/trade/requests/${request.id}/notify`, { method: 'POST' });
            setRequests(previous => previous.map(item => item.id === request.id ? { ...item, notification: result.notification } : item));
          })}>{t('trade.retryNotification')}</button>}
        {request.status !== 'completed' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => {
          if (window.confirm(t('trade.deleteConfirm'))) act(async () => {
            await tradeApi(`/api/trade/requests/${request.id}`, { method: 'DELETE' });
            await load(); notifyTradesChanged();
          });
        }}>{t('common.delete')}</button>}
      </div>
    </details>)}
    {nextBefore && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => act(async () => {
      const inbox = await tradeApi(`/api/trade/requests?status=${filter}&before=${nextBefore}`);
      setRequests(previous => [...previous, ...inbox.requests]); setNextBefore(inbox.next_before);
    })}>{t('trade.loadMore')}</button>}
    {completing && <CompleteTrade request={completing} onClose={() => setCompleting(null)} onDone={() => {
      setCompleting(null); showToast(t('trades.complete.done', { id: completing.id }));
      onUpdate?.(); notifyTradesChanged(); act(() => load());
    }} />}
  </section>;
}
