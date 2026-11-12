import { useCallback, useEffect, useState } from 'react';
import { useT } from '../../utils/i18n';
import { tradeApi, tradeItemDetails } from '../../utils/tradeApi';
import { TRADE_FACETS, TRADE_SORTS, filterTradeCards, tradeFacetValues, tradeGames } from '../../utils/tradeSort';
import { Money } from '../TradeShared';

const MASTER = 'master';
const NO_FACETS = Object.fromEntries(TRADE_FACETS.map(field => [field, '']));

function BinderTile({ card, selected, onToggle, currency, binderNames, current }) {
  const { t } = useT();
  const inCurrent = current !== MASTER && card.binder_ids.includes(current);
  return <article className={`trade-card ${selected ? 'trade-selected' : ''}`}>
    <button type="button" className="trade-card-select" aria-pressed={selected}
      onClick={() => onToggle(card.entry_id)} title={selected ? t('trade.clickToRemove') : t('trade.clickToSelect')}>
      {card.image_url ? <img src={card.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
        : <span className="trade-card-placeholder" aria-hidden="true" />}
      <span className="trade-card-body">
        <strong className="trade-card-name">{card.quantity}x {card.printed_name || card.name}</strong>
        <span className="trade-muted">{card.kind === 'sealed' && `${t('trade.kind.sealed')} · ${t(`sealed.type.${card.product_type}`)} · `}
          {[...tradeItemDetails(card), card.rarity].filter(Boolean).join(' / ')}</span>
        <span><Money cents={card.unit_cents} currency={currency} /></span>
        <span className="trades-binder-tags">
          {inCurrent && <span className="trades-tag trades-tag-current">{t('trades.binders.membership.in')}</span>}
          {card.binder_ids.filter(id => id !== current).map(id => <span key={id} className="trades-tag">{binderNames.get(id)}</span>)}
          {!card.binder_ids.length && <span className="trade-muted">{t('trades.binders.noBinder')}</span>}
        </span>
      </span>
    </button>
  </article>;
}

function BinderEditor({ binder, origin, busy, act, reload, showToast }) {
  const { t } = useT();
  const [name, setName] = useState(binder.name);
  const [enabled, setEnabled] = useState(binder.enabled);
  const url = `${origin}/trade/${binder.token}`;
  const save = event => {
    event.preventDefault();
    act(async () => { await tradeApi(`/api/trade/binders/${binder.id}`, { method: 'PUT', body: { name, enabled } }); await reload(); showToast(t('trade.saved')); });
  };
  return <div className="trades-binder-editor">
    <form className="trade-config" onSubmit={save}>
      <label>{t('trades.binders.name')}<input required maxLength={60} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label><input type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)} /> {t('trades.binders.enabled')}</label>
      <button className="btn btn-primary" disabled={busy || (name === binder.name && enabled === binder.enabled)}>{t('common.save')}</button>
    </form>
    {binder.enabled ? <label>{t('trade.link')}<input readOnly value={url} onFocus={event => event.target.select()} /></label>
      : <p className="trade-muted">{t('trades.binders.disabledHint')}</p>}
    <div className="trade-actions">
      <button type="button" className="btn btn-secondary" disabled={busy || !binder.enabled} onClick={() => act(async () => {
        await navigator.clipboard.writeText(url); showToast(t('trade.copied'));
      })}>{t('trade.copy')}</button>
      {binder.enabled && <a className="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer">{t('trade.preview')}</a>}
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => {
        if (window.confirm(t('trade.rotateConfirm'))) act(async () => { await tradeApi(`/api/trade/binders/${binder.id}/rotate`, { method: 'POST' }); await reload(); showToast(t('trade.rotated')); });
      }}>{t('trade.rotate')}</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => {
        if (window.confirm(t('trades.binders.deleteConfirm', { name: binder.name }))) act(async () => { await tradeApi(`/api/trade/binders/${binder.id}`, { method: 'DELETE' }); await reload(true); });
      }}>{t('common.delete')}</button>
    </div>
  </div>;
}

