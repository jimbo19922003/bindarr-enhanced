'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const sealed = require('../utils/sealedInventory');
const catalog = require('../utils/sealedCatalog');

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
    catalog_category_id: row.catalog_category_id || null,
    catalog_group_id: row.catalog_group_id || null,
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

function optionalCatalogId(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new TypeError('Catalog id is not valid');
  return parsed;
}

// A price typed by hand is manual. A price that arrived with a catalog pick
// stays marked as the catalog, so a later refresh knows it may replace it.
function quoteSource(body, product) {
  if (product.market_price_cents == null) return '';
  const source = body && body.market_source;
  const owned = product.provider_product_id
    && ((source === 'tcgcsv' && product.provider === 'tcgcsv')
      || (source === 'pokewallet' && product.provider === 'pokewallet'));
  return owned ? source : 'manual';
}

router.get('/sealed/catalog', async (req, res) => {
  try {
    const found = await catalog.search(req.query.q || '');
    res.json(found);
  } catch (err) {
    if (err && err.status) return fail(res, err.status, err.message);
    if (err instanceof TypeError || err instanceof RangeError) return fail(res, 400, err.message);
    console.error('Failed to search sealed products', err);
    fail(res, 502, 'PokéWallet could not be reached.');
  }
});

router.post('/sealed/catalog/sync', requireAdmin, (req, res) => {
  res.status(202).json(catalog.startSync({ force: req.query.force === '1' }));
});

router.get('/sealed/catalog/status', requireAdmin, (_req, res) => {
  res.json(catalog.status());
});

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

