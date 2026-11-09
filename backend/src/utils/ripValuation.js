'use strict';
const db = require('../db');
const { resolveCardPrice } = require('./priceHelpers');
const { createReportingValuation } = require('./reportingValuation');

async function cardForPull(userId, pull) {
  const cardId = pull.cardId || pull.card_id;
  const collectionId = pull.collectionId || pull.collection_id;
  if (collectionId) {
    const copy = await db.get(`SELECT cc.*, c.card_id, c.printing, c.market_value
      FROM collection c JOIN card_cache cc ON cc.id = c.card_id
      WHERE c.id = ? AND c.user_id = ?`, [collectionId, userId]);
    if (copy && (!cardId || copy.card_id === cardId)) return copy;
  }
  if (!cardId) return null;
  const card = await db.get('SELECT * FROM card_cache WHERE id = ?', [cardId]);
  return card ? { ...card, printing: 'Normal' } : null;
}

async function applyPullPrice(pull, card, currency, { exactPrinting = false } = {}) {
  if (exactPrinting) {
    const field = { Normal: 'price_normal', Holofoil: 'price_holofoil', 'Reverse Holofoil': 'price_reverse_holofoil', '1st Edition': 'price_1st_edition' }[card?.printing];
    const price = field && Number(card?.[field]);
    if (!pull.currentBlank || !(price > 0) || !Number.isFinite(price)) return false;
    pull.currentUnit = Math.round((await createReportingValuation(currency).money(price, card.price_currency)) * 100);
    pull.currentBlank = false;
    return true;
  }
  if (!pull.currentBlank || !card || !(Number(resolveCardPrice(card)) > 0)) return false;
  const normalized = await createReportingValuation(currency).card(card);
  pull.currentUnit = Math.round(normalized.price_trend * 100);
  pull.currentBlank = false;
  return true;
}

// Repair derived current values only. Never invent an opening-date snapshot
// from today's quote, overwrite a nonblank value, or create collection copies.
async function repairUnpricedPulls(userId, openingIds) {
  if (Array.isArray(openingIds) && !openingIds.length) return 0;
  const restriction = Array.isArray(openingIds) ? ` AND sp.opening_id IN (${openingIds.map(() => '?').join(',')})` : '';
  const rows = await db.all(`SELECT sp.*, o.currency FROM sealed_pull sp
    JOIN sealed_opening o ON o.id = sp.opening_id AND o.user_id = sp.user_id
    WHERE sp.user_id = ? AND sp.card_id IS NOT NULL AND sp.card_id != ''
      AND sp.current_unit_cents IS NULL AND sp.current_line_cents IS NULL${restriction}`,
  [userId, ...(openingIds || [])]);
  let repaired = 0;
  for (const row of rows) {
    const card = await cardForPull(userId, row);
    const pull = { currentBlank: true };
    if (!(await applyPullPrice(pull, card, row.currency, { exactPrinting: true }))) continue;
    const result = await db.run(`UPDATE sealed_pull SET current_unit_cents = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ? AND current_unit_cents IS NULL AND current_line_cents IS NULL`,
    [pull.currentUnit, row.id, userId]);
    repaired += result.changes || 0;
  }
  return repaired;
}
module.exports = { cardForPull, applyPullPrice, repairUnpricedPulls };
