from pathlib import Path
import hashlib

CONSOLIDATION_MARKER = '// provider-keys-consolidated-v1'

def once(text,old,new):
    if text.count(old)!=1: raise SystemExit('Provider-key integration point changed')
    return text.replace(old,new,1)
def guarded(name,expected,marker,change):
    raw=Path(name).read_bytes()
    text=raw.decode()
    if CONSOLIDATION_MARKER in text: return text
    if marker in text: return text
    actual=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    if actual!=expected: raise SystemExit(name+': source changed; refusing overwrite')
    return change(text)
def frontend(text):
    text=once(text,"import { REPO_URL } from '../utils/repo';","import { REPO_URL } from '../utils/repo';\nimport { saveProviderKeys } from '../utils/saveProviderKeys.mjs';")
    position=text.index("    fetch('/api/settings/pokewallet')")
    start=text.rfind('  useEffect(() => {',0,position)
    end=text.index('  }, [user?.role]);',position)+len('  }, [user?.role]);')
    text=text[:start]+"""  useEffect(() => {
    if (user?.role !== 'admin') return undefined;
    let cancelled = false;
    fetch('/api/settings/provider-keys/pokewallet', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(() => { if (!cancelled) setPokewalletKeyLoaded(true); })
      .catch(() => { if (!cancelled) setPokewalletKeyLoaded(true); });
    return () => { cancelled = true; };
  }, [user?.role]);"""+text[end:]
    start=text.index('  // All three provider keys in one PUT.')
    end=text.index('  // Create/rotate/revoke the read-only API key.',start)
    text=text[:start]+"""  // provider-key-save-v2: the emergency instance key is independent of personal settings.
  const handleSaveKeys = async (e) => {
    e.preventDefault();
    setKeysLoading(true);
    try {
      const result = await saveProviderKeys({
        isAdmin: user?.role === 'admin',
        pokewalletKey,
        personal: { tcg_api_key: tcgApiKey, psa_api_token: psaToken, graded_price_api_key: gradedKey },
        previous: user || {},
      });
      if (result.user) onUpdateUser(result.user);
      if (result.pokewalletSaved) {
        setPokewalletKey('');
        if (!pokewalletKeyLoaded) setPokewalletKeyLoaded(true);
      }
      showToast(result.pokewalletSaved
        ? 'PokéWallet emergency backup key saved and database persistence verified.'
        : result.personalSaved ? t('settings.keysUpdated') : 'No API key changes to save.');
    } catch (error) {
      if (error.pokewalletSaved) { setPokewalletKey(''); setPokewalletKeyLoaded(true); }
      showToast(error.message || t('settings.errKeys'));
    } finally {
      setKeysLoading(false);
    }
  };

"""+text[end:]
    return text
front='frontend/src/components/Settings.jsx'
back='backend/src/routes/settings.js'
front_text=guarded(front,'193b4926eb5fb13bd27e81733fc954fbb8d7fd27','// provider-key-save-v2:',frontend)
back_marker="router.use('/provider-keys', require('./providerKeys').createProviderKeysRouter({"
back_text=guarded(back,'26c5dafd322461e15cd8cb47cdb314a33200ac03',back_marker,lambda text:once(text,'const router = express.Router();',"const router = express.Router();\n\nrouter.use('/provider-keys', require('./providerKeys').createProviderKeysRouter({\n  connect: () => require('../utils/salesRepository').openConnection(db.dbPath),\n}));"))
for name,text in [(front,front_text),(back,back_text)]: Path(name).write_bytes(text.encode())
