import { useEffect, useRef, useState } from 'react';
import { useT } from '../utils/i18n';
import { tradeApi as api, tradeEntryId, tradeItemDetails } from '../utils/tradeApi';
import { Balance, Money } from './TradeShared';
import { TRADE_SORTS, filterTradeCards, tradeGames } from '../utils/tradeSort';
import './TradePortal.css';

const MAX_STACKS = 50;
const MAX_CASH = 100000;

function TradeTile({ card, quantity, onChange, currency, disabled, full }) {
  const { t } = useT();
  const name = card.printed_name || card.name;
  const select = () => onChange(card.entry_id, quantity ? 0 : 1);
  return <article className={`trade-card ${quantity ? 'trade-selected' : ''}`}>
    <button type="button" className="trade-card-select" aria-pressed={quantity > 0}
      disabled={disabled || (!quantity && full)} onClick={select}
      title={quantity ? t('trade.clickToRemove') : t('trade.clickToSelect')}>
      {card.image_url ? <img src={card.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
        : <span className="trade-card-placeholder" aria-hidden="true" />}
      <span className="trade-card-body">
        <strong className="trade-card-name">{name}</strong>
        <span className="trade-muted">{card.kind === 'sealed' && `${t('trade.kind.sealed')} · ${t(`sealed.type.${card.product_type}`)} · `}
          {tradeItemDetails(card).filter(Boolean).join(' / ')}</span>
        <span><Money cents={card.unit_cents} currency={currency} /> {t(`trade.price.${card.price_state}`)}</span>
        {card.price_varies && <span className="trade-muted">{t('trade.priceVaries')}</span>}
      </span>
    </button>
    {quantity > 0 ? <div className="trade-stepper" role="group" aria-label={t('trade.quantityFor', { name })}>
      <button type="button" className="btn btn-secondary" disabled={disabled}
        aria-label={t('trade.decrease', { name })} onClick={() => onChange(card.entry_id, quantity - 1)}>−</button>
      <span aria-live="polite">{t('trade.ofAvailable', { count: quantity, max: card.quantity })}</span>
      <button type="button" className="btn btn-secondary" disabled={disabled || quantity >= Math.min(card.quantity, 10000)}
        aria-label={t('trade.increase', { name })} onClick={() => onChange(card.entry_id, quantity + 1)}>+</button>
    </div> : <p className="trade-muted trade-stepper">{t('trade.available.count', { count: card.quantity })}</p>}
  </article>;
}

function CardPicker({ title, cards, selected, onChange, currency, disabled, sort, game, kind, children }) {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const shown = filterTradeCards(cards, { search, game, sort, facets: { kind } });
  const copies = Object.values(selected).reduce((sum, quantity) => sum + quantity, 0);
  const full = Object.keys(selected).length >= MAX_STACKS;
  return <section className="glass-panel trade-picker">
    <h2>{title}</h2>
    {children}
    <label>{t('trade.search')}
      <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
    </label>
    <p className="trade-muted">{t('trade.selected', { count: copies, stacks: Object.keys(selected).length })}</p>
    {!shown.length && <p>{t('trade.noCards')}</p>}
    <div className="trade-card-list">
      {shown.map(card => <TradeTile key={card.entry_id} card={card} quantity={selected[card.entry_id] || 0}
        onChange={onChange} currency={currency} disabled={disabled} full={full} />)}
    </div>
  </section>;
}

const selectionPayload = selected => Object.entries(selected).map(([id, quantity]) => ({ entry_id: tradeEntryId(id), quantity }));

function parseCash(value) {
  if (!value.trim()) return { cents: 0, valid: true };
  const amount = Number(value);
  const valid = Number.isFinite(amount) && amount >= 0 && amount <= MAX_CASH;
  return { cents: valid ? Math.round(amount * 100) : 0, valid };
}

export default function TradePortal({ tradeToken }) {
  const { t } = useT();
  const [page, setPage] = useState(null);
  const [requested, setRequested] = useState({});
  const [offered, setOffered] = useState({});
  const [cash, setCash] = useState('');
  const [sort, setSort] = useState('name');
  const [game, setGame] = useState('');
  const [kind, setKind] = useState('');
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
  const cashValue = parseCash(cash);
  const payload = JSON.stringify({
    requested: selectionPayload(requested), offered: selectionPayload(offered),
    ...(cashValue.cents ? { cash_cents: cashValue.cents } : {}),
  });
  const bothSides = Object.keys(requested).length > 0 && (Object.keys(offered).length > 0 || cashValue.cents > 0) && cashValue.valid;
  const games = page ? tradeGames(page.available, page.wanted) : [];

  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setError(''); setQuote(null); setRequested({}); setOffered({}); setCash('');
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
      <section className="glass-panel trade-toolbar" aria-label={t('trade.sortLabel')}>
        <label>{t('trades.binders.facet.kind')}
          <select value={kind} onChange={event => setKind(event.target.value)}>
            <option value="">{t('trades.binders.any')}</option>
            {['card', 'sealed'].map(option => <option key={option} value={option}>{t(`trade.kind.${option}`)}</option>)}
          </select>
        </label>
        <label>{t('trade.sortLabel')}
          <select value={sort} onChange={event => setSort(event.target.value)}>
            {TRADE_SORTS.map(option => <option key={option} value={option}>{t(`trade.sort.${option}`)}</option>)}
          </select>
        </label>
        {games.length > 1 && <label>{t('trade.game')}
          <select value={game} onChange={event => setGame(event.target.value)}>
            <option value="">{t('trade.allGames')}</option>
            {games.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>}
        <p className="trade-muted">{t('trade.selectHint')}</p>
      </section>
      <div className="trade-columns">
        <CardPicker title={t('trade.available')} cards={page.available} selected={requested}
          onChange={change(setRequested)} currency={page.currency} disabled={busy} sort={sort} game={game} kind={kind} />
        <CardPicker title={t('trade.wanted')} cards={page.wanted} selected={offered}
          onChange={change(setOffered)} currency={page.currency} disabled={busy} sort={sort} game={game} kind={kind}>
          <div className="trade-cash">
            <label>{t('trade.cash', { currency: page.currency })}
              <input type="number" min="0" max={MAX_CASH} step="0.01" inputMode="decimal" value={cash}
                disabled={busy || !!receipt} aria-invalid={!cashValue.valid}
                onChange={event => { setCash(event.target.value); setReceipt(null); }} />
            </label>
            <p className="trade-muted">{t('trade.cashHint')}</p>
            {!cashValue.valid && <p role="alert">{t('trade.cashInvalid', { max: MAX_CASH })}</p>}
          </div>
        </CardPicker>
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
