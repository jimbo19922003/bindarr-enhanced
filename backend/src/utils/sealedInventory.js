'use strict';

// Sealed products are a catalog. Purchase lots are the owned stock.
// A market quote lives on the product. What was paid lives on the lot, in
// integer minor units. Nothing here converts currencies or treats a missing
// quote as zero.

const PRODUCT_TYPES = Object.freeze([
  'booster_box',
  'booster_pack',
  'etb',
  'tin',
  'collection_box',
  'blister',
  'other',
]);

const CSV_COLUMNS = Object.freeze([
  'name',
  'product_type',
  'language',
  'set_name',
  'provider',
  'provider_product_id',
  'market_price',
  'market_currency',
  'quantity',
  'remaining_quantity',
  'total_cost',
  'currency',
  'purchased_at',
  'location',
  'notes',
]);

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function currencyCode(value, name) {
  const text = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(text)) throw new TypeError(`${name} must be a three-letter currency code`);
  return text;
}

// A decimal string is exact. A number is rounded to the nearest cent, because
// 19.99 * 100 is not an integer in binary. More than two decimal places are
// rejected rather than silently rounded, so "1.005" cannot become either cent.
function moneyToCents(value, name) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative amount`);
    const cents = Math.round(value * 100);
    if (!Number.isSafeInteger(cents)) throw new TypeError(`${name} is too large`);
    return cents;
  }
  const text = String(value == null ? '' : value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new TypeError(`${name} must be a non-negative amount with at most 2 decimal places`);
  }
  const [major, minor = ''] = text.split('.');
  const cents = BigInt(major) * 100n + BigInt(minor.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError(`${name} is too large`);
  return Number(cents);
}

function centsToMoney(cents) {
  integer(cents, 'cents');
  const major = Math.floor(cents / 100);
  const minor = String(cents % 100).padStart(2, '0');
  return `${major}.${minor}`;
}

// Cost left on the shelf after `quantity - remainingQuantity` units are no
// longer sealed. Division is toward zero. The last units keep the leftover
// cent, so the original total is preserved exactly and no unit is priced by
// rounding a per-item average.
function remainingCostCents({ quantity, totalCostCents, remainingQuantity }) {
  integer(quantity, 'quantity', 1);
  integer(totalCostCents, 'totalCostCents');
  integer(remainingQuantity, 'remainingQuantity');
  if (remainingQuantity > quantity) throw new RangeError('Remaining quantity cannot exceed the purchased quantity');
  if (remainingQuantity === quantity) return totalCostCents;
  if (remainingQuantity === 0) return 0;
  const consumed = quantity - remainingQuantity;
  const consumedCost = Number(BigInt(totalCostCents) * BigInt(consumed) / BigInt(quantity));
  return totalCostCents - consumedCost;
}

// Editing the purchased count of a lot that is still fully sealed keeps it
// fully sealed. A lot that already has some units out keeps that remaining
// count, capped by the new purchased count.
function nextLot(previous, patch) {
  const quantity = patch.quantity != null ? integer(patch.quantity, 'quantity', 1) : previous.quantity;
  const totalCostCents = patch.totalCostCents != null
    ? integer(patch.totalCostCents, 'totalCostCents')
    : previous.totalCostCents;
  let remaining = patch.remainingQuantity != null
    ? integer(patch.remainingQuantity, 'remainingQuantity')
    : previous.remainingQuantity;
  if (patch.quantity != null && patch.remainingQuantity == null && previous.remainingQuantity === previous.quantity) {
    remaining = quantity;
  }
  if (remaining > quantity) throw new RangeError('Remaining quantity cannot exceed the purchased quantity');
  return {
    quantity,
    totalCostCents,
    remainingQuantity: remaining,
    remainingCostCents: remainingCostCents({ quantity, totalCostCents, remainingQuantity: remaining }),
  };
}

function cleanDate(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new TypeError('Purchase date must be YYYY-MM-DD');
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TypeError('Purchase date is not a real date');
  }
  return text;
}

function cleanImageUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length > 500) throw new TypeError('Image URL is too long');
  let url;
  try { url = new URL(text); } catch { throw new TypeError('Image URL must be an http(s) address'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('Image URL must be an http(s) address');
  if (url.username || url.password) throw new TypeError('Image URL must not include credentials');
  return url.toString();
}

function boundedText(value, name, max, required) {
  const text = String(value == null ? '' : value).trim();
  if (required && !text) throw new TypeError(`${name} is required`);
  if (text.length > max) throw new TypeError(`${name} is too long`);
  return text;
}

function productType(value) {
  const text = String(value || '').trim();
  if (!PRODUCT_TYPES.includes(text)) throw new TypeError('Product type is not recognized');
  return text;
}

function normalizeProduct(input) {
  const body = input || {};
  const marketBlank = body.market_price == null || body.market_price === '';
  const marketCents = marketBlank ? null : moneyToCents(body.market_price, 'Market price');
  const marketCurrency = marketCents == null ? null : currencyCode(body.market_currency, 'Market currency');
  return {
    name: boundedText(body.name, 'Name', 200, true),
    product_type: productType(body.product_type),
    language: boundedText(body.language || 'English', 'Language', 40, true),
    set_id: boundedText(body.set_id, 'Set id', 40, false),
    set_name: boundedText(body.set_name, 'Set', 120, false),
    image_url: cleanImageUrl(body.image_url),
    provider: boundedText(body.provider, 'Provider', 32, false).toLowerCase(),
    provider_product_id: boundedText(body.provider_product_id, 'Provider product id', 128, false),
    market_price_cents: marketCents,
    market_currency: marketCurrency,
  };
}

function normalizeLot(input) {
  const body = input || {};
  const quantity = integer(Number(body.quantity), 'quantity', 1);
  const totalCostCents = moneyToCents(body.total_cost, 'Total cost');
  const remainingQuantity = body.remaining_quantity == null || body.remaining_quantity === ''
    ? quantity
    : integer(Number(body.remaining_quantity), 'remainingQuantity');
  return {
    quantity,
    totalCostCents,
    remainingQuantity,
    remainingCostCents: remainingCostCents({ quantity, totalCostCents, remainingQuantity }),
    currency: currencyCode(body.currency, 'Currency'),
    purchased_at: cleanDate(body.purchased_at),
    notes: boundedText(body.notes, 'Notes', 2000, false),
    location: boundedText(body.location, 'Location', 120, false),
    location_id: body.location_id == null || body.location_id === '' ? null : integer(Number(body.location_id), 'location_id', 1),
  };
}

// Known market cents are summed. A null quote is unpriced and is left out,
// including from the zero bucket. Cost is the remaining basis, not the
// original purchase, so a unit that is no longer sealed is not still valued.
function summarizeHoldings(rows) {
  let remainingUnits = 0;
  let unpricedUnits = 0;
  let marketCents = 0;
  let costCents = 0;
  const currencies = new Set();
  for (const row of rows || []) {
    const qty = integer(row.remainingQuantity, 'remainingQuantity');
    if (qty === 0) continue;
    remainingUnits += qty;
    const costLine = integer(row.remainingCostCents, 'remainingCostCents');
    if (!Number.isSafeInteger(costCents + costLine)) throw new RangeError('Sealed cost is too large');
    costCents += costLine;
    currencies.add(currencyCode(row.currency, 'Currency'));
    if (row.marketPriceCents == null) {
      unpricedUnits += qty;
      continue;
    }
    const marketLine = integer(row.marketPriceCents, 'marketPriceCents') * qty;
    if (!Number.isSafeInteger(marketLine) || !Number.isSafeInteger(marketCents + marketLine)) {
      throw new RangeError('Sealed market value is too large');
    }
    marketCents += marketLine;
    if (row.marketCurrency) currencies.add(currencyCode(row.marketCurrency, 'Market currency'));
  }
  const money = (cents) => parseFloat((cents / 100).toFixed(2));
  return {
    remainingUnits,
    unpricedUnits,
    marketValue: money(marketCents),
    cost: money(costCents),
    currencies: [...currencies].sort(),
    valuationComplete: unpricedUnits === 0,
  };
}

function emptyHoldings() {
  return { remainingUnits: 0, unpricedUnits: 0, marketValue: 0, cost: 0, currencies: [], valuationComplete: true };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter(cells => cells.some(value => String(value).trim() !== ''));
}

function parseSealedCsv(text) {
  const table = parseCsv(text);
  if (table.length < 2) throw new TypeError('The file needs a header and one row');
  const header = table[0].map(cell => String(cell || '').trim().toLowerCase());
  for (const required of ['name', 'product_type', 'quantity', 'total_cost', 'currency']) {
    if (!header.includes(required)) throw new TypeError(`Missing column ${required}`);
  }
  const errors = [];
  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const record = {};
    header.forEach((name, index) => { record[name] = table[i][index] == null ? '' : String(table[i][index]).trim(); });
    try {
      const product = normalizeProduct({
        name: record.name,
        product_type: record.product_type,
        language: record.language || 'English',
        set_name: record.set_name,
        provider: record.provider,
        provider_product_id: record.provider_product_id,
        market_price: record.market_price,
        market_currency: record.market_currency,
      });
      const lot = normalizeLot({
        quantity: record.quantity,
        remaining_quantity: record.remaining_quantity,
        total_cost: record.total_cost,
        currency: record.currency,
        purchased_at: record.purchased_at,
        notes: record.notes,
        location: record.location,
      });
      rows.push({ line: i + 1, product, lot });
    } catch (err) {
      errors.push({ line: i + 1, error: err.message });
    }
  }
  return { rows, errors };
}

function sealedCsv(records) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const record of records) {
    lines.push(CSV_COLUMNS.map(column => csvCell(record[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  PRODUCT_TYPES,
  CSV_COLUMNS,
  moneyToCents,
  centsToMoney,
  remainingCostCents,
  nextLot,
  normalizeProduct,
  normalizeLot,
  summarizeHoldings,
  emptyHoldings,
  parseSealedCsv,
  sealedCsv,
};
