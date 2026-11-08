import { cloneElement, useEffect, useSyncExternalStore } from 'react';
import { subscribeCurrency, currencyRevision, ensureExchangeRates, getFxStatus } from '../utils/formatPrice';

export default function CurrencyDisplayRefresh({ children }) {
  const revision = useSyncExternalStore(subscribeCurrency, currencyRevision, () => 0);
  useEffect(() => {
    void ensureExchangeRates();
    const timer = setInterval(() => { void ensureExchangeRates(); }, 60000);
    const focus = () => { void ensureExchangeRates(); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, []);
  const status = getFxStatus();
  let authenticated = false;
  try { authenticated = !!localStorage.getItem('bindarr_token'); } catch { /* No browser storage. */ }
  return <>
    {authenticated && <div role="status" style={{ padding: '0.35rem 1rem', fontSize: '0.72rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>
      Card quote displays: {status.currency}. Source marketplace/currency labels describe the original quote.
      {' '}Price-history labels use current FX rates, not historical-date FX.
      {status.failed && ' Some exchange rates are unavailable; no missing conversion is counted as zero.'}
      {status.stale && ' Cached exchange rates are stale.'}
    </div>}
    {cloneElement(children, { currencyRevision: revision })}
  </>;
}
