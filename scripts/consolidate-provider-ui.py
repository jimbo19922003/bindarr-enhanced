"""One-time, source-hash-guarded UI migration; never accesses runtime data."""
from pathlib import Path
import hashlib

MARKER = '// provider-keys-consolidated-v1'
EXPECTED = {
 'frontend/src/components/AdminPanel.jsx': ('sha256', 'b7f0802a8d36a0dc9621196cb5e1592c14badc677ec89920d584ad81af4c7844'),
 'frontend/src/components/Settings.jsx': ('sha256', '7ab2feef0bd79703d43c8246113654fd26cdb4ce6437cf2094080808dbdef2eb'),
 'frontend/src/components/LocalCatalogStatusPanel.jsx': ('git', 'ee39a3cc2f1da101dd873b9daee91473df02e3ca'),
 'frontend/src/components/SetupProviderKeys.jsx': ('git', 'b5e7d5451045c693ec831fcf0628ee7211e99b03'),
}
def once(text, old, new=''):
 if text.count(old) != 1:
  raise SystemExit('Expected exactly one reviewed integration point: ' + old[:90])
 return text.replace(old, new, 1)
def between(text, start, end, replacement):
 if text.count(start) != 1 or text.count(end) != 1:
  raise SystemExit('Reviewed section boundaries changed')
 a=text.index(start); b=text.index(end,a)
 return text[:a]+replacement+text[b:]
