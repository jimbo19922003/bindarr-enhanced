'use strict';

const express = require('express');
const db = require('../db');
const accounting = require('../utils/openingAccounting');
const openings = require('../utils/sealedOpening');
const pokemonProvider = require('../utils/pokemonProvider');
const collection = require('./collection');

const router = express.Router();
const MAX_PULLS = 100;

function fail(res, status, error) {
  return res.status(status).json({ error });
}

function statusOf(err) {
  if (err && Number.isInteger(err.status)) return err.status;
  if (err instanceof TypeError || err instanceof RangeError) return 400;
  return 500;
}

function likeTerm(value) {
  return `%${String(value).replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
}

async function pullsFor(userId, openingIds) {
  if (!openingIds.length) return new Map();
  const marks = openingIds.map(() => '?').join(', ');
  const rows = await db.all(
    `SELECT * FROM sealed_pull WHERE user_id = ? AND opening_id IN (${marks}) ORDER BY id`,
    [userId, ...openingIds]
  );
  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.opening_id) || [];
    list.push(row);
    grouped.set(row.opening_id, list);
  }
  return grouped;
}

async function presentOwned(userId, openingId) {
  const row = await db.get(
    `SELECT * FROM sealed_opening WHERE id = ? AND user_id = ?`,
    [openingId, userId]
  );
  if (!row) return null;
  const grouped = await pullsFor(userId, [row.id]);
  return openings.presentOpening(row, grouped.get(row.id) || []);
}

async function cardFor(cardId) {
  if (!cardId) return null;
  return db.get(
    `SELECT id, name, set_name, number, image_url, price_trend, price_currency, language, game FROM card_cache WHERE id = ?`,
    [cardId]
  );
}

async function forgetFiled(userId, ids) {
  if (!ids || !ids.length) return;
  const marks = ids.map(() => '?').join(', ');
  await db.run(
    `DELETE FROM collection WHERE user_id = ? AND id IN (${marks})`,
    [userId, ...ids]
  );
}

// A card pull is a real collection copy. The opening cost is not its purchase
// price. PokéWallet prices the card on the way in, the same as adding it from
// search, and that price is the value at opening when none was typed.
async function filePull(user, pull, currency) {
  if (!pull.cardId || pull.collectionId) return;
  const known = await cardFor(pull.cardId);
  const added = await collection.addCardToCollection(user, {
    card_id: pull.cardId,
    quantity: pull.quantity,
    language: (known && known.language) || 'English',
    purchase_price: 0,
    game: (known && known.game) || 'pokemon',
    location_id: null,
  });
  pull.filedIds = added.ids && added.ids.length ? added.ids : [added.id];
  pull.collectionId = added.id;
  const owned = await db.get(
    `SELECT card_id FROM collection WHERE id = ? AND user_id = ?`,
    [added.id, user.id]
  );
  if (owned && owned.card_id) pull.cardId = owned.card_id;
  const priced = await cardFor(pull.cardId);
  openings.fillFromCard(pull, priced);
  openings.applyCatalogPrice(pull, priced, currency);
}

async function resolvePull(user, raw, currency, fillPrice) {
  const pull = openings.normalizePull(raw, currency);
  pull.filedIds = [];
  try {
    if (pull.collectionId) {
      const copy = await db.get(
        `SELECT c.id, c.card_id, cache.name, cache.set_name, cache.number, cache.image_url,
                cache.price_trend, cache.price_currency
           FROM collection c
           JOIN card_cache cache ON cache.id = c.card_id
          WHERE c.id = ? AND c.user_id = ?`,
        [pull.collectionId, user.id]
      );
      if (!copy) throw new TypeError('Collection card not found');
      if (pull.cardId && pull.cardId !== copy.card_id) throw new TypeError('Card does not match the collection copy');
      openings.fillFromCard(pull, copy);
      if (fillPrice) openings.applyCatalogPrice(pull, copy, currency);
    } else if (pull.cardId) {
      const card = await cardFor(pull.cardId);
      if (!card) throw new TypeError('Card not found');
      openings.fillFromCard(pull, card);
      if (fillPrice) await filePull(user, pull, currency);
    }
    if (fillPrice) openings.snapshotOpeningValue(pull);
    if (!pull.name) throw new TypeError('Pull name is required');
    return pull;
  } catch (err) {
    await forgetFiled(user.id, pull.filedIds);
    throw err;
  }
}

async function insertPull(userId, openingId, pull) {
  await db.run(
    `INSERT INTO sealed_pull (
       user_id, opening_id, card_id, collection_id, name, set_name, number, image_url, quantity,
       current_unit_cents, current_line_cents, opened_unit_cents, opened_line_cents
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, openingId, pull.cardId || null, pull.collectionId, pull.name, pull.setName, pull.number,
      pull.imageUrl, pull.quantity, pull.currentUnit, pull.currentLine, pull.openedUnit, pull.openedLine,
    ]
  );
}

