import { useCallback, useEffect, useState } from 'react';
import { useT } from '../../utils/i18n';
import { CURRENCIES } from '../../utils/formatPrice';
import { tradeApi } from '../../utils/tradeApi';

export default function TradeSettings({ origin, user, showToast }) {
  const { t } = useT();
  const [settings, setSettings] = useState(null);
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [webhook, setWebhook] = useState('');
  const [removeWebhook, setRemoveWebhook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async signal => {
    const config = await tradeApi('/api/trade/settings', { signal });
    setSettings(config); setSavedEnabled(config.enabled);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [load]);

  const act = async work => {
    setBusy(true); setError('');
    try { await work(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const save = event => {
    event.preventDefault();
    act(async () => {
      const config = await tradeApi('/api/trade/settings', { method: 'PUT', body: {
        enabled: settings.enabled, currency: settings.currency,
        ...(removeWebhook ? { discord_webhook: '' } : webhook.trim() ? { discord_webhook: webhook.trim() } : {}),
      } });
      setSettings(config); setSavedEnabled(config.enabled);
      setWebhook(''); setRemoveWebhook(false); showToast(t('trade.saved'));
    });
  };
  const copy = async (value, message) => {
    try { await navigator.clipboard.writeText(value); showToast(message); }
    catch { showToast(t('settings.errCopy')); }
  };
  const url = settings ? `${origin}/trade/${settings.token}` : '';
  const legacyEnabled = user?.share_enabled === 1 || user?.share_enabled === true;
  const legacyUrl = `${origin}/share/${user?.share_token}?list=trade`;

  return <div className="trades-grid">
    <section className="glass-panel trade-settings">
      <h3>{t('trade.settingsTitle')}</h3>
      <p>{t('trades.settings.masterHint')}</p>
      <p className="trade-muted">{t('trade.separateHint')}</p>
      {error && <p role="alert">{error}</p>}
      {!settings ? <p role="status">{t('common.loading')}</p> : <>
        <form onSubmit={save} className="trade-config">
          <label><input type="checkbox" checked={settings.enabled} disabled={busy}
            onChange={event => setSettings(previous => ({ ...previous, enabled: event.target.checked }))} /> {t('trades.settings.enableMaster')}</label>
          <label>{t('trade.currency')}
            <select value={settings.currency} disabled={busy} onChange={event => setSettings(previous => ({ ...previous, currency: event.target.value }))}>
              {CURRENCIES.map(currency => <option key={currency.code} value={currency.code}>{currency.label}</option>)}
            </select>
          </label>
          <p className="trade-muted">{t('trades.settings.sharedHint')}</p>
          <label>{t('trade.webhook')}
            <input type="password" autoComplete="new-password" value={webhook} maxLength={400} disabled={busy || removeWebhook}
              onChange={event => setWebhook(event.target.value)} />
          </label>
          <p className="trade-muted">{t(settings.webhook_configured ? 'trade.webhookConfigured' : 'trade.webhookHint')}</p>
          {settings.webhook_configured && <label><input type="checkbox" checked={removeWebhook} disabled={busy}
            onChange={event => setRemoveWebhook(event.target.checked)} /> {t('trade.removeWebhook')}</label>}
          <button className="btn btn-primary" disabled={busy}>{t('common.save')}</button>
        </form>
        <p role="status">{t(savedEnabled ? 'trade.sharingActive' : 'trade.sharingInactive')}</p>
        {settings.enabled !== savedEnabled && <p role="status">{t('trade.saveEnableChange')}</p>}
        {savedEnabled && <label>{t('trade.link')}<input readOnly value={url} onFocus={event => event.target.select()} /></label>}
        <div className="trade-actions">
          <button type="button" className="btn btn-secondary" disabled={busy || !savedEnabled} onClick={() => copy(url, t('trade.copied'))}>{t('trade.copy')}</button>
          {savedEnabled && <a className="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer">{t('trade.preview')}</a>}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => {
            if (window.confirm(t('trade.rotateConfirm'))) act(async () => {
              const config = await tradeApi('/api/trade/rotate', { method: 'POST' });
              setSettings(config); setSavedEnabled(config.enabled); showToast(t('trade.rotated'));
            });
          }}>{t('trade.rotate')}</button>
        </div>
      </>}
    </section>
    <section className="glass-panel trade-settings">
      <h3>{t('trades.settings.legacyTitle')}</h3>
      <p className="trade-muted">{t('trades.settings.legacyHint')}</p>
      {legacyEnabled ? <>
        <label>{t('settings.linkTrade')}<input readOnly value={legacyUrl} onFocus={event => event.target.select()} /></label>
        <div className="trade-actions">
          <button type="button" className="btn btn-secondary" onClick={() => copy(legacyUrl, t('settings.copied.trade'))}>{t('trade.copy')}</button>
        </div>
      </> : <p>{t('trades.settings.legacyDisabled')}</p>}
    </section>
  </div>;
}
