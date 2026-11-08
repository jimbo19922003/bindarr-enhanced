import { cloneElement, useEffect, useSyncExternalStore } from 'react';
import { subscribeCurrency, currencyRevision, ensureExchangeRates } from '../utils/formatPrice';

export default function CurrencyDisplayRefresh({ children }) {
  const revision = useSyncExternalStore(subscribeCurrency, currencyRevision, () => 0);
  useEffect(() => {
    void ensureExchangeRates();
    const timer = setInterval(() => { void ensureExchangeRates(); }, 60000);
    const focus = () => { void ensureExchangeRates(); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, []);
  return cloneElement(children, { currencyRevision: revision });
}
