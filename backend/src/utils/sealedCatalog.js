'use strict';

// Sealed products are TCGplayer products, the same catalogue TCGCSV already
// mirrors for card prices. Cards are the rows with a collector number. Sealed
// product is everything else whose name is a box, pack, tin, or the like.
//
// TCGCSV asks callers not to hit it from a user-facing request, and it only
// changes once a day. Search reads the copy stored here. A search that names a
// set downloads that set if we do not have it yet, and then keeps it. The full
// walk is a separate admin action with a pause between sets.

const db = require('../db');
const tcgcsv = require('../tcgcsvApi');
const { centsToMoney, moneyToCents } = require('./sealedInventory');

const PROVIDER = 'tcgcsv';
const FRESH_MS = 24 * 60 * 60 * 1000;
const MAX_GROUPS_PER_SEARCH = 3;
const MAX_RESULTS = 40;
const GROUP_DELAY_MS = 120;
const SEARCH_PULL_CAP = 60;

// First match wins, so "booster box" is decided before the pack rule sees the
// word "booster" inside it.
const KIND_RULES = [
  [/elite trainer box|\betb\b/, 'etb'],
  [/booster box|booster case/, 'booster_box'],
  [/booster pack|sleeved booster|\bbooster\b|\bpack\b/, 'booster_pack'],
  [/\btin\b/, 'tin'],
  [/blister/, 'blister'],
  [/collection box|ultra[- ]premium|premium collection|special collection|poster collection|pin collection|figure collection|\bupc\b/, 'collection_box'],
  [/build (?:&|and) battle|trainer kit|theme deck|battle deck|\bbundle\b/, 'other'],
];

const REJECT_NAME = /code card|online code|jumbo|oversized|check ?list|deck exclusive|lot of \d|bulk lot|empty (?:pack|box)|damaged box/;

let client = {
  getGroups: tcgcsv.getGroups,
  getProducts: tcgcsv.getProducts,
  getPrices: tcgcsv.getPrices,
  get: (...args) => tcgcsv.client.get(...args),
};

let current = null;
let last = null;
let searchPulls = [];

function setClient(next) {
  client = { ...client, ...next };
}

function resetForTests() {
  client = {
    getGroups: tcgcsv.getGroups,
    getProducts: tcgcsv.getProducts,
    getPrices: tcgcsv.getPrices,
    get: (...args) => tcgcsv.client.get(...args),
  };
  current = null;
  last = null;
  searchPulls = [];
}

function sealedKind(product) {
  if (tcgcsv.numberOf(product)) return null;
  const name = String(product && product.name || '').toLowerCase();
  if (!name || REJECT_NAME.test(name)) return null;
  const hit = KIND_RULES.find(([pattern]) => pattern.test(name));
  return hit ? hit[1] : null;
}

// marketPrice is the sale price. midPrice is what sellers are asking, so a
// missing market price stays unknown instead of being filled with the ask.
function marketCents(prices, productId) {
  const rows = (prices || []).filter(row => row && row.productId === productId && row.marketPrice > 0);
  const normal = rows.find(row => row.subTypeName === 'Normal') || rows[0];
  if (!normal) return null;
  return moneyToCents(Number(normal.marketPrice).toFixed(2), 'Market price');
}

