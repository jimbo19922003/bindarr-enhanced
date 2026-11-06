import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Download, Package, Plus } from 'lucide-react';
import { useT } from '../utils/i18n';

const TYPES = ['booster_box', 'booster_pack', 'etb', 'tin', 'collection_box', 'blister', 'other'];

const emptyForm = () => ({
  name: '',
  product_type: 'etb',
  language: 'English',
  set_name: '',
  image_url: '',
  market_price: '',
  market_currency: 'USD',
  withLot: true,
  quantity: '1',
  remaining_quantity: '',
  total_cost: '',
  currency: 'USD',
  purchased_at: '',
  location_id: '',
  notes: '',
  provider: '',
  provider_product_id: '',
  catalog_category_id: null,
  catalog_group_id: null,
  market_source: '',
});

function moneyLabel(value, currency) {
  if (value == null || value === '') return '—';
  return `${currency || ''} ${value}`.trim();
}

function SealedInventory({ showToast, admin }) {
  const { t } = useT();
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [csv, setCsv] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogResults, setCatalogResults] = useState([]);
  const [catalogMeta, setCatalogMeta] = useState(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncState, setSyncState] = useState(null);

  const typeLabel = (value) => t(`sealed.type.${value}`);

  const load = async (next = {}) => {
    const params = new URLSearchParams();
    const q = next.query ?? query;
    const productType = next.type ?? type;
    const archived = next.showArchived ?? showArchived;
    if (q.trim()) params.set('q', q.trim());
    if (productType) params.set('type', productType);
    if (archived) params.set('archived', '1');
    const response = await fetch(`/api/sealed/products?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('sealed.errLoad'));
    setProducts(data.products || []);
  };

  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const [productRes, locationRes] = await Promise.all([
          fetch('/api/sealed/products'),
          fetch('/api/locations'),
        ]);
        const productData = await productRes.json();
        const locationData = await locationRes.json();
        if (gone) return;
        if (!productRes.ok) throw new Error(productData.error || t('sealed.errLoad'));
        setProducts(productData.products || []);
        setLocations(Array.isArray(locationData) ? locationData : []);
      } catch (err) {
        if (!gone) showToast(err.message, 'error');
      } finally {
        if (!gone) setLoading(false);
      }
    })();
    return () => { gone = true; };
  // showToast is a new function every render. This load is the first visit only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async (next) => {
    try {
      await load(next || {});
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const selected = products.find(product => product.id === selectedId) || null;

  const saveProduct = async (event) => {
    event.preventDefault();
    const body = {
      name: form.name,
      product_type: form.product_type,
      language: form.language,
      set_name: form.set_name,
      image_url: form.image_url,
      market_price: form.market_price,
      market_currency: form.market_currency,
    };
    if (form.provider) body.provider = form.provider;
    if (form.provider_product_id) body.provider_product_id = form.provider_product_id;
    if (form.catalog_category_id) body.catalog_category_id = form.catalog_category_id;
    if (form.catalog_group_id) body.catalog_group_id = form.catalog_group_id;
    if (form.market_source) body.market_source = form.market_source;
    if (form.withLot) {
      body.lot = {
        quantity: Number(form.quantity),
        remaining_quantity: form.remaining_quantity === '' ? undefined : Number(form.remaining_quantity),
        total_cost: form.total_cost,
        currency: form.currency,
        purchased_at: form.purchased_at,
        location_id: form.location_id === '' ? null : Number(form.location_id),
        notes: form.notes,
      };
    }
    const response = await fetch('/api/sealed/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      showToast(data.error || t('sealed.errSave'), 'error');
      return;
    }
    setForm(null);
    setSelectedId(data.product.id);
    showToast(t('sealed.saved'), 'success');
    refresh();
  };

  const saveQuote = async (product) => {
    const response = await fetch(`/api/sealed/products/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market_price: product.market_price == null ? '' : product.market_price,
        market_currency: product.market_currency || 'USD',
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      showToast(data.error || t('sealed.errSave'), 'error');
      return;
    }
    showToast(t('sealed.saved'), 'success');
    refresh();
  };

  const addLot = async (productId, lot) => {
    const response = await fetch(`/api/sealed/products/${productId}/lots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lot),
    });
    const data = await response.json();
    if (!response.ok) {
      showToast(data.error || t('sealed.errSave'), 'error');
      return;
    }
    showToast(t('sealed.saved'), 'success');
    refresh();
  };

  const updateLot = async (lot, patch) => {
    const response = await fetch(`/api/sealed/lots/${lot.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await response.json();
    if (!response.ok) {
      showToast(data.error || t('sealed.errSave'), 'error');
      return;
    }
    showToast(t('sealed.saved'), 'success');
    refresh();
  };

  const searchCatalog = async () => {
    const q = catalogQuery.trim();
    if (q.length < 3) {
      showToast(t('sealed.catalogShort'));
      return;
    }
    setCatalogBusy(true);
    try {
      const response = await fetch(`/api/sealed/catalog?q=${encodeURIComponent(q)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('sealed.errCatalog'));
      setCatalogResults(data.results || []);
      setCatalogMeta(data);
    } catch (err) {
      showToast(err.message);
    } finally {
      setCatalogBusy(false);
    }
  };

  const applyCatalogResult = (result) => {
    setForm(current => ({
      ...current,
      name: result.name,
      product_type: result.product_type,
      language: result.language || 'English',
      set_name: result.set_name || '',
      image_url: result.image_url || '',
      market_price: result.market_price || '',
      market_currency: result.market_currency || 'USD',
      market_source: result.market_price ? 'tcgcsv' : '',
      provider: result.provider || '',
      provider_product_id: result.provider_product_id || '',
      catalog_category_id: result.catalog_category_id || null,
      catalog_group_id: result.catalog_group_id || null,
    }));
  };

  const refreshQuote = async (product) => {
    const response = await fetch(`/api/sealed/products/${product.id}/quote`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) {
      showToast(data.error || t('sealed.errSave'), 'error');
      return;
    }
    showToast(t('sealed.saved'), 'success');
    refresh();
  };

  const startCatalogSync = async () => {
    setSyncing(true);
    const response = await fetch('/api/sealed/catalog/sync', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSyncing(false);
      showToast(data.error || t('sealed.errCatalog'));
      return;
    }
    setSyncState(data);
    if (!data.running) setSyncing(false);
  };

  useEffect(() => {
    if (!admin || !syncing) return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await fetch('/api/sealed/catalog/status');
        const data = await response.json();
        if (!response.ok) return;
        setSyncState(data);
        if (!data.running) setSyncing(false);
      } catch { /* the next poll retries */ }
    }, 1500);
    return () => clearInterval(timer);
  }, [admin, syncing]);

  const setArchived = async (kind, id, archived) => {
    const path = kind === 'product'
      ? `/api/sealed/products/${id}/${archived ? 'archive' : 'restore'}`
      : `/api/sealed/lots/${id}/${archived ? 'archive' : 'restore'}`;
    const response = await fetch(path, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) {
      showToast(data.error || t('sealed.errSave'), 'error');
      return;
    }
    refresh();
  };

  const exportCsv = async () => {
    const response = await fetch('/api/sealed/export');
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      showToast(data.error || t('sealed.errLoad'), 'error');
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sealed-inventory.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = async () => {
    const response = await fetch('/api/sealed/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv }),
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = data.errors && data.errors[0] ? ` (${data.errors[0].line}: ${data.errors[0].error})` : '';
      showToast((data.error || t('sealed.errSave')) + detail, 'error');
      return;
    }
    setCsv('');
    showToast(t('sealed.imported', { products: data.products, lots: data.lots }), 'success');
    refresh();
  };

  if (loading) return <div className="spinner"></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Package size={20} /> {t('sealed.title')}
          </h2>
          <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', maxWidth: '40rem' }}>{t('sealed.intro')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" type="button" onClick={exportCsv}>
            <Download size={16} /> {t('sealed.export')}
          </button>
          {admin && (
            <button className="btn btn-secondary" type="button" onClick={startCatalogSync} disabled={syncing}>
              <Download size={16} /> {syncing ? t('sealed.catalogSyncing', { done: syncState?.done || 0, total: syncState?.total || 0 }) : t('sealed.catalogSync')}
            </button>
          )}
          <button className="btn btn-primary" type="button" onClick={() => { setForm(emptyForm()); setCatalogResults([]); setCatalogMeta(null); setSelectedId(null); }}>
            <Plus size={16} /> {t('sealed.add')}
          </button>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input className="input-control"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') refresh({ query }); }}
          placeholder={t('sealed.search')}
          aria-label={t('sealed.search')}
          style={{ flex: '1 1 12rem' }}
        />
        <select className="select-control" value={type} onChange={e => { setType(e.target.value); refresh({ type: e.target.value }); }} aria-label={t('sealed.type')}>
          <option value="">{t('sealed.allTypes')}</option>
          {TYPES.map(value => <option key={value} value={value}>{typeLabel(value)}</option>)}
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={showArchived} onChange={e => { setShowArchived(e.target.checked); refresh({ showArchived: e.target.checked }); }} />
          {t('sealed.showArchived')}
        </label>
      </div>

      {form && (
        <form className="glass-panel" style={{ padding: '1rem', display: 'grid', gap: '0.6rem' }} onSubmit={saveProduct}>
          <strong>{t('sealed.add')}</strong>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('sealed.catalogHint')}</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input className="input-control"
              value={catalogQuery}
              onChange={e => setCatalogQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchCatalog(); } }}
              placeholder={t('sealed.catalogSearch')}
              aria-label={t('sealed.catalogSearch')}
              style={{ flex: '1 1 16rem' }}
            />
            <button className="btn btn-secondary" type="button" onClick={searchCatalog} disabled={catalogBusy}>
              {catalogBusy ? t('sealed.catalogSearching') : t('sealed.catalogSearch')}
            </button>
          </div>
          {catalogMeta && catalogResults.length === 0 && (
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {catalogMeta.needsSet ? t('sealed.catalogNeedsSet') : t('sealed.catalogEmpty')}
              {catalogMeta.limited ? ` ${t('sealed.catalogLimited')}` : ''}
            </p>
          )}
          {catalogResults.length > 0 && (
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {catalogResults.map(result => (
                <button
                  key={`${result.provider}-${result.provider_product_id}`}
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => applyCatalogResult(result)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', textAlign: 'left', justifyContent: 'flex-start' }}
                >
                  {result.image_url && <img src={result.image_url} alt="" width="44" height="44" style={{ objectFit: 'contain' }} />}
                  <span>
                    <strong>{result.name}</strong>
                    <span style={{ display: 'block', color: 'var(--text-secondary)' }}>
                      {typeLabel(result.product_type)} · {result.set_name || result.language} · {result.market_price ? `${result.market_currency} ${result.market_price}` : t('sealed.marketUnknown')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.6rem' }}>
            {form.image_url && <img src={form.image_url} alt={form.name || ''} style={{ width: '5.5rem', height: '5.5rem', objectFit: 'contain' }} />}
            <input className="input-control" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t('sealed.name')} aria-label={t('sealed.name')} />
            <select className="select-control" value={form.product_type} onChange={e => setForm({ ...form, product_type: e.target.value })} aria-label={t('sealed.type')}>
              {TYPES.map(value => <option key={value} value={value}>{typeLabel(value)}</option>)}
            </select>
            <input className="input-control" value={form.language} onChange={e => setForm({ ...form, language: e.target.value })} placeholder={t('sealed.language')} aria-label={t('sealed.language')} />
            <input className="input-control" value={form.set_name} onChange={e => setForm({ ...form, set_name: e.target.value })} placeholder={t('sealed.set')} aria-label={t('sealed.set')} />
            <input className="input-control" value={form.image_url} onChange={e => setForm({ ...form, image_url: e.target.value })} placeholder={t('sealed.image')} aria-label={t('sealed.image')} />
            <input className="input-control" value={form.market_price} onChange={e => setForm({ ...form, market_price: e.target.value, market_source: '' })} placeholder={t('sealed.market')} aria-label={t('sealed.market')} />
            <input className="input-control" value={form.market_currency} onChange={e => setForm({ ...form, market_currency: e.target.value.toUpperCase() })} placeholder={t('sealed.currency')} aria-label={t('sealed.marketCurrency')} maxLength={3} />
          </div>
          <label style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
            <input type="checkbox" checked={form.withLot} onChange={e => setForm({ ...form, withLot: e.target.checked })} />
            {t('sealed.addLot')}
          </label>
          {form.withLot && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.6rem' }}>
              <input className="input-control" required type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} aria-label={t('sealed.quantity')} />
              <input className="input-control" type="number" min="0" value={form.remaining_quantity} onChange={e => setForm({ ...form, remaining_quantity: e.target.value })} placeholder={t('sealed.remaining')} aria-label={t('sealed.remaining')} />
              <input className="input-control" required value={form.total_cost} onChange={e => setForm({ ...form, total_cost: e.target.value })} placeholder={t('sealed.cost')} aria-label={t('sealed.cost')} />
              <input className="input-control" required value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} aria-label={t('sealed.currency')} maxLength={3} />
              <input className="input-control" type="date" value={form.purchased_at} onChange={e => setForm({ ...form, purchased_at: e.target.value })} aria-label={t('sealed.purchased')} />
              <select className="select-control" value={form.location_id} onChange={e => setForm({ ...form, location_id: e.target.value })} aria-label={t('sealed.location')}>
                <option value="">{t('sealed.noLocation')}</option>
                {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
              <input className="input-control" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder={t('sealed.notes')} aria-label={t('sealed.notes')} />
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary" type="submit">{t('sealed.save')}</button>
            <button className="btn btn-secondary" type="button" onClick={() => setForm(null)}>{t('sealed.cancel')}</button>
          </div>
        </form>
      )}

      {products.length === 0 && !form && (
        <div className="glass-panel" style={{ padding: '1.5rem', color: 'var(--text-secondary)' }}>{t('sealed.empty')}</div>
      )}

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {products.map(product => (
          <article key={product.id} className="glass-panel" style={{ padding: '0.9rem', opacity: product.archived_at ? 0.65 : 1 }}>
            <button
              type="button"
              onClick={() => setSelectedId(selectedId === product.id ? null : product.id)}
              style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: '1rem', width: '100%', alignItems: 'center' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                {product.image_url && <img src={product.image_url} alt="" width="48" height="48" style={{ objectFit: 'contain', borderRadius: '4px' }} />}
                <span>
                <strong style={{ color: 'var(--text-strong)' }}>{product.name}</strong>
                <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                  {typeLabel(product.product_type)} · {product.language}{product.set_name ? ` · ${product.set_name}` : ''}
                </span>
                </span>
              </span>
              <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
                {t('sealed.onHand', { count: product.remaining_quantity })}
                <br />
                {t('sealed.marketShort')} {moneyLabel(product.market_price, product.market_currency)}
              </span>
            </button>
            {selected && selected.id === product.id && (
              <ProductDetail
                product={selected}
                locations={locations}
                t={t}
                onArchive={() => setArchived('product', product.id, !product.archived_at)}
                onQuote={(market_price, market_currency) => saveQuote({ ...product, market_price, market_currency })}
                onAddLot={lot => addLot(product.id, lot)}
                onUpdateLot={updateLot}
                onArchiveLot={(lot, archived) => setArchived('lot', lot.id, archived)}
                onRefreshQuote={() => refreshQuote(product)}
              />
            )}
          </article>
        ))}
      </div>

      <div className="glass-panel" style={{ padding: '0.9rem', display: 'grid', gap: '0.5rem' }}>
        <strong>{t('sealed.import')}</strong>
        <textarea className="input-control"
          value={csv}
          onChange={e => setCsv(e.target.value)}
          rows={4}
          placeholder={t('sealed.importHint')}
          aria-label={t('sealed.import')}
          style={{ width: '100%', fontFamily: 'inherit' }}
        />
        <div>
          <button className="btn btn-secondary" type="button" onClick={importCsv} disabled={!csv.trim()}>{t('sealed.import')}</button>
        </div>
      </div>
    </div>
  );
}

function ProductDetail({ product, locations, t, onArchive, onQuote, onAddLot, onUpdateLot, onArchiveLot, onRefreshQuote }) {
  const [market, setMarket] = useState(product.market_price || '');
  const [marketCurrency, setMarketCurrency] = useState(product.market_currency || 'USD');
  const [lot, setLot] = useState({ quantity: '1', remaining_quantity: '', total_cost: '', currency: 'USD', purchased_at: '', location_id: '', notes: '' });

  useEffect(() => {
    setMarket(product.market_price || '');
    setMarketCurrency(product.market_currency || 'USD');
  }, [product.id, product.market_price, product.market_currency]);

  return (
    <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.7rem' }}>
      {product.image_url && <img src={product.image_url} alt={product.name} style={{ width: '6rem', height: '6rem', objectFit: 'contain' }} />}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input-control" value={market} onChange={e => setMarket(e.target.value)} aria-label={t('sealed.market')} placeholder={t('sealed.market')} style={{ width: '7rem' }} />
        <input className="input-control" value={marketCurrency} onChange={e => setMarketCurrency(e.target.value.toUpperCase())} aria-label={t('sealed.marketCurrency')} maxLength={3} style={{ width: '4.5rem' }} />
        <button className="btn btn-secondary" type="button" onClick={() => onQuote(market, marketCurrency)}>{t('sealed.saveQuote')}</button>
        {product.provider === 'tcgcsv' && (
          <button className="btn btn-secondary" type="button" onClick={onRefreshQuote}>{t('sealed.updateQuote')}</button>
        )}
        <button className="btn btn-secondary" type="button" onClick={onArchive}>
          {product.archived_at ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          {product.archived_at ? t('sealed.restore') : t('sealed.archive')}
        </button>
      </div>
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('sealed.quoteHint')}</p>
      {product.lots.map(item => (
        <LotRow key={item.id} lot={item} t={t} onUpdateLot={onUpdateLot} onArchiveLot={onArchiveLot} />
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '0.45rem' }}>
        <input className="input-control" type="number" min="1" value={lot.quantity} onChange={e => setLot({ ...lot, quantity: e.target.value })} aria-label={t('sealed.quantity')} />
        <input className="input-control" value={lot.total_cost} onChange={e => setLot({ ...lot, total_cost: e.target.value })} placeholder={t('sealed.cost')} aria-label={t('sealed.cost')} />
        <input className="input-control" value={lot.currency} onChange={e => setLot({ ...lot, currency: e.target.value.toUpperCase() })} aria-label={t('sealed.currency')} maxLength={3} />
        <input className="input-control" type="date" value={lot.purchased_at} onChange={e => setLot({ ...lot, purchased_at: e.target.value })} aria-label={t('sealed.purchased')} />
        <select className="select-control" value={lot.location_id} onChange={e => setLot({ ...lot, location_id: e.target.value })} aria-label={t('sealed.location')}>
          <option value="">{t('sealed.noLocation')}</option>
          {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => onAddLot({
            quantity: Number(lot.quantity),
            total_cost: lot.total_cost,
            currency: lot.currency,
            purchased_at: lot.purchased_at,
            location_id: lot.location_id === '' ? null : Number(lot.location_id),
            notes: lot.notes,
          })}
        >
          {t('sealed.addLot')}
        </button>
      </div>
    </div>
  );
}

function LotRow({ lot, t, onUpdateLot, onArchiveLot }) {
  const [remaining, setRemaining] = useState(String(lot.remaining_quantity));
  const [cost, setCost] = useState(lot.total_cost);
  useEffect(() => {
    setRemaining(String(lot.remaining_quantity));
    setCost(lot.total_cost);
  }, [lot.id, lot.remaining_quantity, lot.total_cost]);
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', opacity: lot.archived_at ? 0.6 : 1 }}>
      <span>{t('sealed.lotLine', { count: lot.quantity, cost: `${lot.currency} ${lot.total_cost}`, remaining: lot.remaining_quantity, basis: `${lot.currency} ${lot.remaining_cost}` })}</span>
      {lot.location_name && <span style={{ color: 'var(--text-secondary)' }}>{lot.location_name}</span>}
      {lot.purchased_at && <span style={{ color: 'var(--text-secondary)' }}>{lot.purchased_at}</span>}
      <input className="input-control" value={remaining} onChange={e => setRemaining(e.target.value)} aria-label={t('sealed.remaining')} style={{ width: '4.5rem' }} />
      <input className="input-control" value={cost} onChange={e => setCost(e.target.value)} aria-label={t('sealed.cost')} style={{ width: '6rem' }} />
      <button className="btn btn-secondary" type="button" onClick={() => onUpdateLot(lot, { remaining_quantity: Number(remaining), total_cost: cost })}>{t('sealed.save')}</button>
      <button className="btn btn-secondary" type="button" onClick={() => onArchiveLot(lot, !lot.archived_at)}>
        {lot.archived_at ? t('sealed.restore') : t('sealed.archive')}
      </button>
    </div>
  );
}

export default SealedInventory;