async function catalogSets(lang) {
  const provider = await pokemonProvider.providerFor(lang);
  if (provider !== pokemonProvider.POKEMONTCG) {
    try {
      const api = await pokemonProvider.apiFor(lang);
      if (typeof api.listSets === 'function') {
        const sets = await api.listSets(lang);
        if (Array.isArray(sets) && sets.length) return sets;
      }
    } catch (err) {
      console.error('Card set list unavailable for an opening', err.message);
    }
  }
  try {
    return await db.all(`SELECT id, name FROM sets WHERE game = 'pokemon'`);
  } catch {
    return [];
  }
}

router.get('/sealed/card-set', async (req, res) => {
  try {
    const code = String(req.query.code || '').slice(0, 40);
    const name = String(req.query.name || '').slice(0, 120);
    const lang = String(req.query.lang || 'en').slice(0, 12);
    const sets = await catalogSets(lang);
    const cached = name
      ? await db.all(
        `SELECT DISTINCT set_id, set_name FROM card_cache WHERE game = 'pokemon' AND set_name = ? COLLATE NOCASE`,
        [name]
      )
      : [];
    res.json(openings.pickCatalogSet({ code, name, cached, sets }));
  } catch (err) {
    console.error('Failed to resolve a card set for an opening', err);
    fail(res, 500, 'Could not find the card set.');
  }
});

router.get('/sealed/cards', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ cards: [] });
    const cards = await db.all(
      `SELECT id, name, set_name, number, image_url, price_trend, price_currency
         FROM card_cache
        WHERE name LIKE ? ESCAPE '\\'
        ORDER BY name
        LIMIT 8`,
      [likeTerm(q.slice(0, 80))]
    );
    res.json({
      cards: cards.map(card => ({
        id: card.id,
        name: card.name,
        set_name: card.set_name || '',
        number: card.number || '',
        image_url: card.image_url || '',
        price: card.price_trend == null ? null : Number(card.price_trend),
        currency: card.price_currency || null,
      })),
    });
  } catch (err) {
    console.error('Failed to look up cards for an opening', err);
    fail(res, 500, 'Could not look up cards.');
  }
});

