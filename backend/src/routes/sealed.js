'use strict';

const express = require('express');
const db = require('../db');
const sealed = require('../utils/sealedInventory');

const router = express.Router();

function fail(res, status, error) {
  return res.status(status).json({ error });
}

function presentLot(row) {
  return {
    id: row.id,
    product_id: row.product_id,
    quantity: row.quantity,
    remaining_quantity: row.remaining_quantity,
    total_cost_cents: row.total_cost_cents,
    remaining_cost_cents: row.remaining_cost_cents,
    total_cost: sealed.centsToMoney(row.total_cost_cents),
    remaining_cost: sealed.centsToMoney(row.remaining_cost_cents),
    currency: row.currency,
    purchased_at: row.purchased_at,
    location_id: row.location_id,
    location_name: row.location_name || null,
    notes: row.notes || '',
    archived_at: row.archived_at,
  };
}

function presentProduct(row, lots) {
  const active = (lots || []).filter(lot => !lot.archived_at);
  return {
    id: row.id,
    name: row.name,
    product_type: row.product_type,
    language: row.language,
    set_id: row.set_id || '',
    set_name: row.set_name || '',
    image_url: row.image_url || '',
    provider: row.provider || '',
    provider_product_id: row.provider_product_id || '',
    market_price_cents: row.market_price_cents,
    market_price: row.market_price_cents == null ? null : sealed.centsToMoney(row.market_price_cents),
    market_currency: row.market_currency,
    market_quoted_at: row.market_quoted_at,
    market_source: row.market_source || '',
    archived_at: row.archived_at,
    remaining_quantity: active.reduce((sum, lot) => sum + lot.remaining_quantity, 0),
    lots: lots || [],
  };
}

async function lotsFor(userId, productIds) {
  if (!productIds.length) return new Map();
  const marks = productIds.map(() => '?').join(', ');
  const rows = await db.all(
    `SELECT l.*, loc.name AS location_name
       FROM sealed_lot l
       LEFT JOIN locations loc ON loc.id = l.location_id AND loc.user_id = l.user_id
      WHERE l.user_id = ? AND l.product_id IN (${marks})
      ORDER BY l.id`,
    [userId, ...productIds]
  );
  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.product_id) || [];
    list.push(presentLot(row));
    grouped.set(row.product_id, list);
  }
  return grouped;
}

async function ownedProduct(userId, id) {
  return db.get(`SELECT * FROM sealed_product WHERE id = ? AND user_id = ?`, [id, userId]);
}

async function locationFor(userId, locationId) {
  if (locationId == null) return null;
  return db.get(`SELECT id FROM locations WHERE id = ? AND user_id = ?`, [locationId, userId]);
}

function likeTerm(value) {
  return `%${String(value).replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
}

router.get('/sealed/products', async (req, res) => {
  try {
    const archived = req.query.archived === '1';
    const clauses = ['user_id = ?'];
    const params = [req.user.id];
    if (!archived) clauses.push('archived_at IS NULL');
    if (req.query.type) {
      if (!sealed.PRODUCT_TYPES.includes(req.query.type)) return fail(res, 400, 'Product type is not recognized');
      clauses.push('product_type = ?');
      params.push(req.query.type);
    }
    if (req.query.language) {
      clauses.push('language = ?');
      params.push(String(req.query.language).slice(0, 40));
    }
    if (req.query.q) {
      clauses.push(`(name LIKE ? ESCAPE '\\' OR set_name LIKE ? ESCAPE '\\')`);
      const term = likeTerm(String(req.query.q).slice(0, 200));
      params.push(term, term);
    }
    const products = await db.all(
      `SELECT * FROM sealed_product WHERE ${clauses.join(' AND ')} ORDER BY name, id`,
      params
    );
    const lots = await lotsFor(req.user.id, products.map(product => product.id));
    res.json({
      products: products.map(product => presentProduct(product, lots.get(product.id) || [])),
    });
  } catch (err) {
    console.error('Failed to list sealed products', err);
    fail(res, 500, 'Failed to list sealed products');
  }
});

router.get('/sealed/products/:id', async (req, res) => {
  try {
    const product = await ownedProduct(req.user.id, req.params.id);
    if (!product) return fail(res, 404, 'Sealed product not found');
    const lots = await lotsFor(req.user.id, [product.id]);
    res.json({ product: presentProduct(product, lots.get(product.id) || []) });
  } catch (err) {
    console.error('Failed to read sealed product', err);
    fail(res, 500, 'Failed to read sealed product');
  }
});

router.post('/sealed/products', async (req, res) => {
  try {
    const product = sealed.normalizeProduct(req.body || {});
    const lotInput = req.body && req.body.lot;
    const lot = lotInput ? sealed.normalizeLot(lotInput) : null;
    if (lot && lot.location_id && !(await locationFor(req.user.id, lot.location_id))) {
      return fail(res, 400, 'Storage location not found');
    }
    const id = await db.withTransaction(async () => {
      const created = await db.run(
        `INSERT INTO sealed_product (
           user_id, name, product_type, language, set_id, set_name, image_url,
           provider, provider_product_id, market_price_cents, market_currency,
           market_quoted_at, market_source
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id, product.name, product.product_type, product.language, product.set_id, product.set_name,
          product.image_url, product.provider, product.provider_product_id, product.market_price_cents,
          product.market_currency, product.market_price_cents == null ? null : new Date().toISOString(),
          product.market_price_cents == null ? '' : 'manual',
        ]
      );
      if (lot) await insertLot(req.user.id, created.lastID, lot);
      return created.lastID;
    });
    const stored = await ownedProduct(req.user.id, id);
    const lots = await lotsFor(req.user.id, [id]);
    res.status(201).json({ product: presentProduct(stored, lots.get(id) || []) });
  } catch (err) {
    if (err instanceof TypeError || err instanceof RangeError) return fail(res, 400, err.message);
    if (String(err.message || '').includes('UNIQUE')) return fail(res, 409, 'A product with that provider id already exists');
    console.error('Failed to create sealed product', err);
    fail(res, 500, 'Failed to create sealed product');
  }
});

