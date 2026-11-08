'use strict';
const db = require('../db');
const { summarizeHoldings, emptyHoldings } = require('./sealedInventory');
const round = n => Number(n.toFixed(2));

async function cardRows(userId, game) {
  return db.all(`SELECT cc.*, cc.id AS card_id, c.id AS entry_id, c.quantity, c.purchase_price,
    c.added_at, c.printing, c.condition, c.market_value, c.language, c.is_trade, c.favorite,
    c.list_type, c.grader, c.grade, c.location_id, l.name AS location_name, l.type AS location_type
    FROM collection c JOIN card_cache cc ON cc.id = c.card_id
    LEFT JOIN locations l ON l.id = c.location_id
    WHERE c.user_id = ? AND c.list_type = 'collection'${game ? ' AND cc.game = ?' : ''}`,
  game ? [userId, game] : [userId]);
}

async function sealedData(userId, game, valuation) {
  if (game && game !== 'pokemon') return { holdings: emptyHoldings(), spent: 0, lines: [] };
  const lots = await db.all(`SELECT l.*, p.name, p.set_id, p.set_name, p.image_url, p.product_type,
    p.market_price_cents, p.market_currency FROM sealed_lot l
    JOIN sealed_product p ON p.id = l.product_id AND p.user_id = l.user_id
    WHERE l.user_id = ? AND l.archived_at IS NULL AND p.archived_at IS NULL`, [userId]);
  let spent = 0;
  const holdingsRows = [];
  const byProduct = new Map();
  for (const lot of lots) {
    spent += (await valuation.cents(lot.total_cost_cents, lot.currency)) / 100;
    const price = await valuation.cents(lot.market_price_cents, lot.market_currency || 'USD');
    holdingsRows.push({ remainingQuantity: lot.remaining_quantity,
      remainingCostCents: await valuation.cents(lot.remaining_cost_cents, lot.currency),
      currency: valuation.target, marketPriceCents: price, marketCurrency: valuation.target });
    if (!(lot.remaining_quantity > 0)) continue;
    const previous = byProduct.get(lot.product_id);
    if (previous) previous.remaining += lot.remaining_quantity;
    else byProduct.set(lot.product_id, { id: lot.product_id, name: lot.name, set_id: lot.set_id,
      set_name: lot.set_name || '', image_url: lot.image_url || '', product_type: lot.product_type,
      market_price_cents: price, market_price: price == null ? null : (price / 100).toFixed(2),
      market_currency: valuation.target, remaining: lot.remaining_quantity });
  }
  const lines = [...byProduct.values()].map(line => ({ ...line,
    line_value: line.market_price_cents == null ? null : round(line.market_price_cents * line.remaining / 100) }));
  return { holdings: summarizeHoldings(holdingsRows), spent: round(spent), lines };
}

async function currentPortfolio(userId, game, valuation) {
  const raw = await cardRows(userId, game);
  const cards = [];
  let cardValueCents = 0, cardSpentCents = 0, totalCards = 0;
  const byGame = {};
  for (const source of raw) {
    const card = await valuation.card(source);
    card.purchase_price = await valuation.money(source.purchase_price || 0, 'USD');
    const quantity = source.quantity || 1;
    const unitCents = Math.round(card.price_trend * 100);
    totalCards += quantity;
    cardValueCents += quantity * unitCents;
    cardSpentCents += quantity * Math.round(card.purchase_price * 100);
    if (!Number.isSafeInteger(cardValueCents) || !Number.isSafeInteger(cardSpentCents)) throw new RangeError('Portfolio value is too large');
    const gameKey = source.game || 'unknown';
    if (!byGame[gameKey]) byGame[gameKey] = { cards: 0, value: 0 };
    byGame[gameKey].cards += quantity; byGame[gameKey].value += quantity * unitCents / 100;
    cards.push(card);
  }
  const sealed = await sealedData(userId, game, valuation);
  return { cards, totalCards, cardValue: cardValueCents / 100,
    totalValue: round(cardValueCents / 100 + sealed.holdings.marketValue),
    totalSpent: round(cardSpentCents / 100 + sealed.spent), sealed,
    byGame: Object.fromEntries(Object.entries(byGame).map(([key, value]) => [key, { ...value, value: round(value.value) }])) };
}


module.exports = { currentPortfolio };