export default function TradeBinders({ origin, showToast }) {
  const { t } = useT();
  const [items, setItems] = useState(null);
  const [binders, setBinders] = useState([]);
  const [current, setCurrent] = useState(MASTER);
  const [membership, setMembership] = useState('all');
  const [selected, setSelected] = useState(() => new Set());
  const [target, setTarget] = useState('');
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  const [game, setGame] = useState('');
  const [facets, setFacets] = useState(NO_FACETS);
  const [sort, setSort] = useState('name');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (signal) => {
    const [list, owned] = await Promise.all([tradeApi('/api/trade/items', { signal }), tradeApi('/api/trade/binders', { signal })]);
    setItems(list); setBinders(owned);
    return owned;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [load]);
  const reload = async (resetCurrent = false) => {
    const owned = await load();
    setSelected(new Set());
    if (resetCurrent || (current !== MASTER && !owned.some(binder => binder.id === current))) setCurrent(MASTER);
  };
  const act = async work => {
    setBusy(true); setError('');
    try { await work(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const binder = binders.find(item => item.id === current);
  const binderNames = new Map(binders.map(item => [item.id, item.name]));
  const visible = card => current === MASTER || membership === 'all'
    || (membership === 'in') === card.binder_ids.includes(current);
  const all = items ? [...items.available, ...items.wanted] : [];
  const entryIds = all.filter(card => selected.has(card.entry_id)).flatMap(card => card.entry_ids);
  const toggle = id => setSelected(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const assign = (addTo, removeFrom, message) => act(async () => {
    await tradeApi('/api/trade/binder-items', { method: 'PUT', body: { entry_ids: entryIds, add_to: addTo, remove_from: removeFrom } });
    await reload(); setTarget(''); showToast(message);
  });
  const targets = binders.filter(item => item.id !== current);

  const filters = { search, game, sort, facets };
  const filtered = !!(search || game || TRADE_FACETS.some(field => facets[field])) || membership !== 'all';
  const clearFilters = () => { setSearch(''); setGame(''); setFacets(NO_FACETS); setMembership('all'); };
  const games = items ? tradeGames(items.available, items.wanted) : [];
  const shownAvailable = items ? filterTradeCards(items.available.filter(visible), filters) : [];
  const shownWanted = items ? filterTradeCards(items.wanted.filter(visible), filters) : [];

  const column = (title, cards, total) => {
    const allOn = cards.length > 0 && cards.every(card => selected.has(card.entry_id));
    return <section className="glass-panel trade-picker">
      <div className="trade-actions">
        <h3>{title} <span className="tab-count-badge">{cards.length}</span></h3>
        {cards.length !== total && <span className="trade-muted">{t('trades.binders.showing', { shown: cards.length, total })}</span>}
        <button type="button" className="btn btn-secondary trades-push" disabled={busy || !cards.length} onClick={() => setSelected(previous => {
          const next = new Set(previous);
          cards.forEach(card => (allOn ? next.delete(card.entry_id) : next.add(card.entry_id)));
          return next;
        })}>{t('trades.binders.selectAll')}</button>
      </div>
      {!cards.length && <p className="trade-muted">{t('trade.noCards')}</p>}
      <div className="trade-card-list">
        {cards.map(card => <BinderTile key={card.entry_id} card={card} selected={selected.has(card.entry_id)}
          onToggle={toggle} currency={items.currency} binderNames={binderNames} current={current} />)}
      </div>
    </section>;
  };

  return <div className="trades-binders">
    <section className="glass-panel trades-binder-bar">
      <div>
        <h3>{t('trades.binders.title')}</h3>
        <p className="trade-muted">{t('trades.binders.hint')}</p>
      </div>
      <div className="trades-chips" role="tablist" aria-label={t('trades.binders.title')}>
        <button type="button" role="tab" aria-selected={current === MASTER} className={`trades-chip ${current === MASTER ? 'active' : ''}`}
          onClick={() => { setCurrent(MASTER); setSelected(new Set()); setMembership('all'); }}>
          {t('trades.binders.master')} {items && <span className="tab-count-badge">{all.length}</span>}
        </button>
        {binders.map(item => <button key={item.id} type="button" role="tab" aria-selected={current === item.id}
          className={`trades-chip ${current === item.id ? 'active' : ''}`}
          onClick={() => { setCurrent(item.id); setSelected(new Set()); setMembership('all'); }}>
          {item.name} <span className="tab-count-badge">{item.items}</span>{item.enabled ? '' : ` · ${t('trades.binders.off')}`}
        </button>)}
      </div>
      <form className="trades-line" onSubmit={event => {
        event.preventDefault();
        act(async () => { const created = await tradeApi('/api/trade/binders', { method: 'POST', body: { name: newName } }); setNewName(''); await reload(); setCurrent(created.id); });
      }}>
        <label>{t('trades.binders.new')}<input maxLength={60} value={newName} disabled={busy} onChange={event => setNewName(event.target.value)} /></label>
        <button className="btn btn-primary" disabled={busy || !newName.trim()}>{t('trades.binders.create')}</button>
      </form>
      {!binders.length && <p className="trade-muted">{t('trades.binders.createFirst')}</p>}
    </section>
    <section className="glass-panel trades-binder-main">
      <h3>{binder ? binder.name : t('trades.binders.master')}</h3>
      <p className="trade-muted">{binder ? t('trades.binders.customHint') : t('trades.binders.masterHint')}</p>
      {binder && <BinderEditor key={`${binder.id}-${binder.token}-${binder.name}-${binder.enabled}`} binder={binder} origin={origin}
        busy={busy} act={act} reload={reload} showToast={showToast} />}
    </section>
    {error && <p role="alert">{error}</p>}
    {!items ? !error && <p role="status">{t('common.loading')}</p> : <>
      <section className="glass-panel trade-toolbar trades-filters" aria-label={t('trades.binders.filters')}>
        <label className="trades-filter-search">{t('trade.search')}<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
        {games.length > 1 && <label>{t('trade.game')}
          <select value={game} onChange={event => setGame(event.target.value)}>
            <option value="">{t('trade.allGames')}</option>
            {games.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>}
        {TRADE_FACETS.map(field => <label key={field}>{t(`trades.binders.facet.${field}`)}
          <select value={facets[field]} onChange={event => setFacets(previous => ({ ...previous, [field]: event.target.value }))}>
            <option value="">{t('trades.binders.any')}</option>
            {tradeFacetValues(field, items.available, items.wanted).map(option => <option key={option} value={option}>
              {field === 'kind' ? t(`trade.kind.${option}`) : option}
            </option>)}
          </select>
        </label>)}
        {binder && <label>{t('trades.binders.show')}
          <select value={membership} onChange={event => setMembership(event.target.value)}>
            {['all', 'in', 'out'].map(option => <option key={option} value={option}>{t(`trades.binders.membership.${option}`)}</option>)}
          </select>
        </label>}
        <label>{t('trade.sortLabel')}
          <select value={sort} onChange={event => setSort(event.target.value)}>
            {TRADE_SORTS.map(option => <option key={option} value={option}>{t(`trade.sort.${option}`)}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-secondary" disabled={!filtered} onClick={clearFilters}>{t('trades.binders.clearFilters')}</button>
      </section>
      <div className="trades-actionbar" aria-live="polite">
        <span>{t('trades.binders.selected', { count: selected.size })}</span>
        <button type="button" className="btn btn-secondary" disabled={!selected.size} onClick={() => setSelected(new Set())}>{t('trades.binders.clearSelection')}</button>
        {binder && <>
          <button type="button" className="btn btn-primary" disabled={busy || !entryIds.length}
            onClick={() => assign([binder.id], [], t('trades.binders.added', { name: binder.name }))}>{t('trades.binders.addHere')}</button>
          <button type="button" className="btn btn-secondary" disabled={busy || !entryIds.length}
            onClick={() => assign([], [binder.id], t('trades.binders.removed', { name: binder.name }))}>{t('trades.binders.removeHere')}</button>
        </>}
        {targets.length > 0 && <label>
          <select value={target} disabled={busy} onChange={event => setTarget(event.target.value)} aria-label={t('trades.binders.target')}>
            <option value="">{t('trades.binders.target')}</option>
            {targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>}
        {targets.length > 0 && <button type="button" className="btn btn-secondary" disabled={busy || !entryIds.length || !target}
          onClick={() => { const next = binders.find(item => item.id === Number(target)); assign([next.id], [], t('trades.binders.added', { name: next.name })); }}>
          {t('trades.binders.addTo')}</button>}
        {binder && targets.length > 0 && <button type="button" className="btn btn-secondary" disabled={busy || !entryIds.length || !target}
          onClick={() => { const next = binders.find(item => item.id === Number(target)); assign([next.id], [binder.id], t('trades.binders.moved', { name: next.name })); }}>
          {t('trades.binders.moveTo')}</button>}
        <button type="button" className="btn btn-secondary trades-push" disabled={busy || !entryIds.length} onClick={() => {
          if (window.confirm(t('trades.binders.unlistConfirm', { count: entryIds.length }))) act(async () => {
            const result = await tradeApi('/api/trade/items/unlist', { method: 'POST', body: { entry_ids: entryIds } });
            await reload(); showToast(t('trades.binders.unlisted', { count: result.unlisted, wanted: result.removed_wanted }));
          });
        }}>{t('trades.binders.unlist')}</button>
      </div>
      <p className="trade-muted">{t('trades.binders.selectHint')}</p>
      <div className="trade-columns">
        {column(t('trade.available'), shownAvailable, items.available.length)}
        {column(t('trade.wanted'), shownWanted, items.wanted.length)}
      </div>
    </>}
  </div>;
}