router.put('/sealed/products/:id', async (req, res) => {
  try {
    const existing = await ownedProduct(req.user.id, req.params.id);
    if (!existing) return fail(res, 404, 'Sealed product not found');
    const body = req.body || {};
    const product = sealed.normalizeProduct({
      name: body.name ?? existing.name,
      product_type: body.product_type ?? existing.product_type,
      language: body.language ?? existing.language,
      set_id: body.set_id ?? existing.set_id,
      set_name: body.set_name ?? existing.set_name,
      image_url: body.image_url ?? existing.image_url,
      provider: body.provider ?? existing.provider,
      provider_product_id: body.provider_product_id ?? existing.provider_product_id,
      market_price: Object.prototype.hasOwnProperty.call(body, 'market_price')
        ? body.market_price
        : (existing.market_price_cents == null ? '' : sealed.centsToMoney(existing.market_price_cents)),
      market_currency: Object.prototype.hasOwnProperty.call(body, 'market_price')
        ? body.market_currency
        : existing.market_currency,
    });
    const quotedAt = product.market_price_cents == null
      ? null
      : (product.market_price_cents === existing.market_price_cents && product.market_currency === existing.market_currency
        ? existing.market_quoted_at
        : new Date().toISOString());
    await db.run(
      `UPDATE sealed_product
          SET name = ?, product_type = ?, language = ?, set_id = ?, set_name = ?, image_url = ?,
              provider = ?, provider_product_id = ?, market_price_cents = ?, market_currency = ?,
              market_quoted_at = ?, market_source = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`,
      [
        product.name, product.product_type, product.language, product.set_id, product.set_name, product.image_url,
        product.provider, product.provider_product_id, product.market_price_cents, product.market_currency, quotedAt,
        product.market_price_cents == null ? '' : (existing.market_source || 'manual'),
        existing.id, req.user.id,
      ]
    );
    const stored = await ownedProduct(req.user.id, existing.id);
    const lots = await lotsFor(req.user.id, [existing.id]);
    res.json({ product: presentProduct(stored, lots.get(existing.id) || []) });
  } catch (err) {
    if (err instanceof TypeError || err instanceof RangeError) return fail(res, 400, err.message);
    if (String(err.message || '').includes('UNIQUE')) return fail(res, 409, 'A product with that provider id already exists');
    console.error('Failed to update sealed product', err);
    fail(res, 500, 'Failed to update sealed product');
  }
});

router.post('/sealed/products/:id/archive', (req, res) => setProductArchived(req, res, true));
router.post('/sealed/products/:id/restore', (req, res) => setProductArchived(req, res, false));

