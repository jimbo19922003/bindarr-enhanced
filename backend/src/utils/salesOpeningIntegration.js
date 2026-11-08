'use strict';
const fail = (status, message) => Object.assign(new Error(message), { status });
async function hasTable(db, name) { return !!await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]); }
// Called only inside the repository's dedicated BEGIN IMMEDIATE transaction.
async function prepareSchema(db, schema) {
  const current = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='card_acquisition_lot'");
  if (!current || current.sql.includes("'opening'")) { await db.exec(schema); return; }
  const triggers = await db.all("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('card_acquisition_lot','card_sale_record')");
  if (triggers.length) throw fail(409, 'Custom accounting triggers require a reviewed migration');
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  for (const table of tables) {
    const quoted = table.name.replace(/"/g, '""');
    const refs = await db.all(`PRAGMA foreign_key_list("${quoted}")`);
    if (table.name !== 'card_sale_record' && refs.some(ref => ['card_acquisition_lot','card_sale_record'].includes(ref.table))) throw fail(409, 'Additional accounting dependencies require a reviewed migration');
  }
  const hadSales = await hasTable(db, 'card_sale_record');
  if (hadSales) await db.run('ALTER TABLE card_sale_record RENAME TO card_sale_record_upgrade_old');
  await db.run('ALTER TABLE card_acquisition_lot RENAME TO card_acquisition_lot_upgrade_old');
  await db.exec(schema);
  await db.run('INSERT INTO card_acquisition_lot SELECT * FROM card_acquisition_lot_upgrade_old');
  if (hadSales) {
    await db.run('INSERT INTO card_sale_record SELECT * FROM card_sale_record_upgrade_old');
    await db.run('DROP TABLE card_sale_record_upgrade_old');
  }
  await db.run('DROP TABLE card_acquisition_lot_upgrade_old');
  if ((await db.all('PRAGMA foreign_key_check')).length) throw fail(409, 'Accounting migration failed foreign-key validation');
}
async function rejectFrozenCopy(db, collectionId) {
  if (await hasTable(db, 'opening_basis_copy') && await db.get('SELECT collection_id FROM opening_basis_copy WHERE collection_id=?', [collectionId])) throw fail(409, 'Use the finalized opening allocation for this copy');
}
async function createOpeningLot(db, userId, collectionId) {
  if (!Number.isSafeInteger(collectionId) || collectionId < 1) throw fail(400, 'Invalid collection ID');
  if (!await hasTable(db, 'opening_basis_copy')) throw fail(409, 'Finalize opening basis first');
  const mapping = await db.get('SELECT b.cost_cents, s.snapshot_json FROM opening_basis_copy b JOIN opening_basis_snapshot s ON s.opening_id=b.opening_id WHERE b.collection_id=? AND s.user_id=?', [collectionId,userId]);
  if (!mapping) throw fail(404, 'Owned finalized opening allocation not found');
  const snapshot = JSON.parse(mapping.snapshot_json);
  const line = snapshot.lines.find(item => item.copies.some(copy => copy.collectionId === collectionId));
  if (!line || snapshot.currency !== 'USD' || !Number.isSafeInteger(mapping.cost_cents) || mapping.cost_cents < 0 || line.copies.find(copy => copy.collectionId === collectionId).costCents !== mapping.cost_cents) throw fail(409, 'Frozen copy basis is inconsistent');
  const prior = await db.get('SELECT * FROM card_acquisition_lot WHERE collection_id=?', [collectionId]);
  if (prior) {
    if (prior.user_id !== userId || prior.source !== 'opening' || prior.original_basis_cents !== mapping.cost_cents) throw fail(409, 'Conflicting acquisition lot needs reconciliation');
    return prior;
  }
  const copy = await db.get("SELECT * FROM collection WHERE id=? AND user_id=? AND list_type='collection'", [collectionId,userId]);
  if (!copy || copy.quantity !== 1 || copy.card_id !== line.cardId) throw fail(409, 'Finalized copy identity or inventory changed');
  const added = await db.run("INSERT INTO card_acquisition_lot (user_id,collection_id,source,original_quantity,remaining_quantity,original_basis_cents,remaining_basis_cents,currency) VALUES (?,?,'opening',1,1,?,?,'USD')", [userId,collectionId,mapping.cost_cents,mapping.cost_cents]);
  return db.get('SELECT * FROM card_acquisition_lot WHERE id=? AND user_id=?', [added.lastID,userId]);
}
module.exports = { prepareSchema, rejectFrozenCopy, createOpeningLot };
