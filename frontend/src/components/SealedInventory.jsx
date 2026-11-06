import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Download, Package, Plus, Search, X } from 'lucide-react';
import { useT } from '../utils/i18n';
import SealedOpenings from './SealedOpenings';

const TYPES = ['booster_box', 'booster_pack', 'etb', 'tin', 'collection_box', 'blister', 'other'];

function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

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
  purchased_at: todayISO(),
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
  const [pane, setPane] = useState('collection');
  const [picked, setPicked] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [shared, setShared] = useState({ currency: 'USD', purchased_at: todayISO(), location_id: '' });

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
      return false;
    }
    showToast(t('sealed.saved'), 'success');
    refresh();
    return true;
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

  const resultKey = (result) => `${result.provider}:${result.provider_product_id}`;

  const openAdd = (result) => {
    setForm(null);
    setPicked({ [resultKey(result)]: { result, quantity: '1', total_cost: '' } });
    setAddOpen(true);
  };

  const closeAdd = () => {
    setAddOpen(false);
    setPicked({});
  };

  const saveSelected = async (event) => {
    event.preventDefault();
    const items = Object.values(picked).map(item => ({
      name: item.result.name,
      product_type: item.result.product_type,
      language: item.result.language || 'English',
      set_id: item.result.set_id || '',
      set_name: item.result.set_name || '',
      image_url: item.result.image_url || '',
      market_price: item.result.market_price || '',
      market_currency: item.result.market_currency || 'USD',
      market_source: item.result.market_source || '',
      provider: item.result.provider || '',
      provider_product_id: item.result.provider_product_id || '',
      quantity: Number(item.quantity),
      total_cost: item.total_cost,
    }));
    const response = await fetch('/api/sealed/products/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shared: {
          currency: shared.currency,
          purchased_at: shared.purchased_at,
          location_id: shared.location_id === '' ? null : Number(shared.location_id),
        },
        items,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(data.error || t('sealed.errSave'), 'error');
      return;
    }
    closeAdd();
    setPane('collection');
    showToast(t('sealed.saved'), 'success');
    refresh();
  };

  const pickedList = Object.entries(picked);

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
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="sub-nav-tabs" style={{ width: '100%', maxWidth: '420px', margin: 0 }}>
          <button type="button" className={`sub-nav-tab ${pane === 'collection' ? 'active' : ''}`} onClick={() => setPane('collection')}>
            <Package size={18} />
            <span>{t('sealed.tabCollection')}</span>
          </button>
          <button type="button" className={`sub-nav-tab ${pane === 'add' ? 'active' : ''}`} onClick={() => setPane('add')}>
            <Search size={18} />
            <span>{t('sealed.tabAdd')}</span>
          </button>
        </div>
      </div>

      {pane === 'add' && (<>

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
        <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('sealed.selectHint')}</p>
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
              key={resultKey(result)}
              className="tcg-card"
              onClick={() => openAdd(result)}
            >
              <div className="tcg-card-inner">
                {result.image_url ? (
                  <img src={result.image_url} alt="" className="tcg-card-image" style={{ objectFit: 'contain', background: 'var(--bg-secondary)' }} />
                ) : (
                  <div className="tcg-card-image" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Package size={28} />
                  </div>
                )}
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

      <div className={`drawer-backdrop ${addOpen ? 'open' : ''}`} onClick={closeAdd} />
      <div className={`quick-add-drawer ${addOpen ? 'open' : ''}`} style={{ maxWidth: '720px' }}>
        {addOpen && pickedList.length > 0 && (
          <form onSubmit={saveSelected} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ color: 'var(--text-strong)', fontSize: '1.25rem', margin: 0 }}>{t('sealed.addProductsTitle')}</h3>
              </div>
              <button className="btn btn-secondary btn-icon-only" type="button" onClick={closeAdd} style={{ borderRadius: '50%', flexShrink: 0 }} aria-label={t('common.cancel')}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '40vh', overflowY: 'auto' }}>
              {pickedList.map(([key, item]) => (
                <div key={key} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
                  {item.result.image_url ? (
                    <img src={item.result.image_url} alt="" style={{ width: '72px', height: '72px', objectFit: 'contain', borderRadius: 'var(--radius-sm)', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: '72px', height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Package size={22} /></div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{item.result.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                      {item.result.set_name || typeLabel(item.result.product_type)}
                      {' · '}
                      <span style={{ color: 'var(--accent-yellow)', fontWeight: 700 }}>
                        {item.result.market_price ? `${item.result.market_currency} ${item.result.market_price}` : t('sealed.marketUnknown')}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>{t('card.quantity')}</label>
                        <input className="input-control" required type="number" min="1" value={item.quantity} onChange={e => setPicked(current => ({ ...current, [key]: { ...item, quantity: e.target.value } }))} />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>{t('sealed.cost')}</label>
                        <input className="input-control" required value={item.total_cost} onChange={e => setPicked(current => ({ ...current, [key]: { ...item, total_cost: e.target.value } }))} placeholder="0.00" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t('sealed.currency')}</label>
                <input className="input-control" required value={shared.currency} onChange={e => setShared({ ...shared, currency: e.target.value.toUpperCase() })} maxLength={3} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t('sealed.purchased')}</label>
                <input className="input-control" type="date" value={shared.purchased_at} onChange={e => setShared({ ...shared, purchased_at: e.target.value })} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t('sealed.location')}</label>
                <select className="select-control" value={shared.location_id} onChange={e => setShared({ ...shared, location_id: e.target.value })}>
                  <option value="">{t('sealed.noLocation')}</option>
                  {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </div>
            </div>

            <div className="quick-add-footer" style={{ marginTop: '0.25rem', paddingTop: '0.25rem' }}>
              <div className="quick-add-footer-actions">
                <button type="button" className="btn btn-secondary" onClick={closeAdd}>{t('common.cancel')}</button>
                <button type="submit" className="btn btn-primary">{t('sealed.addToInventory')}</button>
              </div>
            </div>
          </form>
        )}
      </div>

      <div>
        <button className="btn btn-secondary" type="button" onClick={() => { setForm(form ? null : emptyForm()); setPicked({}); }}>
          <Plus size={16} /> {t('sealed.add')}
        </button>
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
      </>)}

      {pane === 'collection' && (<>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" type="button" onClick={exportCsv}>
          <Download size={16} /> {t('sealed.export')}
        </button>
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

      {products.length === 0 && (
        <div className="glass-panel" style={{ padding: '1.5rem', color: 'var(--text-secondary)' }}>{t('sealed.empty')}</div>
      )}

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {products.map(product => (
          <article key={product.id} className="glass-panel" style={{ padding: '0.9rem', opacity: product.archived_at ? 0.65 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setSelectedId(selectedId === product.id ? null : product.id)}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.7rem', flex: '1 1 16rem' }}
              >
                {product.image_url && <img src={product.image_url} alt="" width="48" height="48" style={{ objectFit: 'contain', borderRadius: '4px' }} />}
                <span>
                  <strong style={{ color: 'var(--text-strong)' }}>{product.name}</strong>
                  <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                    {typeLabel(product.product_type)} · {product.language}{product.set_name ? ` · ${product.set_name}` : ''}
                  </span>
                </span>
              </button>
              {selected && selected.id === product.id ? (
                <MarketForm
                  product={product}
                  t={t}
                  onQuote={(market_price, market_currency) => saveQuote({ ...product, market_price, market_currency })}
                  onRefreshQuote={() => refreshQuote(product)}
                  onArchive={() => setArchived('product', product.id, !product.archived_at)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setSelectedId(product.id)}
                  style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-secondary)', textAlign: 'right' }}
                >
                  {t('sealed.onHand', { count: product.remaining_quantity })}
                  <br />
                  {t('sealed.marketShort')} {moneyLabel(product.market_price, product.market_currency)}
                </button>
              )}
            </div>
            {selected && selected.id === product.id && (
              <ProductDetail
                product={selected}
                locations={locations}
                t={t}
                onAddLot={lot => addLot(product.id, lot)}
                onUpdateLot={updateLot}
                onArchiveLot={(lot, archived) => setArchived('lot', lot.id, archived)}
                showToast={showToast}
                onChanged={refresh}
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
      </>)}
    </div>
  );
}

function MarketForm({ product, t, onQuote, onRefreshQuote, onArchive }) {
  const [market, setMarket] = useState(product.market_price || '');
  const [marketCurrency, setMarketCurrency] = useState(product.market_currency || 'USD');

  useEffect(() => {
    setMarket(product.market_price || '');
    setMarketCurrency(product.market_currency || 'USD');
  }, [product.id, product.market_price, product.market_currency]);

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); onQuote(market, marketCurrency); }}
      style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}
    >
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t('sealed.onHand', { count: product.remaining_quantity })}</span>
      <input className="input-control" value={market} onChange={e => setMarket(e.target.value)} aria-label={t('sealed.market')} placeholder={t('sealed.market')} style={{ width: '6.5rem' }} />
      <input className="input-control" value={marketCurrency} onChange={e => setMarketCurrency(e.target.value.toUpperCase())} aria-label={t('sealed.marketCurrency')} maxLength={3} style={{ width: '4.2rem' }} />
      <button className="btn btn-secondary" type="submit">{t('sealed.saveQuote')}</button>
      {(product.provider === 'pokewallet' || product.provider === 'tcgcsv') && product.provider_product_id && (
        <button className="btn btn-secondary" type="button" onClick={onRefreshQuote}>{t('sealed.updateQuote')}</button>
      )}
      <button className="btn btn-secondary" type="button" onClick={onArchive}>
        {product.archived_at ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        {product.archived_at ? t('sealed.restore') : t('sealed.archive')}
      </button>
    </form>
  );
}

