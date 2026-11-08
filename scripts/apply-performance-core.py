from pathlib import Path
import hashlib
import importlib.util
import json
root = Path(__file__).resolve().parents[1]
updates = {}
def guarded(path, sha):
    raw = (root / path).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    if actual != sha:
        raise RuntimeError(f'{path} changed since review; refusing to patch')
    return raw.decode()
def once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError(f'Expected one match: {old}')
    return text.replace(old, new, 1)
path = 'backend/src/server.js'
if '// performance-core-start-v1' not in (root / path).read_text():
    text = guarded(path, 'b8c724d1f1292800823f5963435cc6f3be3829da')
    text = once(text, '    await scryfallApi.loadPriceSource();\n    dbReady = true;', "    await scryfallApi.loadPriceSource();\n    await require('./utils/investmentLedger').install(db);\n    require('./utils/dailyPerformance').start();\n    dbReady = true;")
    updates[path] = '// performance-core-start-v1\n' + text
path = 'backend/src/utils/currentPortfolio.js'
if '// performance-core-db-v1' not in (root / path).read_text():
    text = guarded(path, '243af411eca90ced782117e0945215e013a4d0ff')
    for old, new in [
        ('async function cardRows(userId, game)', 'async function cardRows(userId, game, database = db)'),
        ('return db.all(', 'return database.all('),
        ('async function sealedData(userId, game, valuation)', 'async function sealedData(userId, game, valuation, database = db)'),
        ('const lots = await db.all(', 'const lots = await database.all('),
        ('async function currentPortfolio(userId, game, valuation)', 'async function currentPortfolio(userId, game, valuation, database = db)'),
        ('await cardRows(userId, game);', 'await cardRows(userId, game, database);'),
        ('await sealedData(userId, game, valuation);', 'await sealedData(userId, game, valuation, database);'),
    ]:
        text = once(text, old, new)
    updates[path] = '// performance-core-db-v1\n' + text
spec = importlib.util.spec_from_file_location('performance_schema', root / 'scripts/performance-core/schema.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
updates['shared/investmentLedgerSchema.json'] = json.dumps(module.build(), indent=2) + '\n'
for source, target in [
    ('investmentLedger.js', 'backend/src/utils/investmentLedger.js'),
    ('dailyPerformance.js', 'backend/src/utils/dailyPerformance.js'),
    ('ledger_test.py', 'backend/test/investmentLedger.sql.test.py'),
    ('dailyPerformance.test.js', 'backend/test/dailyPerformance.test.js'),
]:
    updates[target] = (root / 'scripts/performance-core' / source).read_text()
for path, text in updates.items():
    destination = root / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(text)
