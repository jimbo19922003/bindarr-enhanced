from pathlib import Path
marker='// sales-inventory-protection-v1\n'
def patch(path,edits):
    p=Path(path);s=p.read_text()
    if s.startswith(marker):return p,s
    for old,new in edits:
        if s.count(old)!=1:raise RuntimeError('Source anchor changed in '+path+': '+old[:80])
        s=s.replace(old,new,1)
    return p,marker+s
changes=[]
changes.append(patch('backend/src/utils/salesRepository.js',[("      await openingIntegration.prepareSchema(db, schema);","      await openingIntegration.prepareSchema(db, schema);\n      await require('./salesInventoryProtection').install(db);")]))
changes.append(patch('backend/src/utils/sealedSalesRepository.js',[("        await db.run('BEGIN IMMEDIATE');began=true;await db.exec(schema);","        await db.run('BEGIN IMMEDIATE');began=true;await db.exec(schema);\n        await require('./salesInventoryProtection').install(db);")]))
changes.append(patch('backend/src/routes/sealed.js',[("    const body = req.body || {};\n    const opened = await db.get(","    const body = req.body || {};\n    const salesProtection = require('../utils/salesInventoryProtection');\n    const hasSales = await salesProtection.hasSealedSales(db, existing.id, req.user.id);\n    if (hasSales) salesProtection.validateSealedLotEdit(existing, body, sealed.moneyToCents);\n    const opened = await db.get("),("    const currency = body.currency == null ? existing.currency : sealed.normalizeLot({","    if (hasSales) lot.remainingCostCents = existing.remaining_cost_cents;\n    const currency = body.currency == null ? existing.currency : sealed.normalizeLot({")]))
for path,text in changes:path.write_text(text)
