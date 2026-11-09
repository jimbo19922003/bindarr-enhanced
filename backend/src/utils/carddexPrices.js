'use strict';

const { collectorNumber, foldName } = require('./pokewalletMatch');
const { carddexSetId, matchesCarddexSet } = require('./carddexSets');

const positive = value => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

function providerId(card) {
  if (card.game !== 'pokemon' || card.language !== 'English' || !String(card.id).startsWith('tcgdex-en-')) return null;
  const id = card.id.slice('tcgdex-en-'.length);
  const set = carddexSetId(card);
  if (set !== card.set_id) {
    if (id !== `${card.set_id}-${card.number}`) return null;
    return `${set}-${card.number}`;
  }
  return id;
}

function extractCarddexQuote(card, body, now = Date.now()) {
  const id = providerId(card);
  const row = body?.data;
  if (!id || !row || row.id !== id || !matchesCarddexSet(card, row)
      || !foldName(card.name) || foldName(row.name) !== foldName(card.name)
      || !collectorNumber(card.number) || collectorNumber(row.number) !== collectorNumber(card.number)
      || !Array.isArray(row.prices)) return null;

  const prices = row.prices.filter(price => {
    const time = Date.parse(price?.recorded_at);
    return price?.card_id === id && price.variant_id == null
      && ((price.source === 'tcgplayer' && price.currency === 'USD')
        || (price.source === 'cardmarket' && price.currency === 'EUR'))
      && positive(price.trend_price)
      && Number.isFinite(time) && time <= now + 300000 && now - time <= 7 * 86400000;
  });
  const hasPrice = ['price_trend', 'price_normal', 'price_holofoil', 'price_reverse_holofoil', 'price_1st_edition']
    .some(field => positive(card[field]));
  const preferredCurrency = hasPrice && ['USD', 'EUR'].includes(card.price_currency) ? card.price_currency : null;
  const rank = price => price.currency === preferredCurrency ? 0 : price.currency === 'USD' ? 1 : 2;
  prices.sort((a, b) => rank(a) - rank(b)
    || Date.parse(b.recorded_at) - Date.parse(a.recorded_at));
  const price = prices[0];
  if (!price) return null;
  const finish = row.base_finish === 'holo' ? 'price_holofoil'
    : row.base_finish === 'normal' ? 'price_normal' : null;
  if (!finish) return null;
  return {
    amount: positive(price.trend_price),
    currency: price.currency,
    source: `carddex-${price.source}`,
    recordedAt: price.recorded_at,
    finish,
    avg1: positive(price.avg_1d),
    avg7: positive(price.avg_7d),
    avg30: positive(price.avg_30d),
  };
}

module.exports = { providerId, extractCarddexQuote };
