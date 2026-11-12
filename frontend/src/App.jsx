import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { LayoutDashboard, Database, MapPin, Sparkles, Settings as SettingsIcon, LogOut, ShieldAlert, Plus, Swords, StickyNote, Package } from 'lucide-react';
import Login from './components/Login';
import Logo from './components/Logo';
import SaleDialogHost from './components/SaleDialogHost';
import { App as CapacitorApp } from '@capacitor/app';
import { pushBackGuard } from './utils/useBackGuard';
import { useT } from './utils/i18n';
import { isNative } from './apiBase';
import { parseOidcReturn, takeVerifier } from './utils/nativeOidc';
import { isSealedMutation, VALUATION_CHANGED } from './utils/sealedMutation';

const Dashboard = lazy(() => import('./components/Dashboard'));
const AddCards = lazy(() => import('./components/AddCards'));
const CollectionList = lazy(() => import('./components/CollectionList'));
const LocationManager = lazy(() => import('./components/LocationManager'));
const Settings = lazy(() => import('./components/Settings'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));
const SetupWizard = lazy(() => import('./components/SetupWizard'));
const SharedCollection = lazy(() => import('./components/SharedCollection'));
const SharedContainer = lazy(() => import('./components/SharedContainer'));
const DeckBuilder = lazy(() => import('./components/DeckBuilder'));
const Notes = lazy(() => import('./components/Notes'));
const SealedInventory = lazy(() => import('./components/SealedInventory'));
const SalesHistory = lazy(() => import('./components/SalesHistory'));

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) { console.error('ErrorBoundary caught an error', error, errorInfo); }
  componentDidUpdate(prevProps) {
    if (prevProps.active && !this.props.active && this.state.hasError) this.setState({ hasError: false, error: null });
  }
  render() {
    if (this.state.hasError) {
      const t = this.props.t;
      return (
        <div style={{ padding: '2rem', color: 'var(--text-strong)', background: 'rgba(255,0,0,0.1)', border: '1px solid red', borderRadius: '8px', margin: '2rem' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', color: 'var(--accent-red)' }}>{t('error.crashed')}</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#ff8888', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '4px', fontSize: '0.85rem' }}>{this.state.error && this.state.error.toString()}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', marginTop: '1rem', color: 'var(--text-secondary)' }}>{this.state.error && this.state.error.stack}</pre>
          <button className="btn btn-primary" style={{ marginTop: '1.5rem' }} onClick={() => window.location.reload()}>{t('error.reload')}</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ChunkFallback() {
  const { t } = useT();
  return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '4rem', color: 'var(--text-secondary)' }}><div className="spinner" aria-label={t('common.loading')} /></div>;
}

// Preserve authentication handling and invalidate valuation only after a successful sealed write.
const originalFetch = window.fetch;
window.fetch = function (input, options = {}) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const isPublicOrAuthRoute = url.includes('/api/shared/') || url.includes('/api/auth/login') || url.includes('/api/auth/register') || url.includes('/api/auth/bootstrap') || url.includes('/api/auth/oidc/exchange');
  const token = localStorage.getItem('bindarr_token');
  const finalOptions = { ...options };
  if (token && url.startsWith('/api/') && !isPublicOrAuthRoute) {
    finalOptions.headers = { ...finalOptions.headers, 'Authorization': `Bearer ${token}` };
  }
  return originalFetch(input, finalOptions).then(response => {
    if (response.status === 401 && !isPublicOrAuthRoute) window.dispatchEvent(new Event('bindarr_logout'));
    if (response.ok && isSealedMutation(input, options, window.location.origin)) {
      window.dispatchEvent(new Event(VALUATION_CHANGED));
    }
    return response;
  });
};

const handledOidcReturns = new Set();
// Fired by the admin panel after instance settings are saved.
const SETTINGS_CHANGED = 'bindarr_settings_changed';

