import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Download, Package, Plus, Search } from 'lucide-react';
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

function SealedInventory({ showToast }) {
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
  const [catalogSet, setCatalogSet] = useState('');
  const [catalogResults, setCatalogResults] = useState([]);
  const [catalogError, setCatalogError] = useState('');
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [pick, setPick] = useState(null);
  const [quick, setQuick] = useState({ quantity: '1', total_cost: '', currency: 'USD', purchased_at: '', location_id: '' });

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

  const searchCatalog = async (event) => {
    if (event) event.preventDefault();
    if (catalogBusy) return;
    const q = [catalogQuery, catalogSet].map(part => part.trim()).filter(Boolean).join(' ');
    if (q.length < 2) {
      setCatalogError(t('sealed.catalogShort'));
      setCatalogResults([]);
      return;
    }
    setCatalogBusy(true);
    setCatalogError('');
    try {
      const response = await fetch(`/api/sealed/catalog?q=${encodeURIComponent(q)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('sealed.errCatalog'));
      const results = data.results || [];
      setCatalogResults(results);
      if (results.length === 0) setCatalogError(t('sealed.catalogEmpty'));
    } catch (err) {
      setCatalogResults([]);
      setCatalogError(err.message);
    } finally {
      setCatalogBusy(false);
    }
  };

  const chooseProduct = (result) => {
    setPick(result);
    setQuick({ quantity: '1', total_cost: '', currency: 'USD', purchased_at: '', location_id: '' });
    setForm(null);
  };

  const savePick = async (event) => {
    event.preventDefault();
    const body = {
      name: pick.name,
      product_type: pick.product_type,
      language: pick.language || 'English',
      set_id: pick.set_id || '',
      set_name: pick.set_name || '',
      image_url: pick.image_url || '',
      market_price: pick.market_price || '',
      market_currency: pick.market_currency || 'USD',
      market_source: pick.market_source || '',
      provider: pick.provider || '',
      provider_product_id: pick.provider_product_id || '',
      lot: {
        quantity: Number(quick.quantity),
        total_cost: quick.total_cost,
        currency: quick.currency,
        purchased_at: quick.purchased_at,
        location_id: quick.location_id === '' ? null : Number(quick.location_id),
      },
    };
    const response = await fetch('/api/sealed/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(data.error || t('sealed.errSave'), 'error');
      return;
    }
    setPick(null);
    setSelectedId(data.product.id);
    showToast(t('sealed.saved'), 'success');
    refresh();
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
          <button className="btn btn-primary" type="button" onClick={() => { setForm(emptyForm()); setPick(null); setSelectedId(null); }}>
            <Plus size={16} /> {t('sealed.add')}
          </button>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <form onSubmit={searchCatalog} style={{ display: 'grid', gap: '0.75rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('sealed.findTitle')}</label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="input-control"
                placeholder={t('sealed.catalogPlaceholder')}
                value={catalogQuery}
                onChange={e => setCatalogQuery(e.target.value)}
                aria-label={t('sealed.findTitle')}
                style={{ width: '100%', paddingLeft: '2.5rem' }}
              />
              <Search size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('sealed.setOptional')}</label>
              <input
                type="text"
                className="input-control"
                placeholder={t('sealed.setPlaceholder')}
                value={catalogSet}
                onChange={e => setCatalogSet(e.target.value)}
                aria-label={t('sealed.setOptional')}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={catalogBusy} style={{ width: '100%' }}>
            <Search size={18} />
            {catalogBusy ? t('sealed.catalogSearching') : t('sealed.catalogSearch')}
          </button>
        </form>
        <p style={{ margin: '0.75rem 0 0', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('sealed.catalogHint')}</p>
      </div>

      {catalogError && (
        <div className="glass-panel" style={{ borderLeft: '4px solid var(--accent-red)', padding: '1rem', color: 'var(--text-secondary)' }}>
          {catalogError}
        </div>
      )}

      {catalogResults.length > 0 && (
        <div className="card-grid">
          {catalogResults.map(result => (
            <div
              key={`${result.provider}-${result.provider_product_id}`}
              className="tcg-card"
              onClick={() => chooseProduct(result)}
            >
              <div className="tcg-card-inner">
                {result.image_url ? (
                  <img src={result.image_url} alt="" className="tcg-card-image" style={{ objectFit: 'contain', background: 'var(--bg-secondary)' }} />
                ) : (
                  <div className="tcg-card-image" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Package size={28} />
                  </div>
                )}
                <div style={{ position: 'absolute', bottom: '8px', right: '8px', background: 'rgba(0,0,0,0.85)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-glass-hover)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Plus size={10} style={{ color: 'var(--accent-red)' }} />
                  <span style={{ fontSize: '0.65rem', fontWeight: 700 }}>{t('search.quickAdd')}</span>
                </div>
              </div>
              <div className="tcg-card-info">
                <div className="tcg-card-name">{result.name}</div>
                <div className="tcg-card-meta">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{result.set_name || typeLabel(result.product_type)}</span>
                  <span className="tcg-card-price">{result.market_price ? `${result.market_currency} ${result.market_price}` : '—'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pick && (
        <form className="glass-panel" style={{ padding: '1rem', display: 'grid', gap: '0.7rem' }} onSubmit={savePick}>
          <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
            {pick.image_url && <img src={pick.image_url} alt="" style={{ width: '4.5rem', height: '4.5rem', objectFit: 'contain' }} />}
            <div>
              <strong>{pick.name}</strong>
              <div style={{ color: 'var(--text-secondary)' }}>
                {typeLabel(pick.product_type)}{pick.set_name ? ` · ${pick.set_name}` : ''}
                {' · '}
                {pick.market_price ? `${pick.market_currency} ${pick.market_price}` : t('sealed.marketUnknown')}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.6rem' }}>
            <input className="input-control" required type="number" min="1" value={quick.quantity} onChange={e => setQuick({ ...quick, quantity: e.target.value })} aria-label={t('sealed.quantity')} />
            <input className="input-control" required value={quick.total_cost} onChange={e => setQuick({ ...quick, total_cost: e.target.value })} placeholder={t('sealed.cost')} aria-label={t('sealed.cost')} />
            <input className="input-control" required value={quick.currency} onChange={e => setQuick({ ...quick, currency: e.target.value.toUpperCase() })} aria-label={t('sealed.currency')} maxLength={3} />
            <input className="input-control" type="date" value={quick.purchased_at} onChange={e => setQuick({ ...quick, purchased_at: e.target.value })} aria-label={t('sealed.purchased')} />
            <select className="select-control" value={quick.location_id} onChange={e => setQuick({ ...quick, location_id: e.target.value })} aria-label={t('sealed.location')}>
              <option value="">{t('sealed.noLocation')}</option>
              {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary" type="submit">{t('sealed.save')}</button>
            <button className="btn btn-secondary" type="button" onClick={() => setPick(null)}>{t('sealed.cancel')}</button>
          </div>
        </form>
      )}

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
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('sealed.manualHint')}</p>
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
        {(product.provider === 'pokewallet' || product.provider === 'tcgcsv') && product.provider_product_id && (
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
