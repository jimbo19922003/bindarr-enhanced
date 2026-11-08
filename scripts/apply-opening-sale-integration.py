from pathlib import Path
p = Path('backend/src/utils/salesRepository.js')
s = p.read_text()
marker = '// opening-sale-integration-v1\n'
if s.startswith(marker):
    assert 'createOpeningLot(userId, collectionId)' in s and 'saleId: prior.id' in s
    raise SystemExit(0)
def once(old, new):
    global s
    if s.count(old) != 1:
        raise RuntimeError('Accounting source changed: ' + old[:80])
    s = s.replace(old, new, 1)
once("const { calculateSale } = require('./costBasis');", "const { calculateSale } = require('./costBasis');\nconst openingIntegration = require('./salesOpeningIntegration');")
once("source IN ('direct','unknown')", "source IN ('direct','unknown','opening')")
once("(source = 'direct' AND original_basis_cents", "(source IN ('direct','opening') AND original_basis_cents")
once('      await db.exec(schema);', '      await openingIntegration.prepareSchema(db, schema);')
once("    createLot(userId, { collectionId, source = 'unknown', basisCents = null }) {", "    createOpeningLot(userId, collectionId) {\n      return transaction(userId, db => openingIntegration.createOpeningLot(db, userId, collectionId));\n    },\n    createLot(userId, { collectionId, source = 'unknown', basisCents = null }) {")
once("        positive(entry.quantity, 'owned quantity');", "        positive(entry.quantity, 'owned quantity');\n        await openingIntegration.rejectFrozenCopy(db, collectionId);")
once('SELECT request_json, result_json FROM card_sale_record', 'SELECT id, request_json, result_json FROM card_sale_record')
once('return JSON.parse(prior.result_json);', 'return { ...JSON.parse(prior.result_json), saleId: prior.id };')
once('module.exports = { createSalesRepository, openConnection };', 'module.exports = { createSalesRepository, openConnection, schema };')
p.write_text(marker + s)