function compareLots(a, b, sort) {
  if (sort.key === 'purchased_at') {
    if (!a.purchased_at && !b.purchased_at) return a.id - b.id;
    if (!a.purchased_at) return 1;
    if (!b.purchased_at) return -1;
    const cmp = a.purchased_at < b.purchased_at ? -1 : a.purchased_at > b.purchased_at ? 1 : 0;
    return sort.dir === 'asc' ? cmp : -cmp;
  }
  const cmp = a.total_cost_cents - b.total_cost_cents;
  if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp;
  return a.id - b.id;
}

function ProductDetail({ product, locations, t, onAddLot, onUpdateLot, onArchiveLot, showToast, onChanged }) {
  const [ripLot, setRipLot] = useState(null);
  const [sort, setSort] = useState({ key: 'purchased_at', dir: 'desc' });
  const [lot, setLot] = useState({ quantity: '1', remaining_quantity: '', total_cost: '', currency: 'USD', purchased_at: todayISO(), location_id: '', notes: '' });
  const lots = [...(product.lots || [])].sort((a, b) => compareLots(a, b, sort));

  useEffect(() => { setRipLot(null); }, [product.id]);

  const toggleSort = (key) => {
    setSort(current => (
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    ));
  };

  const sortMark = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.7rem' }}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('sealed.quoteHint')}</p>
      <div className="collection-table-wrapper" style={{ marginTop: 0 }}>
        <table className="collection-table">
          <thead>
            <tr>
              <th aria-sort={sort.key === 'purchased_at' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => toggleSort('purchased_at')} style={{ background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', cursor: 'pointer' }}>
                  {t('sealed.purchased')}{sortMark('purchased_at')}
                </button>
              </th>
              <th>{t('sealed.quantity')}</th>
              <th aria-sort={sort.key === 'total_cost' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => toggleSort('total_cost')} style={{ background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', cursor: 'pointer' }}>
                  {t('sealed.colPaid')}{sortMark('total_cost')}
                </button>
              </th>
              <th>{t('sealed.colLeft')}</th>
              <th className="hide-mobile">{t('sealed.colBasis')}</th>
              <th className="hide-mobile">{t('sealed.location')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lots.map(item => (
              <LotRow key={item.id} lot={item} t={t} onUpdateLot={onUpdateLot} onArchiveLot={onArchiveLot} onRip={() => setRipLot(item)} />
            ))}
          </tbody>
        </table>
      </div>
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
          onClick={async () => {
            const added = await onAddLot({
              quantity: Number(lot.quantity),
              total_cost: lot.total_cost,
              currency: lot.currency,
              purchased_at: lot.purchased_at,
              location_id: lot.location_id === '' ? null : Number(lot.location_id),
              notes: lot.notes,
            });
            if (added) {
              setLot({ quantity: '1', remaining_quantity: '', total_cost: '', currency: lot.currency, purchased_at: todayISO(), location_id: '', notes: '' });
            }
          }}
        >
          {t('sealed.addLot')}
        </button>
      </div>
      <SealedOpenings product={product} showToast={showToast} onChanged={onChanged} ripLot={ripLot} onCloseRip={() => setRipLot(null)} />
    </div>
  );
}

function LotRow({ lot, t, onUpdateLot, onArchiveLot, onRip }) {
  const [remaining, setRemaining] = useState(String(lot.remaining_quantity));
  const [cost, setCost] = useState(lot.total_cost);
  const canRip = !lot.archived_at && lot.remaining_quantity > 0;
  useEffect(() => {
    setRemaining(String(lot.remaining_quantity));
    setCost(lot.total_cost);
  }, [lot.id, lot.remaining_quantity, lot.total_cost]);
  return (
    <tr style={{ opacity: lot.archived_at ? 0.6 : 1 }}>
      <td>{lot.purchased_at || '—'}</td>
      <td>{lot.quantity}</td>
      <td>
        <input className="input-control" value={cost} onChange={e => setCost(e.target.value)} aria-label={t('sealed.cost')} style={{ width: '6rem' }} />
      </td>
      <td>
        <input className="input-control" value={remaining} onChange={e => setRemaining(e.target.value)} aria-label={t('sealed.remaining')} style={{ width: '4.2rem' }} />
      </td>
      <td className="hide-mobile">{lot.currency} {lot.remaining_cost}</td>
      <td className="hide-mobile">{lot.location_name || '—'}</td>
      <td>
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {canRip && <button className="btn btn-primary" type="button" onClick={onRip}>{t('sealed.letItRip')}</button>}
          <button className="btn btn-secondary" type="button" onClick={() => onUpdateLot(lot, { remaining_quantity: Number(remaining), total_cost: cost })}>{t('sealed.save')}</button>
          <button className="btn btn-secondary" type="button" onClick={() => onArchiveLot(lot, !lot.archived_at)}>
            {lot.archived_at ? t('sealed.restore') : t('sealed.archive')}
          </button>
        </div>
      </td>
    </tr>
  );
}

export default SealedInventory;
