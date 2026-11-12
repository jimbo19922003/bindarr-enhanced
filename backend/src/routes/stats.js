const express = require('express');
const db = require('../db');
const { resolveCardPrice, isVintageSet, parseSqliteUtc, FINISH_COLUMNS } = require('../utils/priceHelpers');
const { summarizeHoldings } = require('../utils/sealedInventory');
const { summarizePerformance } = require('../utils/openingPerformance');
const { createReportingValuation } = require('../utils/reportingValuation');
const { currentPortfolio } = require('../utils/currentPortfolio');
const { createDashboardSetTotals, setKey } = require('../utils/dashboardSetTotals');
const { readSetCompletion } = require('../utils/setCompletion');
const router = express.Router();
const round = n => Number(n.toFixed(2));

async function openingPerformanceFor(userId, game) {
  if (game && game !== 'pokemon') return summarizePerformance([]);
  const rows = await db.all(`SELECT o.id AS opening_id, o.product_id, o.quantity AS units, o.cost_cents, o.currency,
    o.entry_complete, p.set_name, p.product_type, source.product_type AS source_type, sp.quantity AS pull_quantity,
    sp.current_unit_cents, sp.current_line_cents, sp.opened_unit_cents, sp.opened_line_cents
    FROM sealed_opening o JOIN sealed_product p ON p.id = o.product_id AND p.user_id = o.user_id
    LEFT JOIN sealed_pack_lot pack ON pack.lot_id = o.lot_id
    LEFT JOIN sealed_opening parent ON parent.id = pack.opening_id AND parent.user_id = o.user_id
    LEFT JOIN sealed_product source ON source.id = parent.product_id AND source.user_id = o.user_id
    LEFT JOIN sealed_pull sp ON sp.opening_id = o.id AND sp.user_id = o.user_id
    WHERE o.user_id = ? ORDER BY o.id, sp.id`, [userId]);
  return summarizePerformance(rows);
}

function failure(res, error, fallback) {
  console.error(error.code || fallback, error.message);
  res.status(error.status || 500).json({ error: error.status ? error.message : fallback, code: error.code || 'STATISTICS_ERROR' });
}

