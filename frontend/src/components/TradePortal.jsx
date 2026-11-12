import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../utils/i18n';
import { CURRENCIES } from '../utils/formatPrice';
import './TradePortal.css';

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

function Money({ cents, currency }) {
  const { t, locale } = useT();
  return cents == null ? t('trade.unknown') : new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(cents / 100);
}

function Balance({ quote, ownerView = false }) {
  const { t } = useT();
  const summary = quote.summary;
  return <div className="trade-balance" aria-live="polite">
    <div className="trade-columns">
      {['requested', 'offered'].map(side => <div key={side}>
        <strong>{t(ownerView ? `trade.owner.${side}` : `trade.visitor.${side}`)}</strong>
        <p><Money cents={summary[side].known_cents} currency={summary.currency} />
          {summary[side].unknown_quantity > 0 && <> + {t('trade.unpriced', { count: summary[side].unknown_quantity })}</>}
        </p>
      </div>)}
    </div>
    <strong>{t('trade.balance')}: {summary.difference_percent == null ? t('trade.unknown')
      : `${summary.difference_percent > 0 ? '+' : ''}${summary.difference_percent}%`}</strong>
    {summary.difference_cents != null && <> (<Money cents={summary.difference_cents} currency={summary.currency} />)</>}
    <p className="trade-muted">{t('trade.formula')}</p>
    <p className="trade-muted">{t('trade.estimateHint')}</p>
    {quote.staleRates && <p role="status">{t('trade.staleRates')}</p>}
  </div>;
}