def main():
 names=list(EXPECTED)
 current={name:Path(name).read_text(encoding='utf-8') for name in names}
 if all(MARKER in text for text in current.values()):
  return
 if any(MARKER in text for text in current.values()):
  raise SystemExit('Partial migration detected; refusing to rewrite')
 for name,(kind,expected) in EXPECTED.items():
  raw=Path(name).read_bytes()
  actual=hashlib.sha256(raw).hexdigest() if kind=='sha256' else hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
  if actual!=expected:
   raise SystemExit(name+': source changed since inspection; refusing to overwrite')
 admin=current[names[0]]
 admin=once(admin,"import SetupWizard from './SetupWizard';","import SetupWizard from './SetupWizard';\nimport ProviderKeysPanel from './ProviderKeysPanel';")
 admin=once(admin,', Sparkles, Eye, EyeOff }',', Sparkles }')
 for line in ["  const [pokewalletKey, setPokewalletKey] = useState('');\n","  const [pokewalletKeyLoaded, setPokewalletKeyLoaded] = useState(false);\n","  const [showPokewalletKey, setShowPokewalletKey] = useState(false);\n","      setPokewalletKey(data.api_key || '');\n","      setPokewalletKeyLoaded(true);\n","          ...(pokewalletKeyLoaded ? { pokewallet_api_key: pokewalletKey } : {}),\n"]:
  admin=once(admin,line)
 label='              <label htmlFor="admin-pokewallet-key">'
 if admin.count(label)!=1: raise SystemExit('Provider key field changed')
 start=admin.rfind('            <div className="form-group"',0,admin.index(label))
 end=admin.index('            {/* Which marketplace Magic prices',start)
 if start<0: raise SystemExit('Key field boundary missing')
 admin=admin[:start]+admin[end:]
 admin=once(admin,'        {/* Instance Settings Panel */}', '        <ProviderKeysPanel user={user} onUpdateUser={onUpdateUser} />\n\n        {/* Instance Settings Panel */}')
 settings=current[names[1]]
 settings=once(settings,"import { saveProviderKeys } from '../utils/saveProviderKeys.mjs';\n")
 for line in ["  const [tcgApiKey, setTcgApiKey] = useState(user?.tcg_api_key || '');\n","  const [pokewalletKey, setPokewalletKey] = useState('');\n","  const [pokewalletKeyLoaded, setPokewalletKeyLoaded] = useState(false);\n","      setTcgApiKey(user.tcg_api_key || '');\n"]:
  settings=once(settings,line)
 effect_start="  useEffect(() => {\n    if (user?.role !== 'admin') return undefined;"
 a=settings.index(effect_start); end="  }, [user?.role]);\n"; b=settings.index(end,a)+len(end)
 settings=settings[:a]+settings[b:]
 replacement="""  const handleSaveKeys = async (e) => {
    e.preventDefault();
    if (user?.role === 'admin') return;
    const personal = {};
    if (psaToken !== (user?.psa_api_token || '')) personal.psa_api_token = psaToken;
    if (gradedKey !== (user?.graded_price_api_key || '')) personal.graded_price_api_key = gradedKey;
    if (!Object.keys(personal).length) return showToast('No personal credential changes to save.');
    setKeysLoading(true);
    try {
      const response = await fetch('/api/auth/settings', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(personal)});
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (result.user) onUpdateUser(result.user);
      showToast(t('settings.keysUpdated'));
    } catch { showToast(t('settings.errKeys')); }
    finally { setKeysLoading(false); }
  };

"""
 settings=between(settings,'  // provider-key-save-v2:', '  // Create/rotate/revoke', replacement)
 start='          <form onSubmit={handleSaveKeys}'
 a=settings.index(start); b=settings.index('          </form>',a)+len('          </form>')
 form="""          {user?.role === 'admin' ? <p>Manage external-provider keys in Admin → API keys. Your generated Bindarr access key below remains account-specific.</p> : (
            <form onSubmit={handleSaveKeys} style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
              <KeyField id="settings-psa-token" label={t('settings.psaTokenTitle')} hint={t('settings.psaTokenIntro')} link="https://www.psacard.com/publicapi/documentation" linkLabel={t('settings.psaTokenGetOne')} value={psaToken} onChange={setPsaToken} disabled={keysLoading} t={t} />
              <KeyField id="settings-graded-key" label={t('settings.gradedKeyTitle')} hint={t('settings.gradedKeyIntro')} link="https://www.pokemonpricetracker.com/api" linkLabel={t('settings.gradedKeyGetOne')} value={gradedKey} onChange={setGradedKey} disabled={keysLoading} t={t} />
              <button type="submit" className="btn btn-primary" disabled={keysLoading}>{t('settings.saveKeys')}</button>
            </form>
          )}"""
 settings=settings[:a]+form+settings[b:]
 local=current[names[2]]
 local=once(local,"import CarddexKeyPanel from './CarddexKeyPanel';\n")
 local=once(local,'  const [credentialsOpen, setCredentialsOpen] = useState(false);\n')
 start='    <details onToggle={event => setCredentialsOpen'
 a=local.index(start); b=local.index('    </details>',a)+len('    </details>')
 local=local[:a]+'    <p>Provider credentials: Admin → API keys.</p>'+local[b:]
 setup="""import { useState } from 'react';
export default function SetupProviderKeys({user,onUpdateUser,showToast}) {
 const [psa,setPsa]=useState(''),[graded,setGraded]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function save(){const body={};if(psa.trim())body.psa_api_token=psa.trim();if(graded.trim())body.graded_price_api_key=graded.trim();if(!Object.keys(body).length)return;setBusy(true);try{const response=await fetch('/api/auth/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error();const result=await response.json();onUpdateUser?.(result.user);setPsa('');setGraded('');setMessage('Personal credentials saved.');showToast?.('Personal credentials saved.');}catch{setMessage('Could not save personal credentials.');}finally{setBusy(false);}}
 if(user?.role==='admin')return <section><h3>API keys</h3><p>Configure CardDex, PokéWallet and your personal service credentials in Admin → API keys after closing setup. Setup does not replace or clear stored keys.</p></section>;
 return <section><h3>Personal service credentials</h3><p>Instance-wide provider keys are managed by an administrator. Blank fields keep existing personal values.</p><label htmlFor="setup-psa-token">PSA token</label><input id="setup-psa-token" type="password" className="input-control" autoComplete="off" value={psa} onChange={event=>setPsa(event.target.value)} disabled={busy} /><label htmlFor="setup-graded-key">Graded-price key</label><input id="setup-graded-key" type="password" className="input-control" autoComplete="off" value={graded} onChange={event=>setGraded(event.target.value)} disabled={busy} /><button type="button" className="btn btn-primary" onClick={save} disabled={busy||!psa.trim()&&!graded.trim()}>Save personal credentials</button>{message&&<p role="status">{message}</p>}</section>;
}
"""
 outputs={names[0]:admin,names[1]:settings,names[2]:local,names[3]:setup}
 for text in (admin,settings):
  if 'pokewalletKey' in text or 'pokewallet_api_key' in text or 'settings-tcg-api-key' in text:
   raise SystemExit('Legacy editable key path remains')
 for name,text in outputs.items():
  Path(name).write_text(MARKER+'\n'+text,encoding='utf-8')
 overview=Path('frontend/test/localCatalogOverview.test.mjs')
 text=overview.read_text(encoding='utf-8')
 for assertion in [r'assert.match(source,/credentialsOpen, setCredentialsOpen\] = useState\(false\)/);',r'assert.match(source,/credentialsOpen && <CarddexKeyPanel/);']:
  text=once(text,assertion)
 overview.write_text(text,encoding='utf-8')
if __name__=='__main__':
 main()
