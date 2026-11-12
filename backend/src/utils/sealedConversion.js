'use strict';

const sealed = require('./sealedInventory');
const { allocateOpeningCost } = require('./costBasis');
const { openingLineValue } = require('./openingWeights');
const fail = message => Object.assign(new Error(message), { status: 409 });

const CATALOG_PROVIDERS = new Set(['pokewallet', 'tcgcsv']);
const optionalCatalogId = value => (Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);

function normalizePacks(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 20) throw new TypeError('Provide between 1 and 20 pack groups');
  let count = 0;
  return raw.map(row => {
    const quantity = Number(row.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || (count += quantity) > 500) throw new TypeError('Provide between 1 and 500 packs in total');
    // A pack picked from the sealed catalog keeps that link and its quote, so the
    // pack product refreshes like one added through Add sealed. Anything else is
    // a hand-typed pack with no product-level quote.
    const linked = CATALOG_PROVIDERS.has(String(row.provider || '').toLowerCase()) && String(row.provider_product_id || '').trim() !== '';
    const product = sealed.normalizeProduct({
      ...row, product_type: 'booster_pack',
      provider: linked ? row.provider : '', provider_product_id: linked ? row.provider_product_id : '',
      market_price: linked ? row.catalog_market_price : '', market_currency: row.catalog_market_currency,
    });
    const marketSource = product.market_price_cents == null ? '' : (String(row.market_source || '') === product.provider ? product.provider : 'manual');
    const catalog = linked ? { categoryId: optionalCatalogId(row.catalog_category_id), groupId: optionalCatalogId(row.catalog_group_id), marketSource } : null;
    const marketUnitCents = row.market_value == null || row.market_value === '' ? null : sealed.moneyToCents(row.market_value, 'Pack market value');
    return { product, quantity, marketUnitCents, catalog };
  });
}

