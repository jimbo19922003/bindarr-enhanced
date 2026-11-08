from pathlib import Path
import hashlib

p=Path('backend/src/routes/collection.js')
original=p.read_bytes()
digest=hashlib.sha1(b'blob '+str(len(original)).encode()+b'\0'+original).hexdigest()
if digest!='29b51e7ea02043c6593ebaa613eb570e17709c03':
    raise SystemExit('collection.js changed; refusing to overwrite it')
text=original.decode('utf-8')
def once(text,old,new):
    if text.count(old)!=1: raise SystemExit('Expected exactly one local search integration point')
    return text.replace(old,new,1)
text=once(text,"async function pokemonApiFor(lang) {\n  return pokemonProvider.apiFor(lang);\n}","async function pokemonApiFor(lang) {\n  if (process.env.POKEMON_LOCAL_CATALOG === '1') return require('../utils/localPokemonSearch').getLocalPokemonSearch();\n  return pokemonProvider.apiFor(lang);\n}")
start=text.index("router.all('/search', searchLimiter")
end=text.index('// 1a2. Identify a graded slab',start)
block=text[start:end]
block=once(block,"if (game === 'pokemon' && !image) {","if (game === 'pokemon' && !image && !api.localOnly) {")
block=once(block,"    if (error.message === 'UPSTREAM_UNAVAILABLE') {","    if (error.code === 'LOCAL_CATALOG_SYNC_REQUIRED') return res.status(503).json({ error: 'Synchronize the local Pokemon catalog for this language before searching.', code: error.code, language: error.language });\n    if (error.code === 'INVALID_LOCAL_CATALOG_QUERY') return res.status(400).json({ error: 'Invalid local catalog query', code: error.code });\n    if (error.message === 'UPSTREAM_UNAVAILABLE') {")
text=text[:start]+block+text[end:]
p.write_bytes(text.encode('utf-8'))
