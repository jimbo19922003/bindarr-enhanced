'use strict';
const { calculateSale } = require('./costBasis');
const schema = `
CREATE TABLE IF NOT EXISTS card_acquisition_lot (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 collection_id INTEGER NOT NULL UNIQUE REFERENCES collection(id) ON DELETE RESTRICT,
 source TEXT NOT NULL CHECK(source IN ('direct','unknown')),
 original_quantity INTEGER NOT NULL CHECK(original_quantity > 0),
 remaining_quantity INTEGER NOT NULL CHECK(remaining_quantity >= 0 AND remaining_quantity <= original_quantity),
 original_basis_cents INTEGER, remaining_basis_cents INTEGER,
 currency TEXT NOT NULL CHECK(currency = 'USD'),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((source = 'unknown' AND original_basis_cents IS NULL AND remaining_basis_cents IS NULL) OR
 (source = 'direct' AND original_basis_cents >= 0 AND remaining_basis_cents >= 0 AND remaining_basis_cents <= original_basis_cents AND original_basis_cents IS NOT NULL AND remaining_basis_cents IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS card_sale_record (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 lot_id INTEGER NOT NULL REFERENCES card_acquisition_lot(id) ON DELETE RESTRICT,
 request_key TEXT NOT NULL, request_json TEXT NOT NULL, result_json TEXT NOT NULL,
 sold_on TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
 proceeds_cents INTEGER NOT NULL CHECK(proceeds_cents >= 0),
 fees_cents INTEGER NOT NULL CHECK(fees_cents >= 0), sold_basis_cents INTEGER, realized_gain_cents INTEGER,
 currency TEXT NOT NULL CHECK(currency = 'USD'), card_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, request_key)
);`;
function problem(status, message) { return Object.assign(new Error(message), { status }); }
function positive(value, name) { if (!Number.isSafeInteger(value) || value < 1) throw problem(400, `Invalid ${name}`); }
function amount(value) { if (!Number.isSafeInteger(value) || value < 0) throw problem(400, 'Invalid monetary amount'); }
async function openConnection(path) {
  const sqlite3 = require('sqlite3'); let raw;
  await new Promise((resolve, reject) => { raw = new sqlite3.Database(path, sqlite3.OPEN_READWRITE, error => error ? reject(error) : resolve()); });
  const connection = {
    run: (sql, args = []) => new Promise((resolve, reject) => raw.run(sql, args, function(error) { error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID }); })),
    get: (sql, args = []) => new Promise((resolve, reject) => raw.get(sql, args, (error, row) => error ? reject(error) : resolve(row))),
    all: (sql, args = []) => new Promise((resolve, reject) => raw.all(sql, args, (error, rows) => error ? reject(error) : resolve(rows))),
    exec: sql => new Promise((resolve, reject) => raw.exec(sql, error => error ? reject(error) : resolve())),
    close: () => new Promise((resolve, reject) => raw.close(error => error ? reject(error) : resolve()))
  };
  try { await connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;'); } catch (error) { await connection.close(); throw error; }
  return connection;
}
function createSalesRepository({ connect }) {
  async function transaction(userId, work) {
    positive(userId, 'user');
    const db = await connect(); let began = false;
    try {
      await db.run('BEGIN IMMEDIATE'); began = true;
      await db.exec(schema);
      const result = await work(db);
      await db.run('COMMIT'); began = false; return result;
    } catch (error) { if (began) await db.run('ROLLBACK').catch(() => {}); throw error; }
    finally { await db.close(); }
  }
  return {
    createLot(userId, { collectionId, source = 'unknown', basisCents = null }) {
      positive(collectionId, 'collection ID');
      if (!['direct', 'unknown'].includes(source)) throw problem(400, 'Opening allocations require a separate finalized allocation workflow');
      if (source === 'direct') amount(basisCents);
      else if (basisCents !== null) throw problem(400, 'Unknown basis must be null');
      return transaction(userId, async db => {
        const entry = await db.get("SELECT * FROM collection WHERE id = ? AND user_id = ? AND list_type = 'collection'", [collectionId, userId]);
        if (!entry) throw problem(404, 'Owned collection copy not found');
        positive(entry.quantity, 'owned quantity');
        if (await db.get('SELECT id FROM card_acquisition_lot WHERE collection_id = ?', [collectionId])) throw problem(409, 'Acquisition lot already exists');
        if (source === 'direct') {
          const pulls = await db.all('SELECT collection_id, filed_ids FROM sealed_pull WHERE user_id = ?', [userId]);
          if (pulls.some(row => row.collection_id === collectionId || String(row.filed_ids || '').split(',').some(id => id.trim() === String(collectionId)))) throw problem(409, 'Known opening pull cannot be classified as a direct purchase');
        }
        const added = await db.run('INSERT INTO card_acquisition_lot (user_id, collection_id, source, original_quantity, remaining_quantity, original_basis_cents, remaining_basis_cents, currency) VALUES (?,?,?,?,?,?,?,?)', [userId, collectionId, source, entry.quantity, entry.quantity, basisCents, basisCents, 'USD']);
        return db.get('SELECT * FROM card_acquisition_lot WHERE id = ? AND user_id = ?', [added.lastID, userId]);
      });
    },
    recordSale(userId, { lotId, requestKey, soldOn, quantity, proceedsCents, feesCents = 0 }) {
      positive(lotId, 'lot ID'); positive(quantity, 'sale quantity'); amount(proceedsCents); amount(feesCents);
      if (typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(requestKey)) throw problem(400, 'Invalid idempotency key');
      if (typeof soldOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(soldOn) || !Number.isFinite(Date.parse(soldOn)) || new Date(soldOn).toISOString().slice(0, 10) !== soldOn) throw problem(400, 'Invalid sale date');
      const request = JSON.stringify({ lotId, soldOn, quantity, proceedsCents, feesCents });
      return transaction(userId, async db => {
        const prior = await db.get('SELECT request_json, result_json FROM card_sale_record WHERE user_id = ? AND request_key = ?', [userId, requestKey]);
        if (prior) { if (prior.request_json !== request) throw problem(409, 'Idempotency key reused with different sale details'); return JSON.parse(prior.result_json); }
        const lot = await db.get('SELECT * FROM card_acquisition_lot WHERE id = ? AND user_id = ?', [lotId, userId]);
        if (!lot) throw problem(404, 'Acquisition lot not found');
        const entry = await db.get("SELECT * FROM collection WHERE id = ? AND user_id = ? AND list_type = 'collection'", [lot.collection_id, userId]);
        if (!entry || entry.quantity !== lot.remaining_quantity || quantity > lot.remaining_quantity) throw problem(409, 'Inventory changed or insufficient copies remain');
        const result = calculateSale({ proceedsCents, feesCents, remainingBasisCents: lot.remaining_basis_cents, remainingQuantity: lot.remaining_quantity, quantity });
        await db.run('UPDATE card_acquisition_lot SET remaining_quantity = ?, remaining_basis_cents = ? WHERE id = ? AND user_id = ?', [result.remainingQuantity, result.remainingBasisCents, lotId, userId]);
        const changed = await db.run('UPDATE collection SET quantity = ?, list_type = ? WHERE id = ? AND user_id = ? AND quantity = ? AND list_type = ?', [result.remainingQuantity || entry.quantity, result.remainingQuantity ? 'collection' : 'sold', entry.id, userId, entry.quantity, 'collection']);
        if (changed.changes !== 1) throw problem(409, 'Inventory changed');
        const saved = await db.run('INSERT INTO card_sale_record (user_id, lot_id, request_key, request_json, result_json, sold_on, quantity, proceeds_cents, fees_cents, sold_basis_cents, realized_gain_cents, currency, card_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [userId, lotId, requestKey, request, JSON.stringify(result), soldOn, quantity, proceedsCents, feesCents, result.soldBasisCents, result.realizedGainCents, 'USD', entry.card_id]);
        return { ...result, saleId: saved.lastID };
      });
    }
  };
}
module.exports = { createSalesRepository, openConnection };