router.get('/sealed/products/:id/openings', async (req, res) => {
  try {
    const product = await db.get(
      `SELECT id FROM sealed_product WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!product) return fail(res, 404, 'Sealed product not found');
    const rows = await db.all(
      `SELECT * FROM sealed_opening WHERE user_id = ? AND product_id = ? ORDER BY id`,
      [req.user.id, product.id]
    );
    const grouped = await pullsFor(req.user.id, rows.map(row => row.id));
    res.json({
      openings: rows.map(row => openings.presentOpening(row, grouped.get(row.id) || [])),
    });
  } catch (err) {
    console.error('Failed to list openings', err);
    fail(res, 500, 'Could not list openings.');
  }
});

router.get('/sealed/openings/:id', async (req, res) => {
  try {
    const opening = await presentOwned(req.user.id, req.params.id);
    if (!opening) return fail(res, 404, 'Opening not found');
    res.json({ opening });
  } catch (err) {
    console.error('Failed to read opening', err);
    fail(res, 500, 'Could not read that opening.');
  }
});

router.post('/sealed/lots/:id/openings', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.quantity != null && Number(body.quantity) !== 1) {
      return fail(res, 400, 'Open one unit at a time so each box stays its own opening.');
    }
    const rawPulls = body.pulls == null ? [] : body.pulls;
    if (!Array.isArray(rawPulls) || rawPulls.length > MAX_PULLS) {
      return fail(res, 400, 'An opening can record at most 100 pulls.');
    }
    const lotPreview = await db.get(
      `SELECT currency FROM sealed_lot WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!lotPreview) return fail(res, 404, 'Sealed lot not found');
    const prepared = [];
    try {
      for (const raw of rawPulls) {
        prepared.push(await resolvePull(req.user, raw, lotPreview.currency, true));
      }
    } catch (err) {
      await forgetFiled(req.user.id, prepared.flatMap(pull => pull.filedIds || []));
      throw err;
    }
    const filedIds = prepared.flatMap(pull => pull.filedIds || []);
    let openingId;
    try {
      openingId = await db.withTransaction(async () => {
      const lot = await db.get(
        `SELECT * FROM sealed_lot WHERE id = ? AND user_id = ?`,
        [req.params.id, req.user.id]
      );
      if (!lot || lot.archived_at) {
        const missing = new Error('Sealed lot not found');
        missing.status = 404;
        throw missing;
      }
      const product = await db.get(
        `SELECT id, archived_at FROM sealed_product WHERE id = ? AND user_id = ?`,
        [lot.product_id, req.user.id]
      );
      if (!product || product.archived_at) {
        const missing = new Error('Sealed product not found');
        missing.status = 404;
        throw missing;
      }
      const allocated = accounting.allocateOpening({
        remainingQuantity: lot.remaining_quantity,
        remainingCostCents: lot.remaining_cost_cents,
        quantity: 1,
      });
      await db.run(
        `UPDATE sealed_lot
            SET remaining_quantity = ?, remaining_cost_cents = ?, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
        [allocated.remainingQuantity, allocated.remainingCostCents, lot.id, req.user.id]
      );
      const inserted = await db.run(
        `INSERT INTO sealed_opening (
           user_id, product_id, lot_id, quantity, cost_cents, currency, opened_at, notes, entry_complete
         ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          lot.product_id,
          lot.id,
          allocated.costCents,
          lot.currency,
          openings.openedOn(body.opened_at, lot.currency),
          openings.notesOf(body.notes),
          body.entry_complete === true ? 1 : 0,
        ]
      );
      for (const pull of prepared) {
        await insertPull(req.user.id, inserted.lastID, pull);
      }
      return inserted.lastID;
    });
    } catch (err) {
      await forgetFiled(req.user.id, filedIds);
      throw err;
    }
    res.status(201).json({ opening: await presentOwned(req.user.id, openingId) });
  } catch (err) {
    const status = statusOf(err);
    if (status >= 500) console.error('Failed to open sealed product', err);
    const message = status === 400 && err.message === 'Insufficient sealed quantity'
      ? 'Not enough sealed units left in that lot.'
      : err.message;
    fail(res, status, status >= 500 ? 'Could not open that product.' : message);
  }
});

router.put('/sealed/openings/:id', async (req, res) => {
  try {
    const existing = await db.get(
      `SELECT * FROM sealed_opening WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!existing) return fail(res, 404, 'Opening not found');
    const body = req.body || {};
    const notes = Object.prototype.hasOwnProperty.call(body, 'notes')
      ? openings.notesOf(body.notes)
      : existing.notes;
    const openedAt = Object.prototype.hasOwnProperty.call(body, 'opened_at')
      ? openings.openedOn(body.opened_at, existing.currency)
      : existing.opened_at;
    const entryComplete = Object.prototype.hasOwnProperty.call(body, 'entry_complete')
      ? (body.entry_complete === true ? 1 : 0)
      : existing.entry_complete;
    await db.run(
      `UPDATE sealed_opening
          SET notes = ?, opened_at = ?, entry_complete = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`,
      [notes, openedAt, entryComplete, existing.id, req.user.id]
    );
    res.json({ opening: await presentOwned(req.user.id, existing.id) });
  } catch (err) {
    const status = statusOf(err);
    if (status >= 500) console.error('Failed to update opening', err);
    fail(res, status, status >= 500 ? 'Could not update that opening.' : err.message);
  }
});

router.delete('/sealed/openings/:id', async (req, res) => {
  try {
    await db.withTransaction(async () => {
      const opening = await db.get(
        `SELECT * FROM sealed_opening WHERE id = ? AND user_id = ?`,
        [req.params.id, req.user.id]
      );
      if (!opening) {
        const missing = new Error('Opening not found');
        missing.status = 404;
        throw missing;
      }
      const lot = await db.get(
        `SELECT * FROM sealed_lot WHERE id = ? AND user_id = ?`,
        [opening.lot_id, req.user.id]
      );
      if (!lot) {
        const missing = new Error('Sealed lot not found');
        missing.status = 404;
        throw missing;
      }
      const remaining = lot.remaining_quantity + opening.quantity;
      const remainingCost = lot.remaining_cost_cents + opening.cost_cents;
      if (remaining > lot.quantity || remainingCost > lot.total_cost_cents) {
        const conflict = new Error('This opening cannot be removed because the lot was changed after it was opened.');
        conflict.status = 409;
        throw conflict;
      }
      await db.run(
        `UPDATE sealed_lot
            SET remaining_quantity = ?, remaining_cost_cents = ?, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
        [remaining, remainingCost, lot.id, req.user.id]
      );
      await db.run(`DELETE FROM sealed_opening WHERE id = ? AND user_id = ?`, [opening.id, req.user.id]);
    });
    res.json({ ok: true });
  } catch (err) {
    const status = statusOf(err);
    if (status >= 500) console.error('Failed to remove opening', err);
    fail(res, status, status >= 500 ? 'Could not remove that opening.' : err.message);
  }
});