async function setProductArchived(req, res, archived) {
  try {
    const result = await db.run(
      `UPDATE sealed_product SET archived_at = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      [archived ? new Date().toISOString() : null, req.params.id, req.user.id]
    );
    if (!result.changes) return fail(res, 404, 'Sealed product not found');
    const stored = await ownedProduct(req.user.id, req.params.id);
    const lots = await lotsFor(req.user.id, [stored.id]);
    res.json({ product: presentProduct(stored, lots.get(stored.id) || []) });
  } catch (err) {
    console.error('Failed to archive sealed product', err);
    fail(res, 500, 'Failed to archive sealed product');
  }
}

async function insertLot(userId, productId, lot) {
  await db.run(
    `INSERT INTO sealed_lot (
       user_id, product_id, quantity, remaining_quantity, total_cost_cents, remaining_cost_cents,
       currency, purchased_at, location_id, notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, productId, lot.quantity, lot.remainingQuantity, lot.totalCostCents, lot.remainingCostCents,
      lot.currency, lot.purchased_at, lot.location_id, lot.notes,
    ]
  );
}

router.post('/sealed/products/:id/lots', async (req, res) => {
  try {
    const product = await ownedProduct(req.user.id, req.params.id);
    if (!product) return fail(res, 404, 'Sealed product not found');
    const lot = sealed.normalizeLot(req.body || {});
    if (lot.location_id && !(await locationFor(req.user.id, lot.location_id))) {
      return fail(res, 400, 'Storage location not found');
    }
    await insertLot(req.user.id, product.id, lot);
    const lots = await lotsFor(req.user.id, [product.id]);
    res.status(201).json({ product: presentProduct(product, lots.get(product.id) || []) });
  } catch (err) {
    if (err instanceof TypeError || err instanceof RangeError) return fail(res, 400, err.message);
    console.error('Failed to add sealed lot', err);
    fail(res, 500, 'Failed to add sealed lot');
  }
});

router.put('/sealed/lots/:id', async (req, res) => {
  try {
    const existing = await db.get(
      `SELECT * FROM sealed_lot WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!existing) return fail(res, 404, 'Sealed lot not found');
    const body = req.body || {};
    const lot = sealed.nextLot(
      {
        quantity: existing.quantity,
        totalCostCents: existing.total_cost_cents,
        remainingQuantity: existing.remaining_quantity,
      },
      {
        quantity: body.quantity == null ? null : Number(body.quantity),
        totalCostCents: body.total_cost == null ? null : sealed.moneyToCents(body.total_cost, 'Total cost'),
        remainingQuantity: body.remaining_quantity == null ? null : Number(body.remaining_quantity),
      }
    );
    const currency = body.currency == null ? existing.currency : sealed.normalizeLot({
      quantity: lot.quantity,
      total_cost: sealed.centsToMoney(lot.totalCostCents),
      currency: body.currency,
    }).currency;
    const purchasedAt = Object.prototype.hasOwnProperty.call(body, 'purchased_at')
      ? sealed.normalizeLot({ quantity: 1, total_cost: '0', currency: 'USD', purchased_at: body.purchased_at }).purchased_at
      : existing.purchased_at;
    const notes = body.notes == null ? existing.notes : sealed.normalizeLot({
      quantity: 1, total_cost: '0', currency: 'USD', notes: body.notes,
    }).notes;
    let locationId = existing.location_id;
    if (Object.prototype.hasOwnProperty.call(body, 'location_id')) {
      locationId = body.location_id == null || body.location_id === '' ? null : Number(body.location_id);
      if (locationId != null && !Number.isSafeInteger(locationId)) return fail(res, 400, 'Storage location not found');
      if (locationId && !(await locationFor(req.user.id, locationId))) return fail(res, 400, 'Storage location not found');
    }
    await db.run(
      `UPDATE sealed_lot
          SET quantity = ?, remaining_quantity = ?, total_cost_cents = ?, remaining_cost_cents = ?,
              currency = ?, purchased_at = ?, location_id = ?, notes = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`,
      [
        lot.quantity, lot.remainingQuantity, lot.totalCostCents, lot.remainingCostCents,
        currency, purchasedAt, locationId, notes, existing.id, req.user.id,
      ]
    );
    const product = await ownedProduct(req.user.id, existing.product_id);
    const lots = await lotsFor(req.user.id, [product.id]);
    res.json({ product: presentProduct(product, lots.get(product.id) || []) });
  } catch (err) {
    if (err instanceof TypeError || err instanceof RangeError) return fail(res, 400, err.message);
    console.error('Failed to update sealed lot', err);
    fail(res, 500, 'Failed to update sealed lot');
  }
});

router.post('/sealed/lots/:id/archive', (req, res) => setLotArchived(req, res, true));
router.post('/sealed/lots/:id/restore', (req, res) => setLotArchived(req, res, false));

async function setLotArchived(req, res, archived) {
  try {
    const existing = await db.get(`SELECT * FROM sealed_lot WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    if (!existing) return fail(res, 404, 'Sealed lot not found');
    await db.run(
      `UPDATE sealed_lot SET archived_at = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      [archived ? new Date().toISOString() : null, existing.id, req.user.id]
    );
    const product = await ownedProduct(req.user.id, existing.product_id);
    const lots = await lotsFor(req.user.id, [product.id]);
    res.json({ product: presentProduct(product, lots.get(product.id) || []) });
  } catch (err) {
    console.error('Failed to archive sealed lot', err);
    fail(res, 500, 'Failed to archive sealed lot');
  }
}

router.get('/sealed/export', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT p.name, p.product_type, p.language, p.set_name, p.provider, p.provider_product_id,
              p.market_price_cents, p.market_currency,
              l.quantity, l.remaining_quantity, l.total_cost_cents, l.currency, l.purchased_at, l.notes,
              loc.name AS location_name
         FROM sealed_lot l
         JOIN sealed_product p ON p.id = l.product_id AND p.user_id = l.user_id
         LEFT JOIN locations loc ON loc.id = l.location_id AND loc.user_id = l.user_id
        WHERE l.user_id = ? AND l.archived_at IS NULL AND p.archived_at IS NULL
        ORDER BY p.name, l.id`,
      [req.user.id]
    );
    const csv = sealed.sealedCsv(rows.map(row => ({
      name: row.name,
      product_type: row.product_type,
      language: row.language,
      set_name: row.set_name || '',
      provider: row.provider || '',
      provider_product_id: row.provider_product_id || '',
      market_price: row.market_price_cents == null ? '' : sealed.centsToMoney(row.market_price_cents),
      market_currency: row.market_currency || '',
      quantity: row.quantity,
      remaining_quantity: row.remaining_quantity,
      total_cost: sealed.centsToMoney(row.total_cost_cents),
      currency: row.currency,
      purchased_at: row.purchased_at || '',
      location: row.location_name || '',
      notes: row.notes || '',
    })));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="sealed-inventory.csv"');
    res.send(csv);
  } catch (err) {
    console.error('Failed to export sealed inventory', err);
    fail(res, 500, 'Failed to export sealed inventory');
  }
});

router.post('/sealed/import', async (req, res) => {
  try {
    const parsed = sealed.parseSealedCsv(req.body && req.body.csv);
    if (parsed.errors.length) return res.status(400).json({ error: 'The file has invalid rows', errors: parsed.errors });
    const locations = await db.all(`SELECT id, name FROM locations WHERE user_id = ?`, [req.user.id]);
    const byName = new Map(locations.map(location => [location.name, location.id]));
    for (const row of parsed.rows) {
      if (!row.lot.location) continue;
      const id = byName.get(row.lot.location);
      if (!id) return fail(res, 400, `Storage location not found on line ${row.line}`);
      row.lot.location_id = id;
    }
    const created = await db.withTransaction(async () => {
      let products = 0;
      let lots = 0;
      for (const row of parsed.rows) {
        const productId = await findOrCreateProduct(req.user.id, row.product);
        if (productId.created) products += 1;
        await insertLot(req.user.id, productId.id, row.lot);
        lots += 1;
      }
      return { products, lots };
    });
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof TypeError || err instanceof RangeError) return fail(res, 400, err.message);
    console.error('Failed to import sealed inventory', err);
    fail(res, 500, 'Failed to import sealed inventory');
  }
});

async function findOrCreateProduct(userId, product) {
  let existing = null;
  if (product.provider && product.provider_product_id) {
    existing = await db.get(
      `SELECT id FROM sealed_product WHERE user_id = ? AND provider = ? AND provider_product_id = ?`,
      [userId, product.provider, product.provider_product_id]
    );
  } else {
    existing = await db.get(
      `SELECT id FROM sealed_product
        WHERE user_id = ? AND archived_at IS NULL AND provider_product_id = ''
          AND name = ? AND product_type = ? AND language = ? AND set_name = ?`,
      [userId, product.name, product.product_type, product.language, product.set_name]
    );
  }
  if (existing) {
    if (product.market_price_cents != null) {
      await db.run(
        `UPDATE sealed_product
            SET market_price_cents = ?, market_currency = ?, market_quoted_at = ?, market_source = 'manual',
                updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
        [product.market_price_cents, product.market_currency, new Date().toISOString(), existing.id, userId]
      );
    }
    return { id: existing.id, created: false };
  }
  const created = await db.run(
    `INSERT INTO sealed_product (
       user_id, name, product_type, language, set_id, set_name, image_url,
       provider, provider_product_id, market_price_cents, market_currency, market_quoted_at, market_source
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, product.name, product.product_type, product.language, product.set_id, product.set_name, product.image_url,
      product.provider, product.provider_product_id, product.market_price_cents, product.market_currency,
      product.market_price_cents == null ? null : new Date().toISOString(),
      product.market_price_cents == null ? '' : 'manual',
    ]
  );
  return { id: created.lastID, created: true };
}

module.exports = router;
