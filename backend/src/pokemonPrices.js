'use strict';

const { parseSqliteUtc, priceRefreshDays } = require('./utils/priceHelpers');
const { createCarddexArtworkClient } = require('./utils/carddexArtwork');
const { providerId, extractCarddexQuote } = require('./utils/carddexPrices');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const MAX_CARDS_PER_RUN = 25;

function createPokemonPrices({ database, carddex, pokewallet, tcgcsv = null, recordPrice = async () => {}, now = Date.now, refreshDays = priceRefreshDays }) {
  let ready;
  const pending = new Map();
  function initialize() {
    if (!ready) ready = database.run(`CREATE TABLE IF NOT EXISTS carddex_price_attempt (
      card_id TEXT PRIMARY KEY, attempted_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL,
      status TEXT NOT NULL, provider_id TEXT, quote_at TEXT
    )`).then(() => database.run(`CREATE TABLE IF NOT EXISTS carddex_history_cache (
      card_id TEXT NOT NULL, source TEXT NOT NULL, body TEXT NOT NULL, fetched_at INTEGER NOT NULL,
      PRIMARY KEY (card_id, source)
    )`)).catch(error => { ready = null; throw error; });
    return ready;
  }

  async function writeQuote(card, quote) {
    const column = quote.finish;
    if (!['price_normal', 'price_holofoil'].includes(column)) throw new Error('Invalid CardDex finish');
    const result = await database.run(`UPDATE card_cache SET price_trend = ?,
      price_normal = CASE WHEN ? = 'price_normal' THEN ? WHEN price_currency IS ? THEN price_normal ELSE NULL END,
      price_holofoil = CASE WHEN ? = 'price_holofoil' THEN ? WHEN price_currency IS ? THEN price_holofoil ELSE NULL END,
      price_reverse_holofoil = CASE WHEN price_currency IS ? THEN price_reverse_holofoil ELSE NULL END,
      price_1st_edition = CASE WHEN price_currency IS ? THEN price_1st_edition ELSE NULL END,
      price_avg1 = ?, price_avg7 = ?, price_avg30 = ?, price_currency = ?, price_source = ?,
      last_updated = CURRENT_TIMESTAMP
      WHERE id = ? AND price_source IS ? AND price_currency IS ? AND last_updated IS ?
        AND price_trend IS ? AND price_normal IS ? AND price_holofoil IS ?
        AND price_reverse_holofoil IS ? AND price_1st_edition IS ?`,
    [quote.amount, column, quote.amount, quote.currency, column, quote.amount, quote.currency,
      quote.currency, quote.currency, quote.avg1, quote.avg7, quote.avg30, quote.currency, quote.source,
      card.id, card.price_source, card.price_currency, card.last_updated, card.price_trend,
      card.price_normal, card.price_holofoil, card.price_reverse_holofoil, card.price_1st_edition]);
    return result.changes === 1;
  }

  async function restoreHistory(card) {
    let point = await database.get(`SELECT price, currency, recorded_at FROM price_history
      WHERE card_id = ? AND price > 0 AND currency IN ('USD', 'EUR')
        AND (? IS NULL OR ? = '' OR currency = ?)
      ORDER BY recorded_at DESC LIMIT 1`, [card.id, card.price_currency, card.price_currency, card.price_currency]);
    const source = card.price_currency === 'EUR' ? 'cardmarket' : card.price_currency === 'USD' ? 'tcgplayer' : null;
    if (source) {
      const cached = await database.get(`SELECT body FROM carddex_history_cache WHERE card_id = ? AND source = ?`, [card.id, source]);
      if (cached) {
        let rows;
        try { rows = JSON.parse(cached.body); } catch { console.warn(`Invalid cached CardDex history for ${card.id}`); }
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const time = Date.parse(row?.recorded_at);
            if (Number(row?.price) > 0 && Number.isFinite(time) && time <= now()
                && (!point || time > parseSqliteUtc(point.recorded_at).getTime())) {
              point = { price: Number(row.price), currency: card.price_currency, recorded_at: row.recorded_at };
            }
          }
        }
      }
    }
    if (!point) return null;
    if (!Number.isFinite(parseSqliteUtc(point.recorded_at).getTime())) {
      console.warn(`Invalid cached price timestamp for ${card.id}`);
      return null;
    }
    const result = await database.run(`UPDATE card_cache SET price_trend = ?, price_currency = ?,
      price_source = 'cached-history', last_updated = CURRENT_TIMESTAMP
      WHERE id = ? AND COALESCE(price_trend, 0) <= 0 AND COALESCE(price_normal, 0) <= 0
        AND COALESCE(price_holofoil, 0) <= 0 AND COALESCE(price_reverse_holofoil, 0) <= 0
        AND COALESCE(price_1st_edition, 0) <= 0 AND price_currency IS ?`,
    [point.price, point.currency, card.id, card.price_currency]);
    return result.changes === 1 ? parseSqliteUtc(point.recorded_at).toISOString() : null;
  }

  async function runCard(card, days) {
    const id = providerId(card);
    if (!id) return { status: 'unsupported' };
    if (tcgcsv) {
      try {
        const quote = await tcgcsv.quoteForCard(card);
        if (quote) {
          const result = await database.run(`UPDATE card_cache SET price_trend = ?, price_normal = ?,
            price_holofoil = ?, price_reverse_holofoil = ?, price_1st_edition = ?,
            price_avg1 = NULL, price_avg7 = NULL, price_avg30 = NULL,
            price_currency = 'USD', price_source = ?, tcgplayer_product_id = ?, last_updated = CURRENT_TIMESTAMP
            WHERE id = ? AND price_source IS ? AND price_currency IS ? AND last_updated IS ?
              AND price_trend IS ? AND price_normal IS ? AND price_holofoil IS ?
              AND price_reverse_holofoil IS ? AND price_1st_edition IS ?`,
          [quote.price_trend, quote.price_normal, quote.price_holofoil, quote.price_reverse_holofoil,
            quote.price_1st_edition, quote.source, quote.productId, card.id, card.price_source,
            card.price_currency, card.last_updated, card.price_trend, card.price_normal, card.price_holofoil,
            card.price_reverse_holofoil, card.price_1st_edition]);
          if (result.changes !== 1) return { status: 'changed' };
          await recordPrice(card.id, quote.price_trend);
          await database.run(`INSERT INTO carddex_price_attempt (card_id, attempted_at, next_attempt_at, status, provider_id, quote_at)
            VALUES (?, ?, ?, 'tcgcsv', ?, NULL) ON CONFLICT(card_id) DO UPDATE SET attempted_at=excluded.attempted_at,
            next_attempt_at=excluded.next_attempt_at, status=excluded.status, provider_id=excluded.provider_id, quote_at=NULL`,
          [card.id, now(), now() + Math.max(days, 1) * DAY, id]);
          return { status: 'tcgcsv' };
        }
      } catch (error) {
        console.warn(`TCGCSV price lookup failed for ${card.id}: ${error.code || error.message}`);
      }
    }
    let quote = null, reason = 'unpriced';
    try {
      const body = await carddex.json(`/v1/cards/${encodeURIComponent(id)}`, { include: 'prices,variants' });
      quote = extractCarddexQuote(card, body, now());
    } catch (error) {
      reason = error.code || 'upstream';
      console.warn(`CardDex price lookup failed for ${card.id}: ${reason}`);
    }
    if (quote) {
      if (!await writeQuote(card, quote)) return { status: 'changed' };
      await database.run(`UPDATE pokewallet_map SET status = 'skipped_priced', reason = 'existing_quote'
        WHERE card_id = ? AND status = 'currency_conflict'`, [card.id]);
      await database.run(`INSERT INTO carddex_price_attempt (card_id, attempted_at, next_attempt_at, status, provider_id, quote_at)
        VALUES (?, ?, ?, 'matched', ?, ?) ON CONFLICT(card_id) DO UPDATE SET attempted_at=excluded.attempted_at,
        next_attempt_at=excluded.next_attempt_at, status=excluded.status, provider_id=excluded.provider_id, quote_at=excluded.quote_at`,
      [card.id, now(), now() + Math.max(days, 1) * DAY, id, quote.recordedAt]);
      return { status: 'matched', source: quote.source };
    }
    let fallback;
    try {
      fallback = await pokewallet.priceFallback(card);
    } catch (error) {
      fallback = { status: error.code || 'upstream' };
      console.warn(`PokéWallet fallback failed for ${card.id}: ${fallback.status}`);
    }
    const restored = !fallback.updated && await restoreHistory(card);
    const status = fallback.updated ? 'fallback' : restored ? 'cached_history' : reason;
    await database.run(`INSERT INTO carddex_price_attempt (card_id, attempted_at, next_attempt_at, status, provider_id, quote_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(card_id) DO UPDATE SET attempted_at=excluded.attempted_at,
      next_attempt_at=excluded.next_attempt_at, status=excluded.status, provider_id=excluded.provider_id,
      quote_at=CASE WHEN excluded.status = 'cached_history' THEN excluded.quote_at ELSE carddex_price_attempt.quote_at END`,
    [card.id, now(), now() + HOUR, status, id, restored || null]);
    return { status, fallback };
  }

  async function refreshCard(card, days = null) {
    await initialize();
    if (pending.has(card.id)) return pending.get(card.id);
    const work = (async () => {
      const previous = await database.get(`SELECT status, next_attempt_at FROM carddex_price_attempt WHERE card_id = ?`, [card.id]);
      if (previous && previous.next_attempt_at > now()) return { status: 'not_due', previous: previous.status };
      return runCard(card, days == null ? await refreshDays() : days);
    })().finally(() => pending.delete(card.id));
    pending.set(card.id, work);
    return work;
  }

  async function sweep() {
    const days = await refreshDays();
    if (!days) return { status: 'disabled', examined: 0 };
    await initialize();
    const cards = await database.all(`SELECT cc.* FROM card_cache cc
      LEFT JOIN carddex_price_attempt a ON a.card_id = cc.id
      WHERE cc.game = 'pokemon' AND cc.language = 'English' AND cc.id LIKE 'tcgdex-en-%'
        AND cc.id IN (SELECT card_id FROM collection WHERE list_type != 'sold' UNION SELECT card_id FROM deck_cards)
        AND (a.next_attempt_at IS NULL OR a.next_attempt_at <= ?)
      ORDER BY COALESCE(a.next_attempt_at, 0), cc.id LIMIT ?`, [now(), MAX_CARDS_PER_RUN]);
    const counts = {};
    for (const card of cards) {
      const result = await refreshCard(card, days);
      counts[result.status] = (counts[result.status] || 0) + 1;
      if (result.fallback?.status && result.fallback.status !== 'complete') {
        const key = `pokewallet_${result.fallback.status}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    if (cards.length) console.log(`Pokémon price sweep: ${cards.length} examined, ${JSON.stringify(counts)}.`);
    return { status: 'complete', examined: cards.length, counts };
  }

  async function history(card) {
    await initialize();
    const id = providerId(card);
    const source = card.price_source === 'carddex-cardmarket' ? 'cardmarket'
      : card.price_source === 'carddex-tcgplayer' ? 'tcgplayer' : null;
    if (!id || !source) return { points: [], status: 'unavailable' };
    const cached = await database.get(`SELECT body, fetched_at FROM carddex_history_cache WHERE card_id = ? AND source = ?`, [card.id, source]);
    let rows = cached ? JSON.parse(cached.body) : null;
    let status = 'cached';
    if (!cached || now() - cached.fetched_at >= DAY || now() < cached.fetched_at) {
      try {
        const body = await carddex.json(`/v1/cards/${encodeURIComponent(id)}/prices/history`, { days: 365, source });
        if (!Array.isArray(body?.data)) throw new Error('invalid_response');
        const points = body.data.filter(row => Number.isFinite(Number(row?.trend_price)) && Number(row.trend_price) > 0
          && Number.isFinite(Date.parse(row.recorded_at))
          && (!row.source || row.source === source)
          && (!row.currency || row.currency === card.price_currency))
          .map(row => ({ price: Number(row.trend_price), recorded_at: row.recorded_at }));
        if (points.length || !rows) {
          rows = points;
          await database.run(`INSERT INTO carddex_history_cache (card_id, source, body, fetched_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(card_id, source) DO UPDATE SET body=excluded.body, fetched_at=excluded.fetched_at`,
          [card.id, source, JSON.stringify(rows), now()]);
          status = 'fresh';
        } else {
          status = 'stale';
          console.warn(`CardDex price history was empty for ${card.id}; retaining the cached response.`);
        }
      } catch (error) {
        status = rows ? 'stale' : 'unavailable';
        console.warn(`CardDex price history unavailable for ${card.id}: ${error.code || 'upstream'}`);
      }
    }
    return { points: rows || [], status };
  }
  return { refreshCard, sweep, initialize, history };
}

let instance;
function getPokemonPrices() {
  if (!instance) {
    const db = require('./db');
    const connect = () => require('./utils/salesRepository').openConnection(db.dbPath);
    instance = createPokemonPrices({ database: db, carddex: createCarddexArtworkClient({ connect }), tcgcsv: require('./tcgcsvApi'), recordPrice: require('./utils/priceHelpers').recordPrice,
      pokewallet: require('./pokewalletApi') });
  }
  return instance;
}

module.exports = { createPokemonPrices, getPokemonPrices, MAX_CARDS_PER_RUN };