router.post('/sealed/openings/:id/pulls', async (req, res) => {
  try {
    const opening = await db.get(
      `SELECT * FROM sealed_opening WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!opening) return fail(res, 404, 'Opening not found');
    const count = await db.get(
      `SELECT COUNT(*) AS n FROM sealed_pull WHERE opening_id = ? AND user_id = ?`,
      [opening.id, req.user.id]
    );
    if (count.n >= MAX_PULLS) return fail(res, 400, 'An opening can record at most 100 pulls.');
    const pull = await resolvePull(req.user, req.body || {}, opening.currency, true);
    try {
      await insertPull(req.user.id, opening.id, pull);
    } catch (err) {
      await forgetFiled(req.user.id, pull.filedIds);
      throw err;
    }
    res.status(201).json({ opening: await presentOwned(req.user.id, opening.id) });
  } catch (err) {
    const status = statusOf(err);
    if (status >= 500) console.error('Failed to add pull', err);
    fail(res, status, status >= 500 ? 'Could not add that pull.' : err.message);
  }
});

router.put('/sealed/openings/:id/pulls/:pullId', async (req, res) => {
  try {
    const opening = await db.get(
      `SELECT * FROM sealed_opening WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!opening) return fail(res, 404, 'Opening not found');
    const existing = await db.get(
      `SELECT id FROM sealed_pull WHERE id = ? AND opening_id = ? AND user_id = ?`,
      [req.params.pullId, opening.id, req.user.id]
    );
    if (!existing) return fail(res, 404, 'Pull not found');
    const pull = await resolvePull(req.user, req.body || {}, opening.currency, false);
    await db.run(
      `UPDATE sealed_pull
          SET card_id = ?, collection_id = ?, name = ?, set_name = ?, number = ?, image_url = ?,
              quantity = ?, current_unit_cents = ?, current_line_cents = ?,
              opened_unit_cents = ?, opened_line_cents = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`,
      [
        pull.cardId || null, pull.collectionId, pull.name, pull.setName, pull.number, pull.imageUrl,
        pull.quantity, pull.currentUnit, pull.currentLine, pull.openedUnit, pull.openedLine,
        existing.id, req.user.id,
      ]
    );
    res.json({ opening: await presentOwned(req.user.id, opening.id) });
  } catch (err) {
    const status = statusOf(err);
    if (status >= 500) console.error('Failed to update pull', err);
    fail(res, status, status >= 500 ? 'Could not update that pull.' : err.message);
  }
});

router.delete('/sealed/openings/:id/pulls/:pullId', async (req, res) => {
  try {
    const result = await db.run(
      `DELETE FROM sealed_pull WHERE id = ? AND opening_id = ? AND user_id = ?`,
      [req.params.pullId, req.params.id, req.user.id]
    );
    if (!result.changes) return fail(res, 404, 'Pull not found');
    const opening = await presentOwned(req.user.id, req.params.id);
    if (!opening) return fail(res, 404, 'Opening not found');
    res.json({ opening });
  } catch (err) {
    console.error('Failed to remove pull', err);
    fail(res, 500, 'Could not remove that pull.');
  }
});

module.exports = router;
