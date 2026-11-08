import { useState } from 'react';
import { Camera, Search, Award } from 'lucide-react';
import CameraScanner from './CameraScanner';
import CardSearch from './CardSearch';
import SlabLookup from './SlabLookup';
import { useT } from '../utils/i18n';

// Keep search state while hidden, but never run a camera behind another tab.
function AddCards({ active = true, onAddSuccess, showToast, setActiveTab, initialMode = 'scan' }) {
  const { t } = useT();
  const [mode, setMode] = useState(initialMode);

  if (import.meta.env.VITE_DEMO) {
    return (
      <div className="glass-panel" style={{ maxWidth: '520px', margin: '2rem auto', padding: '2rem', textAlign: 'center' }}>
        <Camera size={40} style={{ color: 'var(--accent-yellow)', marginBottom: '1rem' }} />
        <h2 style={{ fontSize: '1.2rem', color: 'var(--text-strong)', marginBottom: '0.75rem' }}>{t('demo.unavailableTitle')}</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>{t('demo.unavailableBody')}</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', gap: '1rem', position: 'relative' }}>
        <div className="sub-nav-tabs" style={{ width: '100%', maxWidth: '400px', margin: 0 }}>
          <button className={`sub-nav-tab ${mode === 'scan' ? 'active' : ''}`} onClick={() => setMode('scan')}>
            <Camera size={18} /><span>{t('addCards.scan')}</span>
          </button>
          <button className={`sub-nav-tab ${mode === 'search' ? 'active' : ''}`} onClick={() => setMode('search')}>
            <Search size={18} /><span>{t('addCards.search')}</span>
          </button>
          <button className={`sub-nav-tab ${mode === 'slab' ? 'active' : ''}`} onClick={() => setMode('slab')}>
            <Award size={18} /><span>{t('addCards.slab')}</span>
          </button>
        </div>
      </div>
      <div>
        {mode === 'scan' && active && <CameraScanner onAddSuccess={onAddSuccess} showToast={showToast} setActiveTab={setActiveTab} />}
        {mode === 'search' && <CardSearch onAddSuccess={onAddSuccess} showToast={showToast} setActiveTab={setActiveTab} />}
        {mode === 'slab' && <SlabLookup onAddSuccess={onAddSuccess} showToast={showToast} />}
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
        Artwork fallback data: <a href="https://carddex.dev" target="_blank" rel="noopener noreferrer">Data by CardDex</a>. Coverage varies; automatic artwork repair is not connected yet.
      </p>
    </div>
  );
}

export default AddCards;
