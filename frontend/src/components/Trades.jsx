import { useEffect, useState } from 'react';
import { Inbox, BookOpen, History, Settings as SettingsIcon } from 'lucide-react';
import { useT } from '../utils/i18n';
import { tradeApi, TRADES_CHANGED } from '../utils/tradeApi';
import TradeInbox from './trades/TradeInbox';
import TradeBinders from './trades/TradeBinders';
import TradeHistory from './trades/TradeHistory';
import TradeSettings from './trades/TradeSettings';
import './TradePortal.css';
import './Trades.css';

const VIEWS = [
  { id: 'inbox', icon: Inbox, label: 'trades.tab.inbox' },
  { id: 'binders', icon: BookOpen, label: 'trades.tab.binders' },
  { id: 'history', icon: History, label: 'trades.tab.history' },
  { id: 'settings', icon: SettingsIcon, label: 'trades.tab.settings' },
];

export default function Trades({ user, showToast, onUpdate }) {
  const { t } = useT();
  const [view, setView] = useState('inbox');
  const [origin, setOrigin] = useState(`${window.location.protocol}//${window.location.host}`);
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/settings', { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data?.public_base_url) setOrigin(data.public_base_url.replace(/\/$/, '')); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => tradeApi('/api/trade/requests/counts', { signal: controller.signal })
      .then(counts => setNewCount(counts.new || 0)).catch(() => {});
    load();
    window.addEventListener(TRADES_CHANGED, load);
    return () => { controller.abort(); window.removeEventListener(TRADES_CHANGED, load); };
  }, []);

  return <div className="trades-hub">
    <div className="glass-panel trades-header">
      <div>
        <h2>{t('trades.title')}</h2>
        <p className="trade-muted">{t('trades.subtitle')}</p>
      </div>
      <div className="sub-nav-tabs trades-tabs" role="tablist">
        {VIEWS.map(({ id, icon: Icon, label }) => <button key={id} type="button" role="tab" aria-selected={view === id}
          className={`sub-nav-tab ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>
          <Icon size={15} /> {t(label)}
          {id === 'inbox' && newCount > 0 && <span className="tab-count-badge has-unsorted">{newCount}</span>}
        </button>)}
      </div>
    </div>
    {view === 'inbox' && <TradeInbox showToast={showToast} onUpdate={onUpdate} />}
    {view === 'binders' && <TradeBinders origin={origin} showToast={showToast} />}
    {view === 'history' && <TradeHistory />}
    {view === 'settings' && <TradeSettings origin={origin} user={user} showToast={showToast} />}
  </div>;
}