function cleanImage(url) {
  const text = String(url || '').trim();
  if (!text || text.length > 500) return '';
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function languageFor(categoryId) {
  return Number(categoryId) === tcgcsv.CATEGORY.japanese ? 'Japanese' : 'English';
}

function tokensOf(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(token => token.length >= 3);
}

function haystack(parts) {
  return parts.filter(Boolean).join(' ')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ');
}

function tokenHits(text, queryTokens) {
  return queryTokens.every(token => (
    token === 'etb'
      ? /\betb\b/.test(text) || (text.includes('elite') && text.includes('trainer') && text.includes('box'))
      : text.includes(token)
  ));
}

function score(text, queryTokens) {
  return queryTokens.reduce((sum, token) => sum + (text.includes(token) ? token.length : 0), 0);
}

function fresh(stamp) {
  if (!stamp) return false;
  const then = Date.parse(stamp);
  return Number.isFinite(then) && Date.now() - then < FRESH_MS;
}

function allowSearchPull() {
  const now = Date.now();
  searchPulls = searchPulls.filter(at => now - at < 60 * 60 * 1000);
  if (searchPulls.length >= SEARCH_PULL_CAP) return false;
  searchPulls.push(now);
  return true;
}

function present(row) {
  const cents = row.market_price_cents;
  return {
    provider: PROVIDER,
    provider_product_id: String(row.provider_product_id),
    name: row.name,
    product_type: row.product_type,
    language: row.language,
    set_id: row.set_id || '',
    set_name: row.set_name || '',
    image_url: row.image_url || '',
    market_price: cents == null ? null : centsToMoney(cents),
    market_currency: cents == null ? null : (row.market_currency || 'USD'),
    market_source: 'tcgcsv',
    catalog_category_id: row.category_id,
    catalog_group_id: row.group_id,
  };
}

async function ensureGroups({ force = false } = {}) {
  const meta = await db.get(`SELECT groups_fetched_at FROM sealed_catalog_meta WHERE id = 1`);
  if (!force && meta && fresh(meta.groups_fetched_at)) return;
  const listed = {};
  for (const categoryId of Object.values(tcgcsv.CATEGORY)) {
    listed[categoryId] = await client.getGroups(categoryId);
  }
  const now = new Date().toISOString();
  await db.withTransaction(async () => {
    for (const [categoryId, groups] of Object.entries(listed)) {
      for (const group of groups || []) {
        if (!group || !group.groupId) continue;
        await db.run(
          `INSERT INTO sealed_catalog_group (category_id, group_id, name, abbreviation)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(category_id, group_id) DO UPDATE SET
             name = excluded.name,
             abbreviation = excluded.abbreviation`,
          [Number(categoryId), group.groupId, group.name || '', group.abbreviation || '']
        );
      }
    }
    await db.run(
      `INSERT INTO sealed_catalog_meta (id, groups_fetched_at) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET groups_fetched_at = excluded.groups_fetched_at`,
      [now]
    );
  });
}

async function pullGroup(group) {
  const [products, prices] = await Promise.all([
    client.getProducts(group.category_id, group.group_id),
    client.getPrices(group.category_id, group.group_id),
  ]);
  const language = languageFor(group.category_id);
  const setName = tcgcsv.stripGroupCode(group.name).replace(/\s+/g, ' ').trim() || group.name || '';
  const setId = String(group.abbreviation || '').trim().toLowerCase();
  const now = new Date().toISOString();
  let kept = 0;
  await db.withTransaction(async () => {
    await db.run(
      `DELETE FROM sealed_catalog WHERE category_id = ? AND group_id = ?`,
      [group.category_id, group.group_id]
    );
    for (const product of products || []) {
      const kind = sealedKind(product);
      if (!kind) continue;
      let cents = null;
      try { cents = marketCents(prices, product.productId); } catch { cents = null; }
      await db.run(
        `INSERT INTO sealed_catalog (
           provider, provider_product_id, category_id, group_id, name, product_type,
           language, set_id, set_name, image_url, market_price_cents, market_currency, fetched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          PROVIDER, String(product.productId), group.category_id, group.group_id,
          String(product.name || '').slice(0, 200), kind, language, setId, setName.slice(0, 120),
          cleanImage(product.imageUrl), cents, cents == null ? null : 'USD', now,
        ]
      );
      kept += 1;
    }
    await db.run(
      `UPDATE sealed_catalog_group SET products_fetched_at = ? WHERE category_id = ? AND group_id = ?`,
      [now, group.category_id, group.group_id]
    );
  });
  return kept;
}

async function search(query) {
  const queryTokens = tokensOf(query);
  if (!queryTokens.length) throw new TypeError('Enter at least 3 characters');
  await ensureGroups();
  const groups = await db.all(`SELECT * FROM sealed_catalog_group`);
  // Product words ("box", "elite", "etb") sit on the product, not the set.
  // Using them to choose a download would pull dozens of unrelated sets.
  const productWords = new Set([
    'etb', 'upc', 'tin', 'box', 'pack', 'elite', 'trainer', 'booster', 'sleeved',
    'blister', 'collection', 'ultra', 'premium', 'mini', 'poster', 'pin', 'figure',
    'special', 'build', 'battle', 'theme', 'kit', 'bundle', 'display', 'case',
  ]);
  const setTokens = queryTokens.filter(token => !productWords.has(token));
  const toFetch = groups
    .map(group => ({
      group,
      text: haystack([group.name, group.abbreviation, tcgcsv.stripGroupCode(group.name)]),
    }))
    .filter(item => setTokens.length > 0 && tokenHits(item.text, setTokens) && !fresh(item.group.products_fetched_at))
    .sort((a, b) => score(b.text, setTokens) - score(a.text, setTokens))
    .slice(0, MAX_GROUPS_PER_SEARCH);

  let fetchedGroups = 0;
  let limited = false;
  for (const item of toFetch) {
    if (!allowSearchPull()) {
      limited = true;
      break;
    }
    try {
      await pullGroup(item.group);
      fetchedGroups += 1;
    } catch (err) {
      console.warn(`sealed catalog: ${item.group.name} failed (${err.message})`);
    }
  }

  const rows = await db.all(`SELECT * FROM sealed_catalog`);
  const results = rows
    .map(row => {
      const text = haystack([row.name, row.set_name, row.set_id]);
      return { row, text, rank: score(text, queryTokens) };
    })
    .filter(item => tokenHits(item.text, queryTokens))
    .sort((a, b) => b.rank - a.rank || a.row.name.localeCompare(b.row.name))
    .slice(0, MAX_RESULTS)
    .map(item => present(item.row));

  return {
    results,
    fetchedGroups,
    indexed: rows.length,
    needsSet: results.length === 0 && rows.length === 0,
    limited,
    building: Boolean(current),
  };
}

async function refreshOwned(product) {
  const categoryId = Number(product.catalog_category_id);
  const groupId = Number(product.catalog_group_id);
  const productId = String(product.provider_product_id || '');
  if (!categoryId || !groupId || !productId || product.provider !== PROVIDER) {
    throw new TypeError('This product is not linked to the sealed catalog');
  }
  await ensureGroups();
  let group = await db.get(
    `SELECT * FROM sealed_catalog_group WHERE category_id = ? AND group_id = ?`,
    [categoryId, groupId]
  );
  if (!group) {
    group = { category_id: categoryId, group_id: groupId, name: product.set_name || '', abbreviation: product.set_id || '' };
    await db.run(
      `INSERT OR IGNORE INTO sealed_catalog_group (category_id, group_id, name, abbreviation) VALUES (?, ?, ?, ?)`,
      [categoryId, groupId, group.name, group.abbreviation]
    );
  }
  if (!fresh(group.products_fetched_at)) await pullGroup(group);
  const row = await db.get(
    `SELECT * FROM sealed_catalog WHERE provider = ? AND provider_product_id = ?`,
    [PROVIDER, productId]
  );
  if (!row) return null;
  return present(row);
}

function idleStatus() {
  return { running: false, phase: 'idle', done: 0, total: 0, rows: 0, message: '', fresh: false };
}

function status() {
  if (current) return { ...current, running: true };
  return last ? { ...last, running: false } : idleStatus();
}

async function readStamp() {
  if (typeof client.get !== 'function') return null;
  try {
    const response = await client.get('/last-updated.txt', {
      responseType: 'text',
      transformResponse: [data => data],
      timeout: 10000,
    });
    const text = String(response.data || '').trim();
    return text ? text.slice(0, 80) : null;
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startSync({ force = false } = {}) {
  if (current) return { ...current, running: true };
  const job = { running: true, phase: 'groups', done: 0, total: 0, rows: 0, message: 'Reading sets', fresh: false };
  current = job;
  (async () => {
    try {
      const stamp = await readStamp();
      await ensureGroups({ force: false });
      const meta = await db.get(`SELECT * FROM sealed_catalog_meta WHERE id = 1`);
      const groups = await db.all(`SELECT * FROM sealed_catalog_group ORDER BY group_id DESC`);
      const pending = groups.filter(group => force || !fresh(group.products_fetched_at));
      if (!force && stamp && meta && meta.last_remote_update === stamp && pending.length === 0) {
        job.phase = 'done';
        job.fresh = true;
        job.message = 'Sealed catalog is already current.';
        return;
      }
      job.phase = 'products';
      job.total = pending.length;
      for (const group of pending) {
        job.message = group.name;
        try {
          job.rows += await pullGroup(group);
        } catch (err) {
          console.warn(`sealed catalog: ${group.name} failed (${err.message})`);
        }
        job.done += 1;
        await delay(GROUP_DELAY_MS);
      }
      await db.run(
        `UPDATE sealed_catalog_meta
            SET full_sync_at = ?, last_remote_update = COALESCE(?, last_remote_update)
          WHERE id = 1`,
        [new Date().toISOString(), stamp]
      );
      job.phase = 'done';
      job.message = `${job.rows} sealed products from ${job.done} sets`;
    } catch (err) {
      job.phase = 'error';
      job.message = err.message || 'Sealed catalog sync failed';
      console.error('sealed catalog sync failed', err);
    } finally {
      job.running = false;
      last = { ...job };
      current = null;
    }
  })();
  return { ...job, running: true };
}

module.exports = {
  PROVIDER,
  search,
  refreshOwned,
  startSync,
  status,
  sealedKind,
  marketCents,
  setClient,
  resetForTests,
};