function CardPicker({ title, cards, selected, onChange, currency, disabled }) {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const shown = cards.filter(card => `${card.name} ${card.printed_name} ${card.set_name} ${card.number} ${card.game}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="glass-panel trade-picker">
    <h2>{title}</h2>
    <label>{t('trade.search')}
      <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
    </label>
    <p className="trade-muted">{t('trade.selected', { count: Object.keys(selected).length })}</p>
    {!shown.length && <p>{t('trade.noCards')}</p>}
    <div className="trade-card-list">
      {shown.map(card => <article key={card.entry_id} className={`trade-card ${selected[card.entry_id] ? 'trade-selected' : ''}`}>
        {card.image_url && <img src={card.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <div>
          <label className="trade-card-name">
            <input type="checkbox" checked={!!selected[card.entry_id]} disabled={disabled || (!selected[card.entry_id] && Object.keys(selected).length >= 50)}
              onChange={event => onChange(card.entry_id, event.target.checked ? 1 : 0)} />
            {card.printed_name || card.name}
          </label>
          <p>{card.set_name} #{card.number}</p>
          <p className="trade-muted">{card.game} / {card.printing} / {card.language} / {card.condition}
            {card.grader && card.grader !== 'Raw' ? ` / ${card.grader} ${card.grade ?? ''}` : ''}</p>
          <p><Money cents={card.unit_cents} currency={currency} /> {t(`trade.price.${card.price_state}`)}</p>
          <label>{t('trade.quantity', { max: card.quantity })}
            <input type="number" min="0" max={Math.min(card.quantity, 10000)} step="1"
              value={selected[card.entry_id] || 0} disabled={disabled || (!selected[card.entry_id] && Object.keys(selected).length >= 50)}
              onChange={event => {
                const quantity = Number(event.target.value);
                if (Number.isInteger(quantity) && quantity >= 0 && quantity <= Math.min(card.quantity, 10000)) onChange(card.entry_id, quantity);
              }} />
          </label>
        </div>
      </article>)}
    </div>
  </section>;
}

const selectionPayload = selected => Object.entries(selected).map(([id, quantity]) => ({ entry_id: Number(id), quantity }));

export default function TradePortal({ tradeToken }) {
  const { t } = useT();
  const [page, setPage] = useState(null);
  const [requested, setRequested] = useState({});
  const [offered, setOffered] = useState({});
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [error, setError] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const submission = useRef(null);
  const base = `/api/trade-public/${encodeURIComponent(tradeToken)}`;
  const payload = JSON.stringify({ requested: selectionPayload(requested), offered: selectionPayload(offered) });
  const bothSides = Object.keys(requested).length > 0 && Object.keys(offered).length > 0;

  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setError(''); setQuote(null); setRequested({}); setOffered({});
    api(base, { signal: controller.signal }).then(setPage).catch(err => {
      if (err.name !== 'AbortError') setError(err.message);
    });
    return () => controller.abort();
  }, [base, refresh]);

  useEffect(() => {
    setQuote(null); setQuoteError('');
    if (!bothSides) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api(`${base}/quote`, { method: 'POST', body: JSON.parse(payload), signal: controller.signal })
        .then(result => setQuote({ payload, result }))
        .catch(err => { if (err.name !== 'AbortError') setQuoteError(err.message); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [base, payload, bothSides, refresh]);

  const change = setter => (id, quantity) => {
    setter(previous => {
      const next = { ...previous };
      if (quantity) next[id] = quantity; else delete next[id];
      return next;
    });
    setReceipt(null);
  };
  const currentQuote = quote?.payload === payload ? quote.result : null;
  const submit = async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const body = { ...JSON.parse(payload), discord_contact: contact, message };
      const signature = JSON.stringify(body);
      if (submission.current?.signature !== signature) {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        submission.current = { signature, key: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') };
      }
      const saved = await api(`${base}/requests`, { method: 'POST', body: { ...body, request_key: submission.current.key } });
      setReceipt(saved);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return <main className="trade-public">
    <header className="glass-panel">
      <h1>{page ? t('trade.pageTitle', { name: page.owner }) : t('trade.title')}</h1>
      <p>{t('trade.intro')}</p>
      <p className="trade-muted">{t('trade.privacy')}</p>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setReceipt(null); setRefresh(value => value + 1); }}>{t('trade.refresh')}</button>
    </header>
    {error && <p role="alert">{error}</p>}
    {!page && !error && <p role="status">{t('common.loading')}</p>}
    {page && <>
      <div className="trade-columns">
        <CardPicker title={t('trade.available')} cards={page.available} selected={requested}
          onChange={change(setRequested)} currency={page.currency} disabled={busy} />
        <CardPicker title={t('trade.wanted')} cards={page.wanted} selected={offered}
          onChange={change(setOffered)} currency={page.currency} disabled={busy} />
      </div>
      <form className="glass-panel trade-proposal" onSubmit={submit}>
        <h2>{t('trade.proposal')}</h2>
        {!bothSides ? <p>{t('trade.chooseBoth')}</p>
          : currentQuote ? <Balance quote={currentQuote} />
            : !quoteError && <p role="status">{t('common.loading')}</p>}
        {quoteError && <p role="alert">{quoteError}</p>}
        <label>{t('trade.contact')}
          <input required maxLength={100} value={contact} disabled={busy || !!receipt}
            onChange={event => setContact(event.target.value)} autoComplete="off" />
        </label>
        <label>{t('trade.message')}
          <textarea maxLength={1000} value={message} disabled={busy || !!receipt} onChange={event => setMessage(event.target.value)} />
        </label>
        <p className="trade-muted">{t('trade.consent')}</p>
        <button className="btn btn-primary" disabled={busy || !currentQuote || !contact.trim() || !!receipt}>
          {busy ? t('common.loading') : t('trade.send')}
        </button>
        {receipt && <div role="status">
          <strong>{t('trade.sent', { id: receipt.id })}</strong>
          <p>{t(`trade.notification.${receipt.notification}`)}</p>
        </div>}
      </form>
    </>}
  </main>;
}

function ProposalCards({ title, cards, currency }) {
  return <section>
    <h4>{title}</h4>
    <ul className="trade-snapshot">{cards.map(card => <li key={card.entry_id}>
      <strong>{card.quantity}x {card.printed_name || card.name}</strong>
      <p>{card.set_name} #{card.number} / {card.game} / {card.printing} / {card.language} / {card.condition}
        {card.grader && card.grader !== 'Raw' ? ` / ${card.grader} ${card.grade ?? ''}` : ''}</p>
      <Money cents={card.unit_cents} currency={currency} />
    </li>)}</ul>
  </section>;
}

export function TradeSharing({ origin }) {
  const { t } = useT();
  const [settings, setSettings] = useState(null);
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [requests, setRequests] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [webhook, setWebhook] = useState('');
  const [removeWebhook, setRemoveWebhook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async (signal) => {
    const [config, inbox] = await Promise.all([api('/api/trade/settings', { signal }), api('/api/trade/requests', { signal })]);
    setSettings(config); setSavedEnabled(config.enabled);
    setRequests(inbox.requests); setNextBefore(inbox.next_before);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [load]);

  const act = async work => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const save = event => {
    event.preventDefault();
    act(async () => {
      const config = await api('/api/trade/settings', { method: 'PUT', body: {
        enabled: settings.enabled, currency: settings.currency,
        ...(removeWebhook ? { discord_webhook: '' } : webhook.trim() ? { discord_webhook: webhook.trim() } : {}),
      } });
      setSettings(config); setSavedEnabled(config.enabled);
      setWebhook(''); setRemoveWebhook(false); setNotice(t('trade.saved'));
    });
  };
  const url = settings ? `${origin.replace(/\/$/, '')}/trade/${settings.token}` : '';
  return <section className="glass-panel trade-settings">
    <h3>{t('trade.settingsTitle')}</h3>
    <p>{t('trade.setupHint')}</p>
    <p className="trade-muted">{t('trade.separateHint')}</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!settings ? <button className="btn btn-secondary" disabled={busy} onClick={() => act(() => load())}>{t('trade.refresh')}</button> : <>
      <form onSubmit={save} className="trade-config">
        <label><input type="checkbox" checked={settings.enabled} disabled={busy}
          onChange={event => setSettings(previous => ({ ...previous, enabled: event.target.checked }))} /> {t('trade.enable')}</label>
        <label>{t('trade.currency')}
          <select value={settings.currency} disabled={busy} onChange={event => setSettings(previous => ({ ...previous, currency: event.target.value }))}>
            {CURRENCIES.map(currency => <option key={currency.code} value={currency.code}>{currency.label}</option>)}
          </select>
        </label>
        <label>{t('trade.webhook')}
          <input type="password" autoComplete="new-password" value={webhook} maxLength={400} disabled={busy || removeWebhook}
            onChange={event => setWebhook(event.target.value)} />
        </label>
        <p className="trade-muted">{t(settings.webhook_configured ? 'trade.webhookConfigured' : 'trade.webhookHint')}</p>
        {settings.webhook_configured && <label><input type="checkbox" checked={removeWebhook} disabled={busy}
          onChange={event => setRemoveWebhook(event.target.checked)} /> {t('trade.removeWebhook')}</label>}
        <button className="btn btn-primary" disabled={busy}>{t('common.save')}</button>
      </form>
      <p role="status">{t(savedEnabled ? 'trade.sharingActive' : 'trade.sharingInactive')}</p>
      {settings.enabled !== savedEnabled && <p role="status">{t('trade.saveEnableChange')}</p>}
      {savedEnabled && <label>{t('trade.link')}<input readOnly value={url} onFocus={event => event.target.select()} /></label>}
      <div className="trade-actions">
        <button className="btn btn-secondary" disabled={busy || !savedEnabled} onClick={() => act(async () => {
          await navigator.clipboard.writeText(url); setNotice(t('trade.copied'));
        })}>{t('trade.copy')}</button>
        {savedEnabled && <a className="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer">{t('trade.preview')}</a>}
        <button className="btn btn-secondary" disabled={busy} onClick={() => {
          if (window.confirm(t('trade.rotateConfirm'))) act(async () => {
            const config = await api('/api/trade/rotate', { method: 'POST' });
            setSettings(config); setSavedEnabled(config.enabled); setNotice(t('trade.rotated'));
          });
        }}>{t('trade.rotate')}</button>
      </div>
    </>}
    <div className="trade-actions">
      <h3>{t('trade.inbox')}</h3>
      <button className="btn btn-secondary" disabled={busy} onClick={() => act(() => load())}>{t('trade.refresh')}</button>
    </div>
    <p className="trade-muted">{t('trade.inboxHint')}</p>
    {!requests.length && <p>{t('trade.emptyInbox')}</p>}
    {requests.map(request => <details key={request.id} className="trade-inbox-item">
      <summary>#{request.id} - {request.discord_contact} - {new Date(`${request.created_at.replace(' ', 'T')}Z`).toLocaleString()}</summary>
      <p>{t('trade.contact')}: <strong>{request.discord_contact}</strong></p>
      <p className="trade-message">{request.message}</p>
      <div className="trade-columns">
        <ProposalCards title={t('trade.owner.requested')} cards={request.proposal.requested} currency={request.proposal.summary.currency} />
        <ProposalCards title={t('trade.owner.offered')} cards={request.proposal.offered} currency={request.proposal.summary.currency} />
      </div>
      <Balance quote={request.proposal} ownerView />
      <p role="status">{t(`trade.notification.${request.notification}`)}</p>
      <div className="trade-actions">
        {request.notification !== 'delivered' && <button className="btn btn-secondary" disabled={busy || !settings?.webhook_configured}
          onClick={() => act(async () => {
            const result = await api(`/api/trade/requests/${request.id}/notify`, { method: 'POST' });
            setRequests(previous => previous.map(item => item.id === request.id ? { ...item, notification: result.notification } : item));
          })}>{t('trade.retryNotification')}</button>}
        <button className="btn btn-secondary" disabled={busy} onClick={() => {
          if (window.confirm(t('trade.deleteConfirm'))) act(async () => {
            await api(`/api/trade/requests/${request.id}`, { method: 'DELETE' });
            setRequests(previous => previous.filter(item => item.id !== request.id));
          });
        }}>{t('common.delete')}</button>
      </div>
    </details>)}
    {nextBefore && <button className="btn btn-secondary" disabled={busy} onClick={() => act(async () => {
      const inbox = await api(`/api/trade/requests?before=${nextBefore}`);
      setRequests(previous => [...previous, ...inbox.requests]); setNextBefore(inbox.next_before);
    })}>{t('trade.loadMore')}</button>}
  </section>;
}
