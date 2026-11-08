'use strict';
const express = require('express');
const sqlite3 = require('sqlite3');
const { createHash } = require('crypto');
const db = require('../db');
const opening = require('../utils/sealedOpening');
const { applyPullPrice } = require('../utils/ripValuation');
const router = express.Router();
const canon = value => Array.isArray(value) ? value.map(canon) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canon(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');
const idsOf = row => [...new Set(String(row.filed_ids || '').split(',').map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
async function connect() {
  let connection;
  await new Promise((resolve, reject) => { connection = new sqlite3.Database(db.dbPath, sqlite3.OPEN_READWRITE, error => error ? reject(error) : resolve()); });
  const run = (sql, params = []) => new Promise((resolve, reject) => connection.run(sql, params, function(error) { error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes }); }));
  const get = (sql, params = []) => new Promise((resolve, reject) => connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
  const all = (sql, params = []) => new Promise((resolve, reject) => connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
  const close = () => new Promise((resolve, reject) => connection.close(error => error ? reject(error) : resolve()));
  try { await run('PRAGMA foreign_keys = ON'); await run('PRAGMA busy_timeout = 5000'); } catch (error) { await close(); throw error; }
  return { run, get, all, close };
}
async function copyCard(tx, userId, card, template) {
  const use = template || card;
  if (use.cert_number || (use.grader && use.grader !== 'Raw')) throw fail('Add separately identified graded copies rather than increasing this quantity.', 409);
  const result = await tx.run(`INSERT INTO collection (user_id, card_id, quantity, condition, printing, language, purchase_price, game, list_type, market_value)
    VALUES (?, ?, 1, ?, ?, ?, 0, ?, 'collection', ?)`, [userId, card.id, use.condition || 'Near Mint', use.printing || 'Normal', use.language || 'English', card.game || 'pokemon', template?.market_value ?? null]);
  return result.lastID;
}
async function removeCopies(tx, userId, row, ids) {
  if (!ids.length || !row.card_id) return;
  await tx.run(`DELETE FROM collection WHERE user_id = ? AND card_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [userId, row.card_id, ...ids]);
}

// A local, read-only ownership lookup. No provider requests or collection writes.
router.post('/sealed/rip-ownership', async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.card_ids) || body.card_ids.length > 100 || body.card_ids.some(id => typeof id !== 'string' || !id || id.length > 80)) throw fail('Provide at most 100 valid card IDs');
    const ids = [...new Set(body.card_ids)];
    let openingId = null;
    if (body.opening_id != null) {
      openingId = Number(body.opening_id);
      if (!Number.isSafeInteger(openingId) || openingId < 1) throw fail('Invalid opening ID');
      if (!(await db.get('SELECT id FROM sealed_opening WHERE id = ? AND user_id = ?', [openingId, req.user.id]))) throw fail('Opening not found', 404);
    }
    const counts = Object.fromEntries(ids.map(id => [id, 0]));
    if (ids.length) {
      const exclude = openingId == null ? '' : ` AND NOT EXISTS (SELECT 1 FROM sealed_pull sp WHERE sp.user_id = c.user_id AND sp.opening_id = ? AND instr(',' || COALESCE(sp.filed_ids, '') || ',', ',' || c.id || ',') > 0)`;
      const rows = await db.all(`SELECT c.card_id, SUM(COALESCE(c.quantity, 1)) AS owned FROM collection c
        WHERE c.user_id = ? AND c.list_type = 'collection' AND c.card_id IN (${ids.map(() => '?').join(',')})${exclude} GROUP BY c.card_id`,
      [req.user.id, ...ids, ...(openingId == null ? [] : [openingId])]);
      for (const row of rows) counts[row.card_id] = row.owned;
    }
    res.set('Cache-Control', 'private, no-store');
    res.json({ counts, excluded_opening_id: openingId, identity: 'catalog-card-any-finish' });
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not check collection ownership' }); }
});

router.put('/sealed/openings/:id/edit', async (req, res) => {
  let tx, begun = false;
  try {
    const body = req.body || {}, userId = req.user.id;
    if (!/^[A-Za-z0-9-]{8,128}$/.test(body.request_id || '')) throw fail('A valid edit request ID is required');
    if (!body.base || !Array.isArray(body.pulls) || body.pulls.length > 100) throw fail('Provide the original opening and at most 100 pulls');
    tx = await connect();
    await tx.run(`CREATE TABLE IF NOT EXISTS sealed_opening_edit_request (user_id INTEGER NOT NULL, opening_id INTEGER NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, response_json TEXT NOT NULL, PRIMARY KEY(user_id, opening_id, request_id), FOREIGN KEY(opening_id) REFERENCES sealed_opening(id) ON DELETE CASCADE)`);
    const original = await tx.get('SELECT * FROM sealed_opening WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    if (!original) throw fail('Opening not found', 404);
    const hash = digest(body);
    const prior = await tx.get('SELECT payload_hash, response_json FROM sealed_opening_edit_request WHERE user_id = ? AND opening_id = ? AND request_id = ?', [userId, original.id, body.request_id]);
    if (prior) { if (prior.payload_hash !== hash) throw fail('This request ID was already used for different changes', 409); return res.json(JSON.parse(prior.response_json)); }
    const cards = new Map(), prepared = [], seen = new Set();
    for (const raw of body.pulls) {
      const pull = opening.normalizePull(raw, original.currency);
      if (raw.id != null) {
        const id = Number(raw.id);
        if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) throw fail('Saved pull IDs must be unique positive integers');
        seen.add(id); pull.savedId = id;
      }
      if (pull.cardId && !cards.has(pull.cardId)) cards.set(pull.cardId, await db.get('SELECT * FROM card_cache WHERE id = ?', [pull.cardId]));
      if (!pull.savedId && pull.cardId) {
        const card = cards.get(pull.cardId);
        if (!card) throw fail('Card not found');
        if (pull.collectionId) throw fail('New entries must not supply existing collection links');
        opening.fillFromCard(pull, card);
        pull.currentUnit = null; pull.currentLine = null; pull.currentBlank = true;
        pull.openedUnit = null; pull.openedLine = null;
        await applyPullPrice(pull, { ...card, printing: 'Normal' }, original.currency);
        opening.snapshotOpeningValue(pull);
      } else if (!pull.savedId) opening.snapshotOpeningValue(pull);
      if (!pull.name) throw fail('Pull name is required');
      prepared.push(pull);
    }
    const notes = opening.notesOf(body.notes ?? original.notes);
    const openedAt = opening.openedOn(body.opened_at ?? original.opened_at, original.currency);
    const complete = body.entry_complete === undefined ? original.entry_complete : body.entry_complete === true ? 1 : 0;
    await tx.run('BEGIN IMMEDIATE'); begun = true;
    const replay = await tx.get('SELECT payload_hash, response_json FROM sealed_opening_edit_request WHERE user_id = ? AND opening_id = ? AND request_id = ?', [userId, original.id, body.request_id]);
    if (replay) {
      if (replay.payload_hash !== hash) throw fail('This request ID was already used for different changes', 409);
      await tx.run('COMMIT'); begun = false; return res.json(JSON.parse(replay.response_json));
    }
    const current = await tx.get('SELECT * FROM sealed_opening WHERE id = ? AND user_id = ?', [original.id, userId]);
    if (!current) throw fail('Opening not found', 404);
    const stored = await tx.all('SELECT * FROM sealed_pull WHERE opening_id = ? AND user_id = ? ORDER BY id', [current.id, userId]);
    if (digest(opening.presentOpening(current, stored)) !== digest(body.base)) throw fail('This rip changed elsewhere. Close and reopen it before saving.', 409);
    const saved = new Map(stored.map(row => [row.id, row]));
    const changes = { newPulls: 0, removedPulls: 0, addedCopies: 0, removedCopies: 0 };
    for (const pull of prepared) {
      if (!pull.savedId) continue;
      const row = saved.get(pull.savedId);
      if (!row || (row.card_id || '') !== pull.cardId) throw fail('A saved pull does not belong to this opening or its card identity changed');
      let filed = idsOf(row), collectionId = row.collection_id;
      const delta = pull.quantity - row.quantity;
      if (delta && row.card_id) {
        const card = cards.get(row.card_id);
        if (!card) throw fail('Card data is unavailable');
        if (delta > 0) {
          if (changes.addedCopies + delta > 500) throw fail('Add at most 500 collection copies per edit');
          const template = collectionId ? await tx.get('SELECT * FROM collection WHERE id = ? AND user_id = ? AND card_id = ?', [collectionId, userId, row.card_id]) : null;
          for (let i = 0; i < delta; i++) filed.push(await copyCard(tx, userId, card, template));
          changes.addedCopies += delta; collectionId = collectionId || filed[0];
        } else {
          const candidates = filed.length ? await tx.all(`SELECT id, quantity FROM collection WHERE user_id = ? AND card_id = ? AND id IN (${filed.map(() => '?').join(',')}) ORDER BY id DESC`, [userId, row.card_id, ...filed]) : [];
          if (candidates.some(copy => copy.quantity !== 1) || candidates.length < -delta) throw fail('Not enough copies owned by this rip to reduce its quantity safely', 409);
          const removed = candidates.slice(0, -delta).map(copy => copy.id);
          await removeCopies(tx, userId, row, removed); filed = filed.filter(id => !removed.includes(id));
          if (removed.includes(collectionId)) collectionId = filed[0] || null;
          changes.removedCopies += removed.length;
        }
      }
      if (delta || row.current_unit_cents !== pull.currentUnit || row.current_line_cents !== pull.currentLine || (!row.card_id && row.name !== pull.name)) {
        await tx.run(`UPDATE sealed_pull SET name = ?, quantity = ?, current_unit_cents = ?, current_line_cents = ?, collection_id = ?, filed_ids = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
          [row.card_id ? row.name : pull.name, pull.quantity, pull.currentUnit, pull.currentLine, collectionId, filed.join(','), row.id, userId]);
      }
    }
    for (const row of stored) if (!seen.has(row.id)) {
      const filed = idsOf(row);
      if (filed.length) {
        const before = await tx.get(`SELECT COUNT(*) AS n FROM collection WHERE user_id = ? AND card_id = ? AND id IN (${filed.map(() => '?').join(',')})`, [userId, row.card_id, ...filed]);
        await removeCopies(tx, userId, row, filed); changes.removedCopies += before.n;
      }
      await tx.run('DELETE FROM sealed_pull WHERE id = ? AND user_id = ?', [row.id, userId]); changes.removedPulls++;
    }
    for (const pull of prepared) if (!pull.savedId) {
      const filed = [];
      if (pull.cardId) {
        if (changes.addedCopies + pull.quantity > 500) throw fail('Add at most 500 collection copies per edit');
        for (let i = 0; i < pull.quantity; i++) filed.push(await copyCard(tx, userId, cards.get(pull.cardId)));
        changes.addedCopies += filed.length;
      }
      await tx.run(`INSERT INTO sealed_pull (user_id, opening_id, card_id, collection_id, name, set_name, number, image_url, quantity, current_unit_cents, current_line_cents, opened_unit_cents, opened_line_cents, filed_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, current.id, pull.cardId || null, filed[0] || null, pull.name, pull.setName, pull.number, pull.imageUrl, pull.quantity, pull.currentUnit, pull.currentLine, pull.openedUnit, pull.openedLine, filed.join(',')]); changes.newPulls++;
    }
    if (notes !== current.notes || openedAt !== current.opened_at || complete !== current.entry_complete) await tx.run(`UPDATE sealed_opening SET notes = ?, opened_at = ?, entry_complete = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`, [notes, openedAt, complete, current.id, userId]);
    const result = { opening: opening.presentOpening(await tx.get('SELECT * FROM sealed_opening WHERE id = ? AND user_id = ?', [current.id, userId]), await tx.all('SELECT * FROM sealed_pull WHERE opening_id = ? AND user_id = ? ORDER BY id', [current.id, userId])), changes };
    await tx.run('INSERT INTO sealed_opening_edit_request (user_id, opening_id, request_id, payload_hash, response_json) VALUES (?, ?, ?, ?, ?)', [userId, current.id, body.request_id, hash, JSON.stringify(result)]);
    await tx.run('COMMIT'); begun = false; res.json(result);
  } catch (error) {
    if (begun) await tx.run('ROLLBACK').catch(() => {});
    const status = error.status || (error instanceof TypeError || error instanceof RangeError ? 400 : 500);
    if (status === 500) console.error('Opening edit failed:', error.code || error.message);
    res.status(status).json({ error: status === 500 ? 'Could not save the rip edits. No edit changes were committed.' : error.message });
  } finally { if (tx) await tx.close().catch(() => {}); }
});
module.exports = router;