// Writes one product and its lot. The caller owns the transaction, so a batch
// of products bought together either all land or none of them do.
async function writeProduct(userId, body) {
  const product = sealed.normalizeProduct(body);
  const lot = body.lot ? sealed.normalizeLot(body.lot) : null;
  const categoryId = optionalCatalogId(body.catalog_category_id);
  const groupId = optionalCatalogId(body.catalog_group_id);
  const source = quoteSource(body, product);
  const quotedAt = product.market_price_cents == null ? null : new Date().toISOString();
  if (lot && lot.location_id && !(await locationFor(userId, lot.location_id))) {
    throw new TypeError('Storage location not found');
  }
  if (product.provider && product.provider_product_id) {
    const existing = await db.get(
      `SELECT * FROM sealed_product WHERE user_id = ? AND provider = ? AND provider_product_id = ?`,
      [userId, product.provider, product.provider_product_id]
    );
    if (existing) {
      if (lot) await insertLot(userId, existing.id, lot);
      if (existing.market_source !== 'manual') {
        await db.run(
          `UPDATE sealed_product
              SET image_url = ?, catalog_category_id = ?, catalog_group_id = ?,
                  market_price_cents = ?, market_currency = ?, market_quoted_at = ?, market_source = ?,
                  updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
          [
            product.image_url || existing.image_url, categoryId, groupId,
            product.market_price_cents, product.market_currency, quotedAt, source,
            existing.id, userId,
          ]
        );
      } else if (product.image_url) {
        await db.run(
          `UPDATE sealed_product SET image_url = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
          [product.image_url, existing.id, userId]
        );
      }
      return existing.id;
    }
  }
  const created = await db.run(
    `INSERT INTO sealed_product (
       user_id, name, product_type, language, set_id, set_name, image_url,
       provider, provider_product_id, market_price_cents, market_currency,
       market_quoted_at, market_source, catalog_category_id, catalog_group_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, product.name, product.product_type, product.language, product.set_id, product.set_name,
      product.image_url, product.provider, product.provider_product_id, product.market_price_cents,
      product.market_currency, quotedAt, source, categoryId, groupId,
    ]
  );
  if (lot) await insertLot(userId, created.lastID, lot);
  return created.lastID;
}

async function presentOwned(userId, id) {
  const stored = await ownedProduct(userId, id);
  const lots = await lotsFor(userId, [id]);
  return presentProduct(stored, lots.get(id) || []);
}

router.post('/sealed/products', async (req, res) => {
  try {
    const id = await db.withTransaction(() => writeProduct(req.user.id, req.body || {}));
    const product = await presentOwned(req.user.id, id);
    const existed = product.lots.length > ((req.body && req.body.lot) ? 1 : 0);
    res.status(existed ? 200 : 201).json({ product, existed });
  } catch (err) {
    if (err instanceof TypeError || err instanceof RangeError) return fail(res, 400, err.message);
    if (String(err.message || '').includes('UNIQUE')) return fail(res, 409, 'A product with that provider id already exists');
    console.error('Failed to create sealed product', err);
    fail(res, 500, 'Failed to create sealed product');
  }
});

// Several products from one search. Shared purchase date, currency, and
// location apply to every line. Each line keeps its own quantity and cost.
router.post('/sealed/products/batch', async (req, res) => {
  try {
    const body = req.body || {};
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0) return fail(res, 400, 'Choose at least one product');
    if (items.length > 30) return fail(res, 400, 'Save at most 30 products at a time');
    const shared = body.shared || {};
    const ids = await db.withTransaction(async () => {
      const written = [];
      for (const item of items) {
        written.push(await writeProduct(req.user.id, {
          ...item,
          lot: {
            quantity: item.quantity,
            total_cost: item.total_cost,
            currency: item.currency || shared.currency,
            purchased_at: item.purchased_at || shared.purchased_at,
            location_id: item.location_id == null || item.location_id === '' ? shared.location_id : item.location_id,
            notes: item.notes || '',
          },
        }));
      }
      return written;
    });
    const products = [];
    for (const id of ids) products.push(await presentOwned(req.user.id, id));
    res.status(201).json({ products });
  } catch (err) {
    if (err instanceof TypeError || err instanceof RangeError) return fail(res, 400, err.message);
    if (String(err.message || '').includes('UNIQUE')) return fail(res, 409, 'A product with that provider id already exists');
    console.error('Failed to save sealed products', err);
    fail(res, 500, 'Failed to save sealed products');
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
    const priceChanged = product.market_price_cents !== existing.market_price_cents
      || product.market_currency !== existing.market_currency;
    const quotedAt = product.market_price_cents == null
      ? null
      : (priceChanged ? new Date().toISOString() : existing.market_quoted_at);
    const source = product.market_price_cents == null
      ? ''
      : (priceChanged ? 'manual' : (existing.market_source || 'manual'));
    await db.run(
      `UPDATE sealed_product
          SET name = ?, product_type = ?, language = ?, set_id = ?, set_name = ?, image_url = ?,
              provider = ?, provider_product_id = ?, market_price_cents = ?, market_currency = ?,
              market_quoted_at = ?, market_source = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`,
      [
        product.name, product.product_type, product.language, product.set_id, product.set_name, product.image_url,
        product.provider, product.provider_product_id, product.market_price_cents, product.market_currency, quotedAt,
        source,
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

router.post('/sealed/products/:id/quote', async (req, res) => {
  try {
    const existing = await ownedProduct(req.user.id, req.params.id);
    if (!existing) return fail(res, 404, 'Sealed product not found');
    const quote = await catalog.refreshOwned(existing);
    if (!quote) return fail(res, 404, 'This product is no longer in the sealed catalog');
    const cents = quote.market_price == null ? null : sealed.moneyToCents(quote.market_price, 'Market price');
    const source = cents != null && (quote.market_source === 'pokewallet' || quote.market_source === 'tcgcsv')
      ? quote.market_source
      : '';
    await db.run(
      `UPDATE sealed_product
          SET image_url = CASE WHEN ? != '' THEN ? ELSE image_url END,
              market_price_cents = ?, market_currency = ?, market_quoted_at = ?, market_source = ?,
              updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`,
      [
        quote.image_url, quote.image_url, cents, cents == null ? null : quote.market_currency,
        cents == null ? null : new Date().toISOString(), source,
        existing.id, req.user.id,
      ]
    );
    const stored = await ownedProduct(req.user.id, existing.id);
    const lots = await lotsFor(req.user.id, [existing.id]);
    res.json({ product: presentProduct(stored, lots.get(existing.id) || []) });
  } catch (err) {
    if (err && err.status) return fail(res, err.status, err.message);
    if (err instanceof TypeError || err instanceof RangeError) return fail(res, 400, err.message);
    console.error('Failed to refresh sealed quote', err);
    fail(res, 502, 'PokéWallet could not be reached.');
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
    const salesProtection = require('../utils/salesInventoryProtection');
    const hasSales = await salesProtection.hasSealedSales(db, existing.id, req.user.id);
    if (hasSales) salesProtection.validateSealedLotEdit(existing, body, sealed.moneyToCents);
    const opened = await db.get(
      `SELECT COUNT(*) AS n FROM sealed_opening WHERE lot_id = ? AND user_id = ?`,
      [existing.id, req.user.id]
    );
    if (opened.n > 0) {
      const nextQuantity = body.quantity == null ? existing.quantity : Number(body.quantity);
      const nextRemaining = body.remaining_quantity == null ? existing.remaining_quantity : Number(body.remaining_quantity);
      const nextCost = body.total_cost == null ? existing.total_cost_cents : sealed.moneyToCents(body.total_cost, 'Total cost');
      const nextCurrency = body.currency == null ? existing.currency : String(body.currency).trim().toUpperCase();
      const unchanged = nextQuantity === existing.quantity
        && nextRemaining === existing.remaining_quantity
        && nextCost === existing.total_cost_cents
        && nextCurrency === existing.currency;
      if (!unchanged) {
        return fail(res, 400, 'This lot has an opening, so its quantity and cost stay with that opening.');
      }
    }
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
    if (hasSales) lot.remainingCostCents = existing.remaining_cost_cents;
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