router.get('/stats', async (req, res) => {
  try {
    const { game } = req.query;
    const valuation = createReportingValuation(req.query.currency || 'USD');
    const portfolio = await currentPortfolio(req.user.id, game, valuation);
    const rows = portfolio.cards;
    const types = {}, rarities = {}, locations = {};
    const sets = createDashboardSetTotals({
      onConflict: ({ game, id }) => console.warn(`Dashboard set ID has conflicting names: ${game || 'unknown'} / ${id}`),
    });
    let unsortedCount = 0, nearMintCount = 0, vintageCount = 0, unpricedCards = 0;
    let value7dAgo = 0, valueNowFor7d = 0, value30dAgo = 0, valueNowFor30d = 0;
    const now = Date.now();
    const cardQuantities = new Map();
    for (const row of rows) {
      const quantity = row.quantity || 1;
      const cardId = row.card_id;
      const unitCents = Math.round(row.price_trend * 100);
      const group = cardQuantities.get(cardId) || { quantity: 0, valueCents: 0, keeperCents: 0 };
      group.quantity += quantity;
      group.valueCents += quantity * unitCents;
      group.keeperCents = Math.max(group.keeperCents, unitCents);
      cardQuantities.set(cardId, group);
      if (!row.location_name) unsortedCount += quantity;
      if (row.condition === 'Near Mint') nearMintCount += quantity;
      if (isVintageSet(row.set_id)) vintageCount += quantity;
      if (!(row.price_trend > 0)) unpricedCards += quantity;
      const cardTypes = JSON.parse(row.types || '[]');
      const subtypes = JSON.parse(row.subtypes || '[]');
      const mtg = row.game === 'mtg' || row.supertype === 'MTG';
      const land = mtg && (subtypes.includes('Land') || row.supertype === 'Land' ||
        (!cardTypes.length && subtypes.some(name => ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Land'].includes(name))));
      for (const type of land ? ['Land'] : cardTypes.length ? cardTypes : [mtg ? 'Colorless' : 'Colorless']) types[type] = (types[type] || 0) + quantity;
      const rarity = row.rarity || 'Unknown'; rarities[rarity] = (rarities[rarity] || 0) + quantity;
      const location = row.location_name || 'Unassigned'; locations[location] = (locations[location] || 0) + quantity;
      sets.add({ game: row.game, id: row.set_id, name: row.set_name, count: quantity, value: quantity * row.price_trend });
      // Historical averages retain their source currency and are converted
      // before comparing amounts; current-FX basis, not historical-date FX.
      const added = row.added_at ? parseSqliteUtc(row.added_at).getTime() : now;
      if (row.price_avg1 > 0 && (row.price_avg7 > 0 || row.price_avg30 > 0)) {
        const currency = row.source_quote.currency;
        const avg1 = await valuation.money(row.price_avg1, currency);
        if (added <= now - 7 * 86400000 && row.price_avg7 > 0) { value7dAgo += quantity * await valuation.money(row.price_avg7, currency); valueNowFor7d += quantity * avg1; }
        if (added <= now - 30 * 86400000 && row.price_avg30 > 0) { value30dAgo += quantity * await valuation.money(row.price_avg30, currency); valueNowFor30d += quantity * avg1; }
      }
    }
    const cardSets = sets.list();
    const sealedBySet = new Map(), sealedByType = new Map();
    const addBucket = (map, key, name, line) => {
      const bucket = map.get(key) || { name, units: 0, value: 0, unpriced: 0 };
      bucket.units += line.remaining; bucket.value += line.line_value || 0;
      if (line.line_value == null) bucket.unpriced += line.remaining; map.set(key, bucket);
    };
    for (const line of portfolio.sealed.lines) {
      const key = setKey('pokemon', line.set_id, line.set_name);
      addBucket(sealedBySet, key, line.set_name, line); addBucket(sealedByType, line.product_type || 'other', line.product_type || 'other', line);
      if (line.line_value == null) continue;
      sets.add({ game: 'pokemon', id: line.set_id, name: line.set_name, value: line.line_value });
    }
    const setProgress = await readSetCompletion(db, req.user.id, game);
    const change = (before, after) => before > 0 ? { available: true, abs: round(after - before), pct: round((after - before) / before * 100) } : { available: false, abs: null, pct: null };
    const unavailable = () => ({ available: false, abs: null, pct: null });
    const gain = round(portfolio.totalValue - portfolio.totalSpent);
    let dayChange;
    try {
      dayChange = await require('../utils/portfolioDayChange').portfolioDayChange(db, req.user.id, game, valuation, portfolio.totalValue, now);
    } catch (error) {
      if (error.code !== 'VALUATION_FX_UNAVAILABLE') throw error;
      console.warn('Portfolio day change unavailable:', error.message);
      dayChange = { unavailable: true };
    }
    const metadata = valuation.metadata();
    const bucketList = map => [...map.values()].map(row => ({ ...row, value: round(row.value) })).sort((a, b) => b.value - a.value || b.units - a.units);
    const uniqueCardCount = portfolio.uniqueCardIds.size;
    let extraCopiesCount = 0, extraCopiesValueCents = 0;
    for (const group of cardQuantities.values()) {
      extraCopiesCount += group.quantity - 1;
      extraCopiesValueCents += group.valueCents - group.keeperCents;
    }
    res.json({ summary: { totalCards: portfolio.totalCards, uniqueCards: uniqueCardCount, cardValue: portfolio.cardValue, totalValue: portfolio.totalValue, totalSpent: portfolio.totalSpent,
      roi: { abs: gain, pct: portfolio.totalSpent > 0 ? round(gain / portfolio.totalSpent * 100) : null },
      avgCardValue: portfolio.totalCards ? round(portfolio.cardValue / portfolio.totalCards) : 0, unsortedCount,
      duplicateCopies: Math.max(portfolio.totalCards - uniqueCardCount, 0),
      extraCopiesCount,
      extraCopiesValue: extraCopiesValueCents / 100,
      mintRate: portfolio.totalCards ? round(nearMintCount / portfolio.totalCards * 100) : 0,
      vintageRatio: portfolio.totalCards ? round(vintageCount / portfolio.totalCards * 100) : 0,
      unpricedCards, ...metadata, dayChange, change7d: change(value7dAgo, valueNowFor7d), change30d: change(value30dAgo, valueNowFor30d),
      change1y: unavailable(), change5y: unavailable(), sealed: portfolio.sealed.holdings },
      types: Object.entries(types).map(([name, value]) => ({ name, value })),
      rarities: Object.entries(rarities).map(([name, value]) => ({ name, value })),
      locations: Object.entries(locations).map(([name, value]) => ({ name, value })), sets: sets.list(), cardSets,
      topValuable: (() => {
        const byCardId = new Map();
        for (const row of rows) {
          const cardId = row.card_id;
          if (!byCardId.has(cardId)) {
            byCardId.set(cardId, { ...row, totalValue: row.price_trend * (row.quantity || 1) });
          } else {
            const existing = byCardId.get(cardId);
            existing.quantity = (existing.quantity || 1) + (row.quantity || 1);
            existing.totalValue = existing.price_trend * existing.quantity;
          }
        }
        return [...byCardId.values()].sort((a, b) => b.totalValue - a.totalValue).slice(0, 6);
      })(),
      recentAdditions: rows.slice().sort((a, b) => parseSqliteUtc(b.added_at) - parseSqliteUtc(a.added_at)).slice(0, 6),
      topSealed: portfolio.sealed.lines.filter(line => line.line_value != null).sort((a, b) => b.line_value - a.line_value).slice(0, 6),
      setProgress: setProgress.sort((a, b) => b.percent - a.percent).slice(0, 12),
      sealedBreakdown: { sets: bucketList(sealedBySet), types: bucketList(sealedByType) },
      openingPerformance: await openingPerformanceFor(req.user.id, game) });
  } catch (error) { failure(res, error, 'Failed to compute statistics'); }
});

router.get('/stats/accounting', async (req,res) => {
  res.set('Cache-Control','no-store');
  try { res.json(await require('../utils/dashboardAccounting').readSummary({connect:()=>require('../utils/salesRepository').openConnection(db.dbPath),user:req.user?.id,game:String(req.query.game||''),currency:String(req.query.currency||'USD')})); }
  catch(error) { failure(res,error,'Failed to compute portfolio accounting'); }
});

router.get('/stats/performance', require('../utils/performanceHistory').createPerformanceHandler({ db }));

// Historical portfolio reconstruction is unchanged by this current-value fix.
router.get('/stats/history', require('../utils/portfolioTimeline').createHistoryHandler({ db, resolveCardPrice, summarizeHoldings }));
router.get('/stats/networth', async (req, res) => {
  try {
    const valuation = createReportingValuation(req.query.currency || 'USD');
    const portfolio = await currentPortfolio(req.user.id, req.query.game, valuation);
    const gain = round(portfolio.totalValue - portfolio.totalSpent);
    res.json({ totalValue: portfolio.totalValue, totalSpent: portfolio.totalSpent, gain,
      gainPct: portfolio.totalSpent > 0 ? round(gain / portfolio.totalSpent * 100) : null,
      totalCards: portfolio.totalCards, uniqueEntries: portfolio.cards.length, byGame: portfolio.byGame,
      currencies: [valuation.target], ...valuation.metadata(), sealed: portfolio.sealed.holdings, asOf: new Date().toISOString() });
  } catch (error) { failure(res, error, 'Failed to compute net worth'); }
});

// Preserve original quote-currency history for the existing chart formatter.
function marketAnchors(card, now) {
  if (!card) return [];
  const points = [];
  if (card.price_avg30 > 0) points.push({ price: card.price_avg30, time: now - 15 * 86400000, source: 'market' });
  if (card.price_avg7 > 0) points.push({ price: card.price_avg7, time: now - 3.5 * 86400000, source: 'market' });
  if (card.price_avg1 > 0) points.push({ price: card.price_avg1, time: now - 86400000, source: 'market' });
  if (card.price_trend > 0) points.push({ price: card.price_trend, time: now, source: 'current' });
  return points;
}
router.get('/cards/:id/price-history', async (req, res) => {
  try {
    const { id } = req.params;
    const rangeKey = String(req.query.range || '30d').toLowerCase();
    const days = rangeKey === '30d' ? 30 : null;
    const now = Date.now();
    const card = await db.get('SELECT * FROM card_cache WHERE id = ?', [id]);
    if (card?.game === 'pokemon') {
      const finish = FINISH_COLUMNS[req.query.printing] ? String(req.query.printing) : null;
      const currency = card.price_currency || 'USD';
      const stored = finish
        ? await db.all(`SELECT price, recorded_at FROM price_history_finish WHERE card_id = ? AND finish = ?
            AND COALESCE(currency, ?) = ? ORDER BY recorded_at`, [id, finish, currency, currency])
        : await db.all(`SELECT price, recorded_at FROM price_history WHERE card_id = ?
            AND COALESCE(currency, ?) = ? ORDER BY recorded_at`, [id, currency, currency]);
      const points = stored.map(row => ({ price: Number(row.price), time: parseSqliteUtc(row.recorded_at).getTime(), source: 'recorded' }));
      const owned = await db.get(`SELECT 1 FROM collection WHERE user_id = ? AND card_id = ?
        UNION SELECT 1 FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id WHERE d.user_id = ? AND dc.card_id = ? LIMIT 1`,
      [req.user.id, id, req.user.id, id]);
      let history = { points: [], status: 'unavailable' };
      if (owned && String(card.id).startsWith('tcgdex-en-')) {
        history = await require('../pokemonPrices').getPokemonPrices().history(card, finish);
      } else {
        const cached = await require('../pokemonPrices').getPokemonPrices().cachedHistory(card);
        history = { points: cached.filter(row => !finish || row.finish === finish), status: 'cached' };
      }
      const providerPoints = history.points.map(row => ({ price: Number(row.price), time: Date.parse(row.recorded_at), source: 'carddex' }));
      points.push(...providerPoints);
      // Only a real quote for the requested finish can extend that finish's chart.
      const currentPrice = Number(finish ? card[FINISH_COLUMNS[finish]] : card.price_trend);
      const quoteAt = card.price_as_of || null;
      if (currentPrice > 0) points.push({ price: currentPrice, time: quoteAt ? parseSqliteUtc(quoteAt).getTime() : now, source: 'current' });
      const ordered = points.filter(point => Number.isFinite(point.time) && point.time <= now && point.price > 0
        && (!days || point.time >= now - days * 86400000)).sort((a, b) => a.time - b.time);
      const unique = [...new Map(ordered.map(point => [point.time, point])).values()];
      const spanDays = unique.length > 1 ? Math.round((unique.at(-1).time - unique[0].time) / 86400000) : 0;
      return res.json({
        data: unique.map(point => ({ price: point.price, recorded_at: new Date(point.time).toISOString(), source: point.source })),
        spanDays, windowDays: days, marketCount: 0,
        recordedCount: ordered.filter(point => point.source === 'recorded').length,
        carddexCount: ordered.filter(point => point.source === 'carddex').length,
        carddexHistoryStatus: history.status, quoteAt, finish, insufficientHistory: unique.length < 2,
      });
    }
    // The inspector's headline is the copy's own printing column when it has one
    // (resolveCardPrice). price_trend tracks a single finish, so when that column
    // differs from it the chart has to follow the printing's series instead, or
    // it charts one finish under another finish's price.
    const finish = FINISH_COLUMNS[req.query.printing] ? String(req.query.printing) : null;
    const finishPrice = finish && card ? Number(card[FINISH_COLUMNS[finish]]) : 0;
    if (finishPrice > 0 && finishPrice !== Number(card.price_trend)) {
      const currency = card.price_currency || 'USD';
      const rows = await db.all(`SELECT price, recorded_at FROM price_history_finish WHERE card_id = ? AND finish = ?
        AND COALESCE(currency, ?) = ? ${days ? 'AND recorded_at >= datetime(\'now\', ?)' : ''} ORDER BY recorded_at ASC`,
      days ? [id, finish, currency, currency, `-${days} days`] : [id, finish, currency, currency]);
      const points = rows.map(row => ({ price: row.price, time: parseSqliteUtc(row.recorded_at).getTime(), source: 'recorded' })).filter(row => Number.isFinite(row.time));
      const recordedCount = points.length;
      points.push({ price: finishPrice, time: now, source: 'current' });
      const data = points.filter((point, index) => !(points[index - 1] && points[index + 1] && points[index - 1].price === point.price && points[index + 1].price === point.price));
      const spanDays = points.length >= 2 ? Math.round((points[points.length - 1].time - points[0].time) / 86400000) : 0;
      return res.json({ data: data.map(point => ({ price: point.price, recorded_at: new Date(point.time).toISOString(), source: point.source })),
        spanDays, windowDays: days, marketCount: 0, recordedCount, carddexCount: 0, carddexHistoryStatus: null, quoteAt: null,
        finish, insufficientHistory: data.length < 2 });
    }
    const sameCurrency = `(currency IS NULL OR currency = COALESCE((SELECT price_currency FROM card_cache WHERE id = price_history.card_id), currency))`;
    const recorded = await db.all(`SELECT price, recorded_at FROM price_history WHERE card_id = ?
      ${days ? 'AND recorded_at >= datetime(\'now\', ?)' : ''} AND ${sameCurrency} ORDER BY recorded_at ASC`, days ? [id, `-${days} days`] : [id]);
    const points = recorded.map(row => ({ price: row.price, time: parseSqliteUtc(row.recorded_at).getTime(), source: 'recorded' })).filter(row => Number.isFinite(row.time));
    const recordedCount = points.length;
    let carddexHistoryStatus = null;
    let quoteAt = null;
    let carddexCount = 0;
    if (card?.price_source?.startsWith('carddex-') || card?.price_source?.startsWith('pokewallet-') || card?.price_source === 'cached-history') {
      const owned = await db.get(`SELECT 1 AS owned FROM collection WHERE user_id = ? AND card_id = ?
        UNION SELECT 1 FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id WHERE d.user_id = ? AND dc.card_id = ? LIMIT 1`,
      [req.user.id, id, req.user.id, id]);
      if (owned) {
        if (card.price_source.startsWith('carddex-') || card.price_source === 'cached-history') {
          const service = require('../pokemonPrices').getPokemonPrices();
          await service.initialize();
          if (card.price_source.startsWith('carddex-')) {
            const history = await service.history(card);
            carddexHistoryStatus = history.status;
            const providerPoints = history.points.map(row => ({ price: row.price, time: Date.parse(row.recorded_at), source: 'carddex' }))
              .filter(row => Number.isFinite(row.time) && (!days || row.time >= now - days * 86400000));
            carddexCount = providerPoints.length;
            points.push(...providerPoints);
          }
          quoteAt = (await db.get('SELECT quote_at FROM carddex_price_attempt WHERE card_id = ?', [id]))?.quote_at || null;
        } else {
          quoteAt = (await db.get('SELECT quote_updated_at FROM pokewallet_map WHERE card_id = ?', [id]))?.quote_updated_at || null;
        }
      }
    }
    // A card that moved from CardDex to another source (TCGCSV for English
    // Pokémon) keeps the CardDex series it already cached in the same currency,
    // instead of the chart restarting at the switch. Cache only; never fetched.
    if (card && card.game === 'pokemon' && !card.price_source?.startsWith('carddex-')) {
      const service = require('../pokemonPrices').getPokemonPrices();
      const cached = typeof service.cachedHistory === 'function' ? await service.cachedHistory(card) : [];
      const cutoff = Math.min(now, ...points.map(point => point.time));
      const cachedPoints = cached.map(row => ({ price: Number(row.price), time: Date.parse(row.recorded_at), source: 'carddex' }))
        .filter(row => row.time < cutoff && (!days || row.time >= now - days * 86400000));
      carddexCount = cachedPoints.length;
      points.push(...cachedPoints);
    }
    const anchors = days ? marketAnchors(card, now) : [];
    const marketCount = anchors.filter(row => row.source === 'market').length;
    points.push(...anchors); points.sort((a, b) => a.time - b.time);
    const data = points.filter((point, index) => !(points[index - 1] && points[index + 1] && points[index - 1].price === point.price && points[index + 1].price === point.price));
    const spanDays = points.length >= 2 ? Math.round((points[points.length - 1].time - points[0].time) / 86400000) : 0;
    res.json({ data: data.map(point => ({ price: point.price, recorded_at: new Date(point.time).toISOString(), source: point.source })),
      spanDays, windowDays: days, marketCount, recordedCount, carddexCount, carddexHistoryStatus, quoteAt, finish: null, insufficientHistory: data.length < 2 });
  } catch (error) { failure(res, error, 'Failed to retrieve price history'); }
});
module.exports = router;