async function packProduct(db, userId, product, catalog) {
  const quotedAt = product.market_price_cents == null ? null : new Date().toISOString();
  if (catalog) {
    const linked = await db.get('SELECT * FROM sealed_product WHERE user_id = ? AND provider = ? AND provider_product_id = ?',
      [userId, product.provider, product.provider_product_id]);
    if (linked) {
      if (linked.market_source !== 'manual' && product.market_price_cents != null) {
        await db.run(`UPDATE sealed_product SET market_price_cents = ?, market_currency = ?, market_quoted_at = ?, market_source = ?,
          image_url = CASE WHEN ? != '' THEN ? ELSE image_url END, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
        [product.market_price_cents, product.market_currency, quotedAt, catalog.marketSource, product.image_url, product.image_url, linked.id, userId]);
      }
      return linked.id;
    }
  }
  const owned = await db.get(`SELECT id, provider_product_id FROM sealed_product WHERE user_id = ? AND product_type = 'booster_pack'
    AND name = ? AND language = ? AND set_id = ? AND set_name = ? AND archived_at IS NULL ORDER BY id LIMIT 1`,
  [userId, product.name, product.language, product.set_id, product.set_name]);
  if (owned && !catalog) return owned.id;
  // An unlinked pack product of the same name gains the catalog link it was missing.
  if (owned && !owned.provider_product_id) {
    await db.run(`UPDATE sealed_product SET provider = ?, provider_product_id = ?, image_url = CASE WHEN ? != '' THEN ? ELSE image_url END,
      market_price_cents = ?, market_currency = ?, market_quoted_at = ?, market_source = ?, catalog_category_id = ?, catalog_group_id = ?,
      updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    [product.provider, product.provider_product_id, product.image_url, product.image_url, product.market_price_cents, product.market_currency,
      quotedAt, catalog.marketSource, catalog.categoryId, catalog.groupId, owned.id, userId]);
    return owned.id;
  }
  return (await db.run(`INSERT INTO sealed_product (user_id, name, product_type, language, set_id, set_name, image_url, provider, provider_product_id,
    market_price_cents, market_currency, market_quoted_at, market_source, catalog_category_id, catalog_group_id)
    VALUES (?, ?, 'booster_pack', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [userId, product.name, product.language, product.set_id, product.set_name, product.image_url, product.provider, product.provider_product_id,
    product.market_price_cents, product.market_currency, quotedAt, catalog ? catalog.marketSource : '', catalog ? catalog.categoryId : null,
    catalog ? catalog.groupId : null])).lastID;
}

async function createPacks(userId, openingId, sourceLot, packs) {
  const db = require('../db');
  for (const { product, quantity, marketUnitCents, catalog } of packs) {
    const owned = { id: await packProduct(db, userId, product, catalog) };
    // Keep a stable identity for each physical pack. Pending allocations hold
    // all purchase cost on the parent until every market weight is available.
    for (let index = 0; index < quantity; index++) {
      const lot = await db.run(`INSERT INTO sealed_lot (user_id, product_id, quantity, remaining_quantity, total_cost_cents,
        remaining_cost_cents, currency, purchased_at, location_id) VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)`,
      [userId, owned.id, 0, 0, sourceLot.currency, sourceLot.purchased_at, sourceLot.location_id]);
      await db.run('INSERT INTO sealed_pack_lot (lot_id, opening_id, market_unit_cents) VALUES (?, ?, ?)', [lot.lastID, openingId, marketUnitCents]);
    }
  }
}

async function conversionFor(userId, requestId, hash) {
  const db = require('../db');
  const row = await db.get('SELECT * FROM sealed_product_conversion WHERE user_id = ? AND request_id = ?', [userId, requestId]);
  if (row && row.payload_hash !== hash) throw fail('This conversion request ID was already used for different contents');
  return row;
}

async function removePacks(userId, openingId) {
  const db = require('../db');
  const conversion = await db.get('SELECT * FROM sealed_product_conversion WHERE opening_id = ? AND user_id = ?', [openingId, userId]);
  if (!conversion) return null;
  const lots = await db.all(`SELECT l.* FROM sealed_lot l JOIN sealed_pack_lot p ON p.lot_id = l.id WHERE p.opening_id = ? AND l.user_id = ?`, [openingId, userId]);
  for (const lot of lots) {
    if (lot.remaining_quantity !== lot.quantity || lot.remaining_cost_cents !== lot.total_cost_cents
      || await db.get('SELECT id FROM sealed_opening WHERE lot_id = ? AND user_id = ?', [lot.id, userId])
      || await require('./salesInventoryProtection').hasSealedSales(db, lot.id, userId)) {
      throw fail('Remove child pack openings first. Packs with retained sale history prevent removing this conversion.');
    }
  }
  for (const lot of lots) await db.run('DELETE FROM sealed_lot WHERE id = ? AND user_id = ?', [lot.id, userId]);
  return conversion.source_cost_cents;
}

async function listConversions(userId, productId) {
  const db = require('../db');
  const rows = await db.all(`SELECT c.opening_id, c.source_cost_cents, c.allocation_status, c.allocation_json FROM sealed_product_conversion c
    JOIN sealed_opening o ON o.id = c.opening_id WHERE c.user_id = ? AND o.product_id = ?`, [userId, productId]);
  for (const row of rows) {
    row.source_cost = sealed.centsToMoney(row.source_cost_cents);
    row.allocation = row.allocation_json ? JSON.parse(row.allocation_json) : null;
    delete row.allocation_json;
    row.packs = await db.all(`SELECT l.id, l.product_id, l.quantity, l.remaining_quantity, l.currency,
      l.total_cost_cents, l.remaining_cost_cents, l.purchased_at,
      l.archived_at, p.name, p.language, p.set_id, p.set_name, p.archived_at AS product_archived_at,
      link.market_unit_cents, link.allocated_cost_cents
      FROM sealed_pack_lot link JOIN sealed_lot l ON l.id = link.lot_id JOIN sealed_product p ON p.id = l.product_id
      WHERE link.opening_id = ? AND l.user_id = ? AND p.user_id = ? ORDER BY l.id`, [row.opening_id, userId, userId]);
    for (const pack of row.packs) {
      pack.total_cost = sealed.centsToMoney(pack.total_cost_cents);
      pack.market_value = pack.market_unit_cents == null ? null : sealed.centsToMoney(pack.market_unit_cents);
    }
  }
  return rows;
}

async function finalizeAllocation(userId, openingId) {
  const db = require('../db');
  const row = await db.get('SELECT * FROM sealed_product_conversion WHERE user_id = ? AND opening_id = ?', [userId, openingId]);
  if (!row || row.allocation_status === 'finalized') return row?.allocation_status;
  const parent = await db.get('SELECT * FROM sealed_opening WHERE id = ? AND user_id = ?', [openingId, userId]);
  const packs = await db.all('SELECT * FROM sealed_pack_lot WHERE opening_id = ? ORDER BY lot_id', [openingId]);
  const promos = await db.all('SELECT * FROM sealed_pull WHERE opening_id = ? AND user_id = ? ORDER BY id', [openingId, userId]);
  const lines = [
    ...packs.map(pack => ({ id: `pack-${pack.lot_id}`, openingValueCents: pack.market_unit_cents })),
    ...promos.map(promo => ({ id: `promo-${promo.id}`, openingValueCents: openingLineValue(promo) })),
  ];
  if (!parent.entry_complete || lines.some(line => line.openingValueCents == null)) return 'pending';
  const allocation = allocateOpeningCost(row.source_cost_cents, lines, { complete: true });
  if (allocation.status !== 'allocated') return 'pending';
  const costs = new Map(allocation.allocations.map(line => [line.id, line.costCents]));
  for (const pack of packs) {
    const cost = costs.get(`pack-${pack.lot_id}`);
    await db.run('UPDATE sealed_pack_lot SET allocated_cost_cents = ? WHERE lot_id = ?', [cost, pack.lot_id]);
    await db.run(`UPDATE sealed_lot SET total_cost_cents = ?, remaining_cost_cents = CASE WHEN remaining_quantity = 1 THEN ? ELSE 0 END,
      updated_at = datetime('now') WHERE id = ? AND user_id = ?`, [cost, cost, pack.lot_id, userId]);
    await db.run(`UPDATE sealed_opening SET cost_cents = ?, cost_pending = 0, updated_at = datetime('now')
      WHERE lot_id = ? AND user_id = ?`, [cost, pack.lot_id, userId]);
  }
  const promoCost = promos.reduce((sum, promo) => sum + costs.get(`promo-${promo.id}`), 0);
  await db.run(`UPDATE sealed_opening SET cost_cents = ?, cost_pending = 0, updated_at = datetime('now') WHERE id = ? AND user_id = ?`, [promoCost, openingId, userId]);
  const snapshot = { method: 'relative-opening-market-value', currency: parent.currency, sourceCostCents: row.source_cost_cents, lines, allocations: allocation.allocations };
  await db.run("UPDATE sealed_product_conversion SET allocation_status = 'finalized', allocation_json = ? WHERE opening_id = ? AND user_id = ?", [JSON.stringify(snapshot), openingId, userId]);
  return 'finalized';
}

async function pendingLot(connection, userId, lotId) {
  if (!await connection.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sealed_pack_lot'")) return false;
  return !!await connection.get(`SELECT p.lot_id FROM sealed_pack_lot p JOIN sealed_product_conversion c ON c.opening_id = p.opening_id
    WHERE p.lot_id = ? AND c.user_id = ? AND c.allocation_status = 'pending'`, [lotId, userId]);
}

async function pendingCopy(connection, userId, collectionId) {
  if (!await connection.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sealed_product_conversion'")) return false;
  return !!await connection.get(`SELECT p.id FROM sealed_pull p JOIN sealed_opening o ON o.id = p.opening_id AND o.user_id = p.user_id
    WHERE p.user_id = ? AND o.cost_pending = 1 AND (p.collection_id = ? OR instr(',' || replace(COALESCE(p.filed_ids, ''), ' ', '') || ',', ',' || ? || ',') > 0) LIMIT 1`,
  [userId, collectionId, String(collectionId)]);
}

module.exports = { normalizePacks, createPacks, conversionFor, removePacks, listConversions, finalizeAllocation, pendingLot, pendingCopy };
