// completed-rip-basis-v1
'use strict';
const { allocateOpeningCost } = require('./costBasis');
const schema = `
CREATE TABLE IF NOT EXISTS opening_basis_snapshot (
 opening_id INTEGER PRIMARY KEY REFERENCES sealed_opening(id) ON DELETE RESTRICT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS opening_basis_copy (
 collection_id INTEGER PRIMARY KEY REFERENCES collection(id) ON DELETE RESTRICT,
 opening_id INTEGER NOT NULL REFERENCES opening_basis_snapshot(opening_id) ON DELETE RESTRICT,
 pull_id INTEGER NOT NULL REFERENCES sealed_pull(id) ON DELETE RESTRICT,
 cost_cents INTEGER NOT NULL CHECK(cost_cents >= 0)
);
CREATE TRIGGER IF NOT EXISTS opening_basis_snapshot_immutable_update BEFORE UPDATE ON opening_basis_snapshot BEGIN SELECT RAISE(ABORT, 'Finalized basis snapshot is immutable'); END;
CREATE TRIGGER IF NOT EXISTS opening_basis_snapshot_immutable_delete BEFORE DELETE ON opening_basis_snapshot BEGIN SELECT RAISE(ABORT, 'Finalized basis snapshot is immutable'); END;
CREATE TRIGGER IF NOT EXISTS opening_basis_copy_immutable_update BEFORE UPDATE ON opening_basis_copy BEGIN SELECT RAISE(ABORT, 'Finalized basis mapping is immutable'); END;
CREATE TRIGGER IF NOT EXISTS opening_basis_copy_immutable_delete BEFORE DELETE ON opening_basis_copy BEGIN SELECT RAISE(ABORT, 'Finalized basis mapping is immutable'); END;
CREATE TRIGGER IF NOT EXISTS opening_basis_protect_opening BEFORE UPDATE OF cost_cents, currency, quantity, opened_at, entry_complete, user_id, lot_id, product_id ON sealed_opening WHEN EXISTS(SELECT 1 FROM opening_basis_snapshot WHERE opening_id=OLD.id) BEGIN SELECT RAISE(ABORT, 'Opening basis is finalized; acquisition changes require a correction workflow'); END;
CREATE TRIGGER IF NOT EXISTS opening_basis_protect_pull_insert BEFORE INSERT ON sealed_pull WHEN EXISTS(SELECT 1 FROM opening_basis_snapshot WHERE opening_id=NEW.opening_id) BEGIN SELECT RAISE(ABORT, 'Opening basis is finalized; contents cannot be added'); END;
CREATE TRIGGER IF NOT EXISTS opening_basis_protect_pull_delete BEFORE DELETE ON sealed_pull WHEN EXISTS(SELECT 1 FROM opening_basis_snapshot WHERE opening_id=OLD.opening_id) BEGIN SELECT RAISE(ABORT, 'Opening basis is finalized; contents cannot be removed'); END;
CREATE TRIGGER IF NOT EXISTS opening_basis_protect_pull_update BEFORE UPDATE OF quantity, card_id, collection_id, filed_ids, opened_unit_cents, opened_line_cents, opening_id, user_id ON sealed_pull WHEN EXISTS(SELECT 1 FROM opening_basis_snapshot WHERE opening_id=OLD.opening_id OR opening_id=NEW.opening_id) BEGIN SELECT RAISE(ABORT, 'Opening basis is finalized; provenance cannot be changed'); END;
`;
const fail = (status, message) => Object.assign(new Error(message), { status });
const valid = n => Number.isSafeInteger(n) && n >= 0;
function createOpeningBasisRepository({ connect }) {
  return { async finalize(userId, openingId) {
    if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(openingId) || openingId < 1) throw fail(400, 'Invalid owner or opening');
    const db = await connect(); let began = false;
    try {
      await db.run('BEGIN IMMEDIATE'); began = true; await db.exec(schema);
      const opening = await db.get('SELECT * FROM sealed_opening WHERE id=? AND user_id=?', [openingId, userId]);
      if (!opening) throw fail(404, 'Opening not found');
      const prior = await db.get('SELECT snapshot_json FROM opening_basis_snapshot WHERE opening_id=? AND user_id=?', [openingId, userId]);
      if (prior) { await db.run('COMMIT'); began = false; return JSON.parse(prior.snapshot_json); }
      const pending = async reason => { await db.run('COMMIT'); began = false; return { status: 'pending', reason, openingId }; };
      if (opening.currency !== 'USD') return await pending('Historical non-USD basis requires an explicit conversion policy');
      if (opening.entry_complete !== 1) return await pending('All opening contents must be marked complete');
      if (!valid(opening.cost_cents)) throw fail(409, 'Invalid opening cost');
      const pulls = await db.all('SELECT * FROM sealed_pull WHERE opening_id=? AND user_id=? ORDER BY id', [openingId, userId]);
      if (!pulls.length || pulls.some(row => !valid(row.opened_line_cents))) return await pending('Opening-time values are missing');
      const seen = new Set(), prepared = [];
      for (const row of pulls) {
        if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 10000) throw fail(409, 'Invalid pull quantity');
        const rawIds = String(row.filed_ids || '').split(',').map(id => id.trim()).filter(Boolean);
        if (rawIds.some(id => !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)))) throw fail(409, 'Invalid filed-copy identity');
        const ids = rawIds.map(Number);
        if (!ids.length && row.collection_id != null) return await pending('A manually linked copy needs acquisition-source verification');
        if (ids.length && (ids.length !== row.quantity || !row.card_id)) throw fail(409, 'Pull quantity does not match filed copies');
        if (ids.length && row.collection_id != null && !ids.includes(row.collection_id)) throw fail(409, 'Primary copy is outside the filed-copy set');
        for (const id of ids) {
          if (seen.has(id)) throw fail(409, 'A copy is linked more than once'); seen.add(id);
          const copy = await db.get('SELECT * FROM collection WHERE id=? AND user_id=?', [id, userId]);
          if (!copy || copy.list_type !== 'collection' || copy.quantity !== 1 || copy.card_id !== row.card_id) throw fail(409, 'Filed copy changed or is no longer owned');
          if (await db.get('SELECT collection_id FROM opening_basis_copy WHERE collection_id=?', [id])) throw fail(409, 'Copy already has finalized opening basis');
          if (await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='card_acquisition_lot'")) {
            if (await db.get('SELECT id FROM card_acquisition_lot WHERE collection_id=?', [id])) throw fail(409, 'Copy already has an acquisition lot; reconciliation is required');
          }
        }
        prepared.push({ row, ids });
      }
      const allocation = allocateOpeningCost(opening.cost_cents, pulls.map(row => ({ id: String(row.id), openingValueCents: row.opened_line_cents })), { complete: true });
      if (allocation.status !== 'allocated') return await pending('Opening contents have no usable opening-time value');
      const costs = new Map(allocation.allocations.map(line => [line.id, line.costCents]));
      const lines = prepared.map(({ row, ids }) => {
        const costCents = costs.get(String(row.id));
        const split = ids.length ? allocateOpeningCost(costCents, ids.map(id => ({ id: String(id), openingValueCents: 1 })), { complete: true }).allocations : [];
        return { pullId: row.id, cardId: row.card_id || null, quantity: row.quantity, openingValueCents: row.opened_line_cents, costCents, copies: split.map(copy => ({ collectionId: Number(copy.id), costCents: copy.costCents })), unlinkedBasisCents: ids.length ? 0 : costCents };
      });
      const snapshot = { status: 'finalized', version: 1, method: 'relative-opening-line-value', openingId, currency: 'USD', totalCostCents: opening.cost_cents, lines };
      await db.run('INSERT INTO opening_basis_snapshot (opening_id,user_id,snapshot_json) VALUES (?,?,?)', [openingId, userId, JSON.stringify(snapshot)]);
      for (const line of lines) for (const copy of line.copies) await db.run('INSERT INTO opening_basis_copy (collection_id,opening_id,pull_id,cost_cents) VALUES (?,?,?,?)', [copy.collectionId, openingId, line.pullId, copy.costCents]);
      await db.run('COMMIT'); began = false; return snapshot;
    } catch (error) { if (began) await db.run('ROLLBACK').catch(() => {}); throw error; }
    finally { await db.close(); }
  } };
}
module.exports = { createOpeningBasisRepository, schema };
