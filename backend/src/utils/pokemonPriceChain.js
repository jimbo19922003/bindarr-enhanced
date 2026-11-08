'use strict';

const db = require('../db');
const { recordPrice } = require('./priceHelpers');

let carddexCatalog = null;
let pokewallet = null;

function getCarddexCatalog() {
  if (!carddexCatalog) {
    carddexCatalog = require('./carddexCatalog').getCarddexCatalog();
  }
  return carddexCatalog;
}

function getPokewallet() {
  if (!pokewallet) {
    pokewallet = require('../pokewalletApi');
  }
  return pokewallet;
}

function hasPositivePrice(card) {
  return ['price_trend', 'price_normal', 'price_holofoil', 'price_reverse_holofoil', 'price_1st_edition']
    .some((col) => Number(card[col]) > 0);
}

async function applyPriceToCard(cardId, priceData) {
  if (!priceData || priceData.price_trend == null) return false;

  const result = await db.run(
    `UPDATE card_cache
     SET price_trend = ?,
         price_normal = ?,
         price_holofoil = ?,
         price_reverse_holofoil = ?,
         price_1st_edition = ?,
         price_currency = ?,
         price_source = ?,
         last_updated = CURRENT_TIMESTAMP
     WHERE id = ?
       AND (
         COALESCE(price_trend, 0) <= 0
         AND COALESCE(price_normal, 0) <= 0
         AND COALESCE(price_holofoil, 0) <= 0
         AND COALESCE(price_reverse_holofoil, 0) <= 0
         AND COALESCE(price_1st_edition, 0) <= 0
       )`,
    [
      priceData.price_trend,
      priceData.price_normal || null,
      priceData.price_holofoil || null,
      priceData.price_reverse_holofoil || null,
      priceData.price_1st_edition || null,
      priceData.price_currency || 'USD',
      priceData.price_source || 'carddex',
      cardId,
    ]
  );

  if (result?.changes > 0) {
    await recordPrice(cardId, priceData.price_trend);
    return true;
  }
  return false;
}

async function priceCardOnAdd(card) {
  if (!card) return { source: null, applied: false };

  if (card.game !== 'pokemon') {
    return { source: 'not_pokemon', applied: false };
  }

  if (hasPositivePrice(card)) {
    return { source: 'existing', applied: false };
  }

  const isEnglish = card.language === 'English';
  const isTcgdexId = String(card.id || '').startsWith('tcgdex-en-');

  if (isEnglish && isTcgdexId) {
    try {
      const carddex = getCarddexCatalog();
      const result = await carddex.getCardPrice(card);

      if (result.price_trend != null && result.price_trend > 0) {
        const applied = await applyPriceToCard(card.id, result);
        console.log(`[price-chain] CardDex price for ${card.id}: ${result.price_trend} ${result.price_currency} (applied: ${applied})`);
        return { source: 'carddex', applied, ...result };
      }
      console.log(`[price-chain] CardDex had no price for ${card.id}, trying PokéWallet...`);
    } catch (err) {
      console.warn(`[price-chain] CardDex failed for ${card.id}: ${err.code || err.message}`);
    }
  }

  try {
    const pw = getPokewallet();
    const report = await pw.priceUnpricedCard(card);

    if (report && report.updated > 0) {
      const refreshed = await db.get(`SELECT * FROM card_cache WHERE id = ?`, [card.id]);
      if (refreshed && hasPositivePrice(refreshed)) {
        console.log(`[price-chain] PokéWallet priced ${card.id}: ${refreshed.price_trend} ${refreshed.price_currency}`);
        return {
          source: 'pokewallet',
          applied: true,
          price_trend: refreshed.price_trend,
          price_currency: refreshed.price_currency,
        };
      }
    }
    console.log(`[price-chain] PokéWallet had no price for ${card.id}`);
  } catch (err) {
    if (!['rate_limited', 'key_missing', 'key_rejected'].includes(err.code)) {
      console.warn(`[price-chain] PokéWallet failed for ${card.id}: ${err.code || err.message}`);
    }
  }

  const cached = await db.get(`SELECT * FROM card_cache WHERE id = ?`, [card.id]);
  if (cached && hasPositivePrice(cached)) {
    console.log(`[price-chain] Using cached price for ${card.id}: ${cached.price_trend}`);
    return {
      source: 'cache',
      applied: false,
      price_trend: cached.price_trend,
      price_currency: cached.price_currency,
    };
  }

  console.log(`[price-chain] No price available for ${card.id}`);
  return { source: null, applied: false };
}

async function priceSealedOnAdd(product) {
  if (!product) return { source: null, price: null };

  try {
    const carddex = getCarddexCatalog();
    const result = await carddex.getSealedPrice(product);

    if (result.price != null) {
      console.log(`[price-chain] CardDex sealed price for ${product.name}: ${result.price} ${result.currency}`);
      return result;
    }
  } catch (err) {
    console.warn(`[price-chain] CardDex sealed failed: ${err.code || err.message}`);
  }

  try {
    const pw = getPokewallet();
    const fetched = await pw.fetchProduct(product.provider_product_id);

    if (fetched?.body?.card_info?.market_price) {
      const price = fetched.body.card_info.market_price;
      console.log(`[price-chain] PokéWallet sealed price for ${product.name}: ${price}`);
      return { source: 'pokewallet', price, currency: 'USD' };
    }
  } catch (err) {
    if (!['rate_limited', 'key_missing', 'key_rejected', 'not_found'].includes(err.code)) {
      console.warn(`[price-chain] PokéWallet sealed failed: ${err.code || err.message}`);
    }
  }

  return { source: null, price: null };
}

async function searchCardsWithPricing(query, options = {}) {
  const isEnglish = !options.lang || options.lang === 'en' || options.lang === 'English';

  if (isEnglish) {
    try {
      const carddex = getCarddexCatalog();
      const result = await carddex.searchCards(query, options);

      if (result.cards && result.cards.length > 0) {
        console.log(`[price-chain] CardDex search returned ${result.cards.length} cards`);
        return result;
      }
    } catch (err) {
      console.warn(`[price-chain] CardDex search failed: ${err.code || err.message}`);
    }
  }

  return { cards: [], total: 0, source: 'fallback' };
}

async function searchSealedWithPricing(query) {
  try {
    const carddex = getCarddexCatalog();
    const result = await carddex.searchSealed(query);

    if (result.products && result.products.length > 0) {
      console.log(`[price-chain] CardDex sealed search returned ${result.products.length} products`);
      return result;
    }
  } catch (err) {
    console.warn(`[price-chain] CardDex sealed search failed: ${err.code || err.message}`);
  }

  const sealedCatalog = require('./sealedCatalog');
  return sealedCatalog.search(query);
}

module.exports = {
  priceCardOnAdd,
  priceSealedOnAdd,
  searchCardsWithPricing,
  searchSealedWithPricing,
  hasPositivePrice,
  applyPriceToCard,
};
