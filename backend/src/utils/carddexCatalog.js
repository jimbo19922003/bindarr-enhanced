'use strict';

const { createHash } = require('node:crypto');
const { getCarddexKey } = require('./carddexKey');
const { foldName, collectorNumber } = require('./pokewalletMatch');
const { selectCarddexImage } = require('./carddexImage');

const BASE_URL = 'https://api.carddex.dev/v1';
const CACHE_TTL_MS = 3600000;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_MINUTE = 25;
const RATE_LIMIT_MAX_DAY = 4500;

const schema = `
CREATE TABLE IF NOT EXISTS carddex_catalog_cache (
  request TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS carddex_catalog_request (
  id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS carddex_catalog_budget (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  paused_until INTEGER NOT NULL
);
`;

const fail = (code, message) => Object.assign(new Error(message || code), { code });

function imageUrl(value) {
  if (typeof value !== 'string' || value.length > 1000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (url.hostname === 'images.carddex.dev' || (url.hostname === 'assets.tcgdex.net' && url.pathname.startsWith('/en/'))) {
      return url.toString();
    }
  } catch { /* invalid URL */ }
  return null;
}

function carddexSetId(card) {
  if (card?.game === 'pokemon' && card.language === 'English' && card.set_id === '30th-c' && foldName(card.set_name) === foldName('30th Classic Collection')) {
    return '30ccc';
  }
  return card?.set_id;
}

function normalizeCardFromCarddex(row, requestedCard) {
  if (!row || typeof row !== 'object') return null;
  const img = selectCarddexImage(row, imageUrl);
  return {
    id: requestedCard?.id || `tcgdex-en-${row.id}`,
    name: row.name || requestedCard?.name,
    printed_name: row.printed_name || row.name,
    set_id: requestedCard?.set_id || row.set_id,
    set_name: row.set_name || requestedCard?.set_name,
    number: row.number || requestedCard?.number,
    language: 'English',
    game: 'pokemon',
    image_url: img || requestedCard?.image_url || '',
    rarity: row.rarity || requestedCard?.rarity,
    supertype: row.supertype || requestedCard?.supertype,
    subtypes: row.subtypes || requestedCard?.subtypes,
    types: row.types || requestedCard?.types,
    price_trend: row.market_price?.amount ?? row.prices?.market ?? null,
    price_normal: row.prices?.normal ?? null,
    price_holofoil: row.prices?.holofoil ?? null,
    price_reverse_holofoil: row.prices?.reverseHolofoil ?? null,
    price_1st_edition: row.prices?.firstEdition ?? null,
    price_currency: row.market_price?.currency || row.prices?.currency || 'USD',
    price_source: row.market_price || row.prices ? 'carddex' : null,
    price_updated_at: row.market_price?.updated_at || row.prices?.updated_at || null,
    carddex_id: row.id,
  };
}

function normalizeSealedFromCarddex(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.product_type !== 'sealed' && !isSealedProduct(row)) return null;
  const marketPrice = row.market_price?.amount ?? row.prices?.market ?? null;
  return {
    provider: 'carddex',
    provider_product_id: row.id,
    name: String(row.name || '').slice(0, 200),
    product_type: detectSealedType(row.name) || 'other',
    language: 'English',
    set_id: String(row.set_id || '').slice(0, 40),
    set_name: String(row.set_name || '').slice(0, 120),
    image_url: row.image_url || '',
    market_price: marketPrice != null ? (marketPrice / 100).toFixed(2) : null,
    market_currency: marketPrice != null ? (row.market_price?.currency || 'USD') : null,
    market_source: marketPrice != null ? 'carddex' : '',
  };
}

function isSealedProduct(row) {
  const name = String(row?.name || '').toLowerCase();
  return /booster box|booster pack|elite trainer|etb|\btin\b|collection box|blister|bundle/i.test(name);
}

const SEALED_TYPE_RULES = [
  [/elite trainer box|\betb\b/i, 'etb'],
  [/booster box|booster case/i, 'booster_box'],
  [/booster pack|sleeved booster|\bbooster\b|\bpack\b/i, 'booster_pack'],
  [/\btin\b/i, 'tin'],
  [/blister/i, 'blister'],
  [/collection box|ultra[- ]premium|premium collection|special collection|\bupc\b/i, 'collection_box'],
  [/build (?:&|and) battle|trainer kit|theme deck|battle deck|\bbundle\b/i, 'other'],
];