function App() {
  const { t } = useT();
  const [token, setToken] = useState(localStorage.getItem('bindarr_token'));
  const [user, setUser] = useState(() => {
    try { const u = localStorage.getItem('bindarr_user'); return u ? JSON.parse(u) : null; } catch { return null; }
  });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showSetup, setShowSetup] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState(null);
  const [focusEntryId, setFocusEntryId] = useState(null);
  const [selectedCardFilter, setSelectedCardFilter] = useState('');
  const [pendingCollectionSet, setPendingCollectionSet] = useState(null);
  const [toast, setToast] = useState(null);
  const [statsTrigger, setStatsTrigger] = useState(0);
  const [hiddenTabs, setHiddenTabs] = useState([]);

  useEffect(() => {
    const invalidate = () => setStatsTrigger(previous => previous + 1);
    window.addEventListener(VALUATION_CHANGED, invalidate);
    window.addEventListener('bindarr_sales_changed', invalidate);
    return () => { window.removeEventListener(VALUATION_CHANGED, invalidate); window.removeEventListener('bindarr_sales_changed', invalidate); };
  }, []);

  const tabGuardRef = useRef(null);
  // Previously opened tabs stay mounted to preserve their local state.
  const [mountedTabs, setMountedTabs] = useState([activeTab]);
  if (!mountedTabs.includes(activeTab)) setMountedTabs([...mountedTabs, activeTab]);
  const scrollByTabRef = useRef({});
  const shownTabRef = useRef(activeTab);
  const showTab = useCallback((tab) => {
    scrollByTabRef.current[shownTabRef.current] = window.scrollY;
    setActiveTab(tab);
  }, []);
  useEffect(() => { if (activeTab !== 'storage') setFocusEntryId(null); }, [activeTab]);
  const resetTabs = () => {
    setActiveTab('dashboard');
    setMountedTabs(['dashboard']);
    scrollByTabRef.current = {};
  };
  const goTab = useCallback((tab) => {
    if (tab === activeTab) return;
    const prev = activeTab;
    tabGuardRef.current = pushBackGuard(() => { tabGuardRef.current = null; showTab(prev); });
    showTab(tab);
  }, [activeTab, showTab]);
  const navigateToCollectionSet = useCallback((set) => {
    setPendingCollectionSet(set);
    goTab('collection');
  }, [goTab]);
  const clearPendingCollectionSet = useCallback(() => setPendingCollectionSet(null), []);
  useEffect(() => {
    const open = () => goTab('sales-history');
    window.addEventListener('bindarr_open_sales_history', open);
    return () => window.removeEventListener('bindarr_open_sales_history', open);
  }, [goTab]);
  const [shareToken] = useState(() => {
    const match = window.location.pathname.match(/^\/share\/([a-zA-Z0-9_-]+)$/);
    return match ? match[1] : null;
  });
  const [sharedContainerId] = useState(() => {
    const id = new URLSearchParams(window.location.search).get('container');
    return /^\d+$/.test(id || '') ? id : null;
  });
  const showToast = (message) => { setToast(message); };

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const oidcToken = params.get('oidc_token') || params.get('token');
      if (oidcToken && !token) {
        const newUrl = window.location.pathname + (window.location.hash || '');
        window.history.replaceState({}, document.title, newUrl);
        fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${oidcToken}` } })
          .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to fetch profile')))
          .then(data => {
            if (data.user) {
              setToken(oidcToken); setUser(data.user);
              localStorage.setItem('bindarr_token', oidcToken);
              localStorage.setItem('bindarr_user', JSON.stringify(data.user));
              showToast(t('toast.welcomeBack', { name: data.user.username }));
              setActiveTab('dashboard');
            }
          })
          .catch(err => { console.error('OIDC token verification failed:', err); showToast(t('login.errOidcFailed')); });
      }
    } catch { /* ignore URL parse error */ }
  }, [t, token]);

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    let listener = null;
    const handleUrl = (url) => {
      const ret = parseOidcReturn(url);
      if (!ret || handledOidcReturns.has(url)) return;
      handledOidcReturns.add(url);
      const verifier = takeVerifier();
      if (!verifier) return;
      if (ret.error) { showToast(ret.error); return; }
      fetch('/api/auth/oidc/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: ret.code, verifier }) })
        .then(res => res.json().then(data => (res.ok ? data : Promise.reject(new Error(data.error || 'exchange failed')))))
        .then(data => {
          if (!data.token || !data.user) return;
          setToken(data.token); setUser(data.user);
          localStorage.setItem('bindarr_token', data.token);
          localStorage.setItem('bindarr_user', JSON.stringify(data.user));
          showToast(t('toast.welcomeBack', { name: data.user.username }));
          setActiveTab('dashboard');
        })
        .catch(err => { console.error('OIDC native exchange failed:', err); showToast(t('login.errOidcFailed')); });
    };
    CapacitorApp.addListener('appUrlOpen', (event) => handleUrl(event.url))
      .then(handle => { if (cancelled) handle.remove(); else listener = handle; })
      .catch(err => console.error('appUrlOpen listener failed:', err));
    CapacitorApp.getLaunchUrl()
      .then(launch => { if (!cancelled && launch && launch.url) handleUrl(launch.url); })
      .catch(() => {});
    return () => { cancelled = true; if (listener) listener.remove(); };
  }, [t]);

  useEffect(() => {
    if (toast) { const timer = setTimeout(() => { setToast(null); }, 2500); return () => clearTimeout(timer); }
  }, [toast]);

  const navRef = useRef(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const header = nav.closest('.app-header');
    const fits = () => nav.scrollWidth <= nav.clientWidth + 1 && ![...nav.querySelectorAll('.nav-tab-label')].some(l => l.scrollWidth > l.clientWidth + 1);
    const steps = [[header, 'nav-tight'], [nav, 'nav-compact'], [header, 'nav-tighter']];
    const step = () => {
      for (const [el, cls] of steps) el?.classList.remove(cls);
      for (const [el, cls] of steps) { if (fits()) return; el?.classList.add(cls); }
    };
    const check = () => { nav.classList.add('nav-measuring'); step(); void nav.offsetWidth; nav.classList.remove('nav-measuring'); };
    check();
    window.addEventListener('resize', check);
    document.fonts?.ready.then(check).catch(() => {});
    return () => window.removeEventListener('resize', check);
  }, [token, user, activeTab, hiddenTabs, t]);

  useLayoutEffect(() => {
    shownTabRef.current = activeTab;
    window.scrollTo(0, scrollByTabRef.current[activeTab] || 0);
  }, [activeTab]);
  // Optional tabs an admin hid for the install. Only the nav buttons go away:
  // links from other views (for example "view in storage") still open them.
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    const load = () => fetch('/api/settings')
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && data) setHiddenTabs(Array.isArray(data.hidden_tabs) ? data.hidden_tabs : []); })
      .catch(() => {});
    load();
    window.addEventListener(SETTINGS_CHANGED, load);
    return () => { cancelled = true; window.removeEventListener(SETTINGS_CHANGED, load); };
  }, [token]);
  const tabShown = (tab) => !hiddenTabs.includes(tab) || activeTab === tab;

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    let cancelled = false;
    import('./components/SetupWizard').then(m => m.setupNeeded()).then(needed => { if (needed && !cancelled) setShowSetup(true); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user]);
  useEffect(() => {
    const handleAutoLogout = () => {
      setToken(null); setUser(null);
      localStorage.removeItem('bindarr_token'); localStorage.removeItem('bindarr_user');
      resetTabs(); showToast(t('toast.sessionExpired'));
    };
    window.addEventListener('bindarr_logout', handleAutoLogout);
    return () => window.removeEventListener('bindarr_logout', handleAutoLogout);
  }, [t]);
  useEffect(() => {
    const onMove = (e) => {
      const card = e.target.closest && e.target.closest('.tilt-card-wrapper');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--px', `${((e.clientX - r.left) / r.width) * 100}%`);
      card.style.setProperty('--py', `${((e.clientY - r.top) / r.height) * 100}%`);
      card.classList.add('foil-active');
    };
    const onLeave = (e) => { const card = e.target.closest && e.target.closest('.tilt-card-wrapper'); if (card) card.classList.remove('foil-active'); };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerout', onLeave, { passive: true });
    return () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerout', onLeave); };
  }, []);

  const handleLoginSuccess = (newToken, newUser) => {
    setToken(newToken); setUser(newUser);
    localStorage.setItem('bindarr_token', newToken); localStorage.setItem('bindarr_user', JSON.stringify(newUser));
    showToast(t('toast.welcomeBack', { name: newUser.username })); setActiveTab('dashboard');
  };
  const handleLogout = () => {
    fetch('/api/auth/logout', { method: 'POST' }).catch(err => console.error(err));
    setToken(null); setUser(null);
    localStorage.removeItem('bindarr_token'); localStorage.removeItem('bindarr_user');
    resetTabs(); showToast(t('toast.loggedOut'));
  };
  const handleUpdateUser = (updatedUser) => { setUser(updatedUser); localStorage.setItem('bindarr_user', JSON.stringify(updatedUser)); };
  const triggerRefresh = () => { setStatsTrigger(prev => prev + 1); };

  if (shareToken) return <Suspense fallback={<ChunkFallback />}>{sharedContainerId ? <SharedContainer shareToken={shareToken} containerId={sharedContainerId} /> : <SharedCollection shareToken={shareToken} />}</Suspense>;
  if (!token || !user) return <Login onLoginSuccess={handleLoginSuccess} />;

  const renderTab = (tab) => {
    switch (tab) {
      case 'dashboard': return <Dashboard statsTrigger={statsTrigger} onNavigate={goTab} onNavigateToSet={navigateToCollectionSet} setSelectedLocationId={setSelectedLocationId} setFocusEntryId={setFocusEntryId} onUpdate={triggerRefresh} showToast={showToast} />;
      case 'add-cards': return <AddCards active={activeTab === 'add-cards'} onAddSuccess={triggerRefresh} showToast={showToast} setActiveTab={goTab} />;
      case 'collection': return <CollectionList statsTrigger={statsTrigger} onUpdate={triggerRefresh} showToast={showToast} token={token} selectedCardFilter={selectedCardFilter} setSelectedCardFilter={setSelectedCardFilter} onNavigate={goTab} setSelectedLocationId={setSelectedLocationId} setFocusEntryId={setFocusEntryId} collectionSetNavigation={pendingCollectionSet} onSetNavigationHandled={clearPendingCollectionSet} />;
      case 'storage': return <LocationManager statsTrigger={statsTrigger} onUpdate={triggerRefresh} showToast={showToast} selectedLocationId={selectedLocationId} setSelectedLocationId={setSelectedLocationId} focusEntryId={focusEntryId} setFocusEntryId={setFocusEntryId} />;
      case 'deckbuilder': return <DeckBuilder showToast={showToast} />;
      case 'sealed': return <SealedInventory showToast={showToast} />;
      case 'sales-history': return <SalesHistory statsTrigger={statsTrigger} />;
      case 'notes': return <Notes showToast={showToast} />;
      case 'settings': return <Settings user={user} onUpdateUser={handleUpdateUser} showToast={showToast} />;
      case 'admin': return <AdminPanel user={user} onUpdateUser={handleUpdateUser} showToast={showToast} />;
      default: return <Dashboard statsTrigger={statsTrigger} onNavigate={goTab} setSelectedLocationId={setSelectedLocationId} setFocusEntryId={setFocusEntryId} onUpdate={triggerRefresh} showToast={showToast} />;
    }
  };

  return (
    <div className="app-container">
      {showSetup && <Suspense fallback={null}><SetupWizard user={user} onUpdateUser={handleUpdateUser} showToast={showToast} onClose={() => setShowSetup(false)} /></Suspense>}
      <header className="app-header">
        <div className="logo-section"><div className="logo-icon"><Logo /></div><h1 className="logo-text">Bind<span>arr</span></h1></div>
        <nav ref={navRef} className="nav-tabs" style={{ margin: 0 }}>
          <button className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => goTab('dashboard')} aria-label={t('nav.dashboard')} title={t('nav.dashboard')}><LayoutDashboard size={18} /><span className="nav-tab-label">{t('nav.dashboard')}</span></button>
          <button className={`nav-tab ${activeTab === 'add-cards' ? 'active' : ''}`} onClick={() => goTab('add-cards')} aria-label={t('nav.addCards')} title={t('nav.addCards')}><Plus size={18} /><span className="nav-tab-label">{t('nav.addCards')}</span></button>
          <button className={`nav-tab ${activeTab === 'collection' ? 'active' : ''}`} onClick={() => goTab('collection')} aria-label={t('nav.collection')} title={t('nav.collection')}><Database size={18} /><span className="nav-tab-label">{t('nav.collection')}</span></button>
          {tabShown('sealed') && <button className={`nav-tab ${activeTab === 'sealed' ? 'active' : ''}`} onClick={() => goTab('sealed')} aria-label={t('nav.sealed')} title={t('nav.sealed')}><Package size={18} /><span className="nav-tab-label">{t('nav.sealed')}</span></button>}
          {tabShown('sales-history') && <button className={`nav-tab ${activeTab === 'sales-history' ? 'active' : ''}`} onClick={() => goTab('sales-history')} aria-label={t('nav.salesHistory')} title={t('nav.salesHistory')}><Database size={18} /><span className="nav-tab-label">{t('nav.salesHistory')}</span></button>}
          {tabShown('storage') && <button className={`nav-tab ${activeTab === 'storage' ? 'active' : ''}`} onClick={() => goTab('storage')} aria-label={t('nav.storage')} title={t('nav.storage')}><MapPin size={18} /><span className="nav-tab-label">{t('nav.storage')}</span></button>}
          {tabShown('deckbuilder') && <button className={`nav-tab ${activeTab === 'deckbuilder' ? 'active' : ''}`} onClick={() => goTab('deckbuilder')} aria-label={t('nav.deckBuilder')} title={t('nav.deckBuilder')}><Swords size={18} /><span className="nav-tab-label">{t('nav.deckBuilder')}</span></button>}
          {tabShown('notes') && <button className={`nav-tab ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => goTab('notes')} aria-label={t('nav.notes')} title={t('nav.notes')}><StickyNote size={18} /><span className="nav-tab-label">{t('nav.notes')}</span></button>}
          <button className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => goTab('settings')} aria-label={t('nav.settings')} title={t('nav.settings')}><SettingsIcon size={18} /><span className="nav-tab-label">{t('nav.settings')}</span></button>
          {user.role === 'admin' && <button className={`nav-tab ${activeTab === 'admin' ? 'active' : ''}`} onClick={() => goTab('admin')} aria-label={t('nav.admin')} title={t('nav.admin')}><ShieldAlert size={18} style={{ color: 'var(--accent-red)' }} /><span className="nav-tab-label">{t('nav.admin')}</span></button>}
        </nav>
        <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="header-greeting" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}><Sparkles size={14} style={{ color: 'var(--accent-yellow)' }} /><span>{t('header.greeting')} <strong style={{ color: 'var(--text-strong)' }}>{user.username}</strong> ({t(`role.${user.role}`)})</span></div>
          <button onClick={handleLogout} className="btn btn-secondary btn-icon-only" title={t('header.logOut')} aria-label={t('header.logOut')} style={{ padding: '0.4rem 0.5rem', borderRadius: 'var(--radius-sm)' }}><LogOut size={14} /></button>
        </div>
      </header>
      <SaleDialogHost showToast={showToast} />
      <main style={{ flex: 1, marginTop: '1rem' }}>
        {mountedTabs.map(tab => <div key={tab} className={tab === activeTab ? 'tab-pane view-transition' : 'tab-pane tab-pane-hidden'}><ErrorBoundary active={tab === activeTab} t={t}><Suspense fallback={<ChunkFallback />}>{renderTab(tab)}</Suspense></ErrorBoundary></div>)}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
