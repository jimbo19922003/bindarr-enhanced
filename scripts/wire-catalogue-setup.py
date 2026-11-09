from pathlib import Path
import hashlib
EXPECTED={'frontend/src/components/SetupWizard.jsx':'eebde769ed754313c7f9e8c171d55822227d5bbc','frontend/src/components/LocalCatalogStatusPanel.jsx':'bed8e5a6ede60c7434ed409fec560b045624bfd5','backend/src/routes/localCatalogStatus.js':'524b5e21605ccbe2c3c6b24918e38d013b6d924c'}
MARKER='// catalogue-setup-installed-v1'
def once(text,old,new):
 if text.count(old)!=1:raise SystemExit('Reviewed setup integration point changed: '+old[:100])
 return text.replace(old,new,1)
def main():
 texts={name:Path(name).read_text() for name in EXPECTED}
 if all(MARKER in text for text in texts.values()):return
 for name in texts:
  raw=Path(name).read_bytes()
  if hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()!=EXPECTED[name]:raise SystemExit(name+': source changed; refusing to overwrite')
 name='frontend/src/components/SetupWizard.jsx';wizard=texts[name]
 wizard=once(wizard,"import SetupProviderKeys from './SetupProviderKeys';","import SetupProviderKeys from './SetupProviderKeys';\nimport SetupCardCatalogue from './SetupCardCatalogue';")
 wizard=once(wizard,"['language', 'cards', 'scanning', 'keys', 'storage', 'tour']","['language', 'cards', 'catalogue', 'scanning', 'keys', 'storage', 'tour']")
 wizard=once(wizard,'[language, cardsStep, scanning, null, storage, tour][step]','[language, cardsStep, null, scanning, null, storage, tour][step]')
 wizard=once(wizard,'        {content}\n',"        {content}\n        <SetupCardCatalogue active={step === STEPS.indexOf('catalogue')} />\n")
 wizard=once(wizard,'step !== 3',"step !== STEPS.indexOf('keys')")
 wizard=once(wizard,'step === 3',"step === STEPS.indexOf('keys')")
 wizard=once(wizard,'t(`setup.step.${s}`)',"s === 'catalogue' ? 'Card catalogue' : t(`setup.step.${s}`)")
 wizard=once(wizard,'t(`setup.step.${STEPS[step]}`)',"STEPS[step] === 'catalogue' ? 'Card catalogue' : t(`setup.step.${STEPS[step]}`)")
 texts[name]=wizard
 name='frontend/src/components/LocalCatalogStatusPanel.jsx';local=texts[name]
 local="import SetupCardCatalogue from './SetupCardCatalogue';\n"+local
 local=once(local,'    <h3 style={{marginTop:0}}>Pokémon catalogue</h3>','    <h3 style={{marginTop:0}}>Pokémon catalogue</h3>\n    <SetupCardCatalogue />')
 texts[name]=local
 name='backend/src/routes/localCatalogStatus.js';route=texts[name]
 line="  router.use('/install', require('./localCatalogInstall').createLocalCatalogInstallRouter({connect}));"
 route=once(route,line,line+"\n  router.use('/setup', require('./catalogueSetup').createRouter({connect}));")
 texts[name]=route
 for name,text in texts.items():Path(name).write_text(MARKER+'\n'+text)
if __name__=='__main__':main()