function detectSealedType(name) {
  const text = String(name || '').toLowerCase();
  for (const [pattern, type] of SEALED_TYPE_RULES) {
    if (pattern.test(text)) return type;
  }
  return null;
}

function createCarddexCatalogClient({ connect, http = require('axios'), now = Date.now }) {
  async function using(work) {
    const db = await connect();
    try {
      await db.exec(schema);
      return await work(db);
    } finally {
      await db.close();
    }
  }

  async function reserve() {
    await using(async (db) => {
      let began = false;
      try {
        await db.run('BEGIN IMMEDIATE');
        began = true;
        const at = now();
        const budget = await db.get('SELECT paused_until FROM carddex_catalog_budget WHERE id = 1');
        if (budget?.paused_until > at) throw fail('rate_limited', 'CardDex rate limit active');
        const minute = (await db.get('SELECT COUNT(*) AS n FROM carddex_catalog_request WHERE created_at > ?', [at - RATE_LIMIT_WINDOW_MS])).n;
        const day = (await db.get('SELECT COUNT(*) AS n FROM carddex_catalog_request WHERE created_at > ?', [at - 86400000])).n;
        if (minute >= RATE_LIMIT_MAX_MINUTE || day >= RATE_LIMIT_MAX_DAY) throw fail('rate_limited', 'CardDex rate limit reached');
        await db.run('INSERT INTO carddex_catalog_request(created_at) VALUES(?)', [at]);
        await db.run('DELETE FROM carddex_catalog_request WHERE created_at < ?', [at - 172800000]);
        await db.run('COMMIT');
        began = false;
      } finally {
        if (began) await db.run('ROLLBACK').catch(() => {});
      }
    });
  }

  async function get(url, params, credential = '') {
    await reserve();
    let response;
    try {
      response = await http.get(url, {
        params,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Bindarr-CardDex-catalog',
          ...(credential ? { 'X-API-Key': credential } : {}),
        },
        timeout: 12000,
        maxRedirects: 0,
        maxContentLength: 4194304,
        responseType: 'json',
        validateStatus: () => true,
      });
    } catch {
      throw fail('upstream', 'CardDex request failed');
    }

    if (response.status === 429 || response.status === 503) {
      const retry = Number(response.headers?.['retry-after']);
      const until = now() + (Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 86400000) : 60000);
      await using((db) => db.run(
        'INSERT INTO carddex_catalog_budget VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET paused_until = MAX(carddex_catalog_budget.paused_until, excluded.paused_until)',
        [until]
      ));
      throw fail('rate_limited', 'CardDex rate limited');
    }

    if (response.status !== 200) {
      throw fail(response.status === 404 ? 'not_found' : [401, 403].includes(response.status) ? 'key_rejected' : 'upstream');
    }

    if (!response.data || typeof response.data !== 'object') {
      throw fail('upstream', 'Invalid CardDex response');
    }

    if (credential && JSON.stringify(response.data).includes(credential)) {
      throw fail('upstream', 'Response leaked credential');
    }

    return response.data;
  }

  async function cachedGet(path, params, credential = '') {
    const key = createHash('sha256')
      .update(JSON.stringify({ path, params }))
      .update('\0')
      .update(credential)
      .digest('hex');

    const cached = await using((db) => db.get('SELECT body, fetched_at FROM carddex_catalog_cache WHERE request = ?', [key]));
    if (cached && now() - cached.fetched_at >= 0 && now() - cached.fetched_at < CACHE_TTL_MS) {
      try {
        return { body: JSON.parse(cached.body), cached: true };
      } catch { /* invalid cache, refetch */ }
    }

    const body = await get(`${BASE_URL}${path}`, params, credential);
    
    await using(async (db) => {
      await db.run(
        'INSERT INTO carddex_catalog_cache VALUES(?, ?, ?) ON CONFLICT(request) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at',
        [key, JSON.stringify(body), now()]
      );
      await db.run('DELETE FROM carddex_catalog_cache WHERE request IN (SELECT request FROM carddex_catalog_cache ORDER BY fetched_at DESC LIMIT -1 OFFSET 512)');
    });

    return { body, cached: false };
  }

  return {
    async lookupCard(card) {
      if (card?.game !== 'pokemon' || card.language !== 'English' || !String(card.id).startsWith('tcgdex-en-')) {
        throw fail('unsupported', 'CardDex only supports English Pokémon cards');
      }

      const credential = await getCarddexKey(connect);
      const setId = carddexSetId(card);
      const params = { name: card.name, set: setId, include: 'images,prices', page: 1, pageSize: 50 };

      const { body, cached } = await cachedGet('/cards', params, credential);

      if (!Array.isArray(body?.data)) {
        return { card: null, cached, source: 'carddex' };
      }

      const expectedNumber = collectorNumber(card.number);
      const match = body.data.find((row) =>
        row &&
        foldName(row.name) === foldName(card.name) &&
        collectorNumber(row.number) === expectedNumber &&
        expectedNumber !== '' &&
        foldName(row.set_name) === foldName(card.set_name)
      );

      if (!match) {
        return { card: null, cached, source: 'carddex' };
      }

      return { card: normalizeCardFromCarddex(match, card), cached, source: 'carddex' };
    },

    async searchCards(query, options = {}) {
      const credential = await getCarddexKey(connect);
      const params = {
        q: query,
        include: 'images,prices',
        page: options.page || 1,
        pageSize: Math.min(options.limit || 50, 250),
      };
      if (options.set) params.set = options.set;

      const { body, cached } = await cachedGet('/cards', params, credential);

      if (!Array.isArray(body?.data)) {
        return { cards: [], total: 0, cached, source: 'carddex' };
      }

      const cards = body.data
        .filter((row) => row && row.product_type !== 'sealed')
        .map((row) => normalizeCardFromCarddex(row, null))
        .filter(Boolean);

      return { cards, total: body.meta?.total || cards.length, cached, source: 'carddex' };
    },

    async searchSealed(query) {
      const credential = await getCarddexKey(connect);
      const params = { q: query, include: 'prices', page: 1, pageSize: 50, type: 'sealed' };

      let body, cached;
      try {
        const result = await cachedGet('/products', params, credential);
        body = result.body;
        cached = result.cached;
      } catch (err) {
        if (err.code === 'not_found') {
          return { products: [], cached: false, source: 'carddex' };
        }
        throw err;
      }

      if (!Array.isArray(body?.data)) {
        return { products: [], cached: cached || false, source: 'carddex' };
      }

      const products = body.data
        .map(normalizeSealedFromCarddex)
        .filter(Boolean);

      return { products, cached, source: 'carddex' };
    },

    async getCardPrice(card) {
      if (card?.game !== 'pokemon' || card.language !== 'English') {
        return { price: null, source: null };
      }

      try {
        const result = await this.lookupCard(card);
        if (result.card && result.card.price_trend != null) {
          return {
            price_trend: result.card.price_trend,
            price_normal: result.card.price_normal,
            price_holofoil: result.card.price_holofoil,
            price_reverse_holofoil: result.card.price_reverse_holofoil,
            price_1st_edition: result.card.price_1st_edition,
            price_currency: result.card.price_currency,
            price_source: 'carddex',
            source: 'carddex',
          };
        }
      } catch { /* fall through */ }

      return { price: null, source: null };
    },

    async getSealedPrice(product) {
      const credential = await getCarddexKey(connect);
      const params = { id: product.provider_product_id };

      try {
        const { body } = await cachedGet(`/products/${encodeURIComponent(product.provider_product_id)}`, {}, credential);
        const normalized = normalizeSealedFromCarddex(body);
        if (normalized?.market_price != null) {
          return { price: normalized.market_price, currency: normalized.market_currency, source: 'carddex' };
        }
      } catch { /* fall through */ }

      return { price: null, source: null };
    },
  };
}

let instance;
function getCarddexCatalog() {
  if (!instance) {
    instance = createCarddexCatalogClient({
      connect: () => require('./salesRepository').openConnection(require('../db').dbPath),
    });
  }
  return instance;
}

module.exports = {
  createCarddexCatalogClient,
  getCarddexCatalog,
  normalizeCardFromCarddex,
  normalizeSealedFromCarddex,
  carddexSetId,
  detectSealedType,
};
