from pathlib import Path
import hashlib

p = Path('backend/src/catalog.js')
original = p.read_bytes()
expected = '3761e6426c401e3f3f5a07af5639e42729d116ea'
actual = hashlib.sha1(b'blob ' + str(len(original)).encode() + b'\0' + original).hexdigest()
if actual != expected:
    raise SystemExit('catalog.js changed; refusing to overwrite it')
text = original.decode('utf-8')
old = '  if (!rows.length) return { built: 0, reused: 0, failed: 0, wrote: false };'
new = "  if (!rows.length) throw new Error('No eligible card artwork found for ' + job.game + '/' + job.lang + (scoped ? ' in selected sets: ' + job.sets.join(', ') : '') + '. No scan catalog was written. Synchronize card metadata and verify the language, set IDs and artwork coverage before retrying.');"
if text.count(old) != 1:
    raise SystemExit('Expected exactly one empty-artwork guard')
p.write_bytes(text.replace(old, new, 1).encode('utf-8'))
