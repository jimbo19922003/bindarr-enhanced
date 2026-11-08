import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useT } from '../utils/i18n';

export default function SetupProviderKeys({ user, onUpdateUser, showToast }) {
  const { t } = useT();
  const admin = user?.role === 'admin';
  const [pokewalletKey, setPokewalletKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [keySource, setKeySource] = useState('none');
  const [statusError, setStatusError] = useState(false);
  const [psaToken, setPsaToken] = useState(user?.psa_api_token || '');
  const [gradedKey, setGradedKey] = useState(user?.graded_price_api_key || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!admin) return undefined;
    let cancelled = false;
    fetch('/api/settings/pokewallet', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('status');
        return response.json();
      })
      .then(data => {
        if (cancelled) return;
        setConfigured(!!data.configured);
        setKeySource(data.key_source || 'none');
        setStatusError(false);
      })
      .catch(() => { if (!cancelled) setStatusError(true); });
    return () => { cancelled = true; };
  }, [admin]);

  const save = async () => {
    const key = pokewalletKey.trim();
    setError('');
    if (admin && key && (key.length > 256 || /\s/.test(key))) {
      setError('PokéWallet API key must be a single token, at most 256 characters.');
      return;
    }
    setSaving(true);
    let personalSaved = false;
    try {
      const personal = await fetch('/api/auth/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ psa_api_token: psaToken, graded_price_api_key: gradedKey }),
      });
      const data = await personal.json().catch(() => ({}));
      if (!personal.ok) throw new Error(data.error || t('setup.keys.errSave'));
      personalSaved = true;
      onUpdateUser?.(data.user);
      // A blank field never clears a saved or environment-provided instance key.
      if (admin && key) {
        const response = await fetch('/api/settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pokewallet_api_key: key }),
        });
        if (!response.ok) throw new Error('PokéWallet key could not be saved. Please retry.');
        setConfigured(true);
        setKeySource('database');
        setStatusError(false);
        setPokewalletKey('');
      }
      showToast?.(t('setup.keys.saved'));
    } catch (failure) {
      const message = personalSaved
        ? 'Personal API keys were saved, but the PokéWallet key was not saved. Please retry.'
        : failure.message;
      setError(message);
      showToast?.(message);
    } finally { setSaving(false); }
  };

  const hint = { fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0.2rem 0 0.35rem' };
  const input = { width: '100%', padding: '0.45rem 0.6rem', fontSize: '0.78rem', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-sm)', color: 'var(--text-strong)' };
  const label = { fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-strong)' };
  const link = { color: 'var(--accent-red)', textDecoration: 'underline' };

  return (
    <>
      <div>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '1.05rem' }}>
          <KeyRound size={18} /> {t('setup.keys.title')}
        </h3>
        <p style={hint}>{t('setup.keys.sub')}</p>
      </div>
      {admin ? (
        <div>
          <label htmlFor="setup-pokewallet-key" style={label}>PokéWallet API key</label>
          <p id="setup-pokewallet-help" style={hint}>
            Optional instance-wide key for Pokémon pricing and sealed-product lookups.
            {' '}<a href="https://pokewallet.io/" target="_blank" rel="noopener noreferrer" style={link}>Get a PokéWallet key</a>
            {' '}Leave blank to keep the existing configuration.
          </p>
          <input id="setup-pokewallet-key" type="password" autoComplete="off" spellCheck={false}
            value={pokewalletKey} onChange={event => setPokewalletKey(event.target.value)}
            disabled={saving} maxLength={256} style={input} aria-describedby="setup-pokewallet-help"
            placeholder={configured ? 'Already configured — enter a new key to replace' : t('setup.keys.pasteKey')} />
          <p role="status" style={hint}>
            {statusError ? 'Could not read current key status. A blank field will still leave it unchanged.'
              : configured ? `Key configured (${keySource === 'environment' ? 'server environment' : 'saved instance setting'}).`
                : 'No PokéWallet key configured.'}
          </p>
        </div>
      ) : <p style={hint}>An administrator can configure the instance-wide PokéWallet key in Settings.</p>}
      <div>
        <label htmlFor="setup-psa-token" style={label}>{t('setup.keys.psaTitle')}</label>
        <p style={hint}>{t('setup.keys.psaBody')}{' '}
          <a href="https://www.psacard.com/publicapi/documentation" target="_blank" rel="noopener noreferrer" style={link}>psacard.com</a>
        </p>
        <input id="setup-psa-token" type="password" autoComplete="off" value={psaToken}
          onChange={event => setPsaToken(event.target.value)} disabled={saving} style={input} placeholder={t('setup.keys.pasteToken')} />
      </div>
      <div>
        <label htmlFor="setup-graded-key" style={label}>{t('setup.keys.gradedTitle')}</label>
        <p style={hint}>{t('setup.keys.gradedBody')}{' '}
          <a href="https://www.pokemonpricetracker.com/" target="_blank" rel="noopener noreferrer" style={link}>pokemonpricetracker.com</a>
        </p>
        <input id="setup-graded-key" type="password" autoComplete="off" value={gradedKey}
          onChange={event => setGradedKey(event.target.value)} disabled={saving} style={input} placeholder={t('setup.keys.pasteKey')} />
      </div>
      {error && <p role="alert" style={{ ...hint, color: '#f87171' }}>{error}</p>}
      <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving} style={{ alignSelf: 'flex-start' }}>
        {saving ? t('setup.keys.saving') : t('setup.keys.save')}
      </button>
    </>
  );
}
