'use strict';

const fail = (status, message) => Object.assign(new Error(message), { status });

function positiveId(value, label) {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw fail(400, `${label} must be a positive integer`);
  }
  return Number(value);
}

function listingIds(ids) {
  if (!Array.isArray(ids)) throw fail(400, 'Entry ids must be an array');
  return [...new Set(ids.filter(id => typeof id === 'string' && /^sealed:[1-9]\d*$/.test(id))
    .map(id => Number(id.slice(7))).filter(Number.isSafeInteger))];
}

async function prepare(sql) {
  await sql.run(`CREATE TABLE IF NOT EXISTS trade_sealed_listing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lot_id INTEGER REFERENCES sealed_lot(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES sealed_product(id) ON DELETE CASCADE,
    list_type TEXT NOT NULL CHECK(list_type IN ('collection', 'wishlist')),
    quantity INTEGER,
    CHECK((list_type = 'collection' AND lot_id IS NOT NULL AND quantity IS NULL)
      OR (list_type = 'wishlist' AND lot_id IS NULL AND quantity IS NOT NULL
        AND typeof(quantity) = 'integer' AND quantity > 0))
  )`);
  await sql.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_sealed_lot
    ON trade_sealed_listing(user_id, lot_id) WHERE list_type = 'collection'`);
  await sql.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_sealed_wishlist
    ON trade_sealed_listing(user_id, product_id) WHERE list_type = 'wishlist'`);
}

async function rows(sql, userId, { ids, binderId } = {}) {
  const clauses = ['s.user_id = ?', 'p.archived_at IS NULL',
    `(s.list_type = 'wishlist' OR (l.id IS NOT NULL AND l.archived_at IS NULL AND l.remaining_quantity > 0))`];
  const params = [userId];
  if (ids !== undefined) {
    const selected = listingIds(ids);
    if (!selected.length) return [];
    clauses.push(`s.id IN (${selected.map(() => '?').join(',')})`);
    params.push(...selected);
  }
  if (binderId != null) {
    clauses.push(`EXISTS (SELECT 1 FROM trade_binder_item i
      JOIN trade_binder b ON b.id = i.binder_id AND b.user_id = s.user_id
      WHERE i.binder_id = ? AND i.entry_id = 'sealed:' || s.id)`);
    params.push(positiveId(binderId, 'Binder id'));
  }
  return sql.all(`SELECT 'sealed:' || s.id AS entry_id, 'sealed' AS kind, 'sealed' AS game,
      s.id AS listing_id, s.lot_id, s.product_id, p.name, p.set_name, p.product_type,
      p.language, p.image_url, p.set_id, p.provider, p.provider_product_id,
      s.list_type, p.market_price_cents, p.market_currency, l.currency,
      CASE WHEN s.list_type = 'wishlist' THEN s.quantity ELSE l.remaining_quantity END AS quantity
    FROM trade_sealed_listing s
    JOIN sealed_product p ON p.id = s.product_id AND p.user_id = s.user_id
    LEFT JOIN sealed_lot l ON l.id = s.lot_id AND l.user_id = s.user_id AND l.product_id = s.product_id
    WHERE ${clauses.join(' AND ')} ORDER BY p.name, s.id`, params);
}

// The caller owns the transaction, including binder cleanup.
async function unlist(sql, userId, entryIds) {
  const ids = listingIds(entryIds);
  if (!ids.length) return { removed: 0 };
  const marks = ids.map(() => '?').join(',');
  await sql.run(`DELETE FROM trade_binder_item
    WHERE binder_id IN (SELECT id FROM trade_binder WHERE user_id = ?)
      AND entry_id IN (SELECT 'sealed:' || id FROM trade_sealed_listing
        WHERE user_id = ? AND id IN (${marks}))`, [userId, userId, ...ids]);
  const result = await sql.run(`DELETE FROM trade_sealed_listing
    WHERE user_id = ? AND id IN (${marks})`, [userId, ...ids]);
  return { removed: result.changes };
}

async function setListing(sql, userId, input = {}) {
  const productId = positiveId(input.product_id, 'Product id');
  const lotId = input.lot_id == null ? null : positiveId(input.lot_id, 'Lot id');
  const listed = input.listed === undefined ? true : input.listed;
  if (typeof listed !== 'boolean') throw fail(400, 'Listed must be a boolean');
  const product = await sql.get('SELECT id, archived_at FROM sealed_product WHERE id = ? AND user_id = ?', [productId, userId]);
  if (!product) throw fail(404, 'Sealed product not found');
  const lot = lotId == null ? null : await sql.get(
    'SELECT id, archived_at, remaining_quantity FROM sealed_lot WHERE id = ? AND product_id = ? AND user_id = ?',
    [lotId, productId, userId]);
  if (lotId != null && !lot) throw fail(404, 'Sealed lot not found');
  const previous = await sql.get(`SELECT * FROM trade_sealed_listing
    WHERE user_id = ? AND product_id = ? AND lot_id IS ?`, [userId, productId, lotId]);
  if (!listed) {
    const entryId = previous ? `sealed:${previous.id}` : null;
    if (previous) await unlist(sql, userId, [entryId]);
    return { listed: false, entry_id: entryId, listing: null };
  }
  if (product.archived_at || (lot && (lot.archived_at || lot.remaining_quantity <= 0))) {
    throw fail(409, 'Only active products and remaining sealed lots can be listed');
  }
  const quantity = lotId == null
    ? positiveId(input.quantity === undefined ? (previous?.quantity ?? 1) : input.quantity, 'Wishlist quantity')
    : null;
  let id = previous?.id;
  if (previous) {
    await sql.run('UPDATE trade_sealed_listing SET quantity = ? WHERE id = ? AND user_id = ?', [quantity, id, userId]);
  } else {
    const created = await sql.run(`INSERT INTO trade_sealed_listing(user_id, lot_id, product_id, list_type, quantity)
      VALUES (?, ?, ?, ?, ?)`, [userId, lotId, productId, lotId == null ? 'wishlist' : 'collection', quantity]);
    id = created.lastID;
  }
  const listing = (await rows(sql, userId, { ids: [`sealed:${id}`] }))[0];
  return { listed: true, entry_id: `sealed:${id}`, listing };
}

module.exports = { prepare, rows, setListing, unlist };
