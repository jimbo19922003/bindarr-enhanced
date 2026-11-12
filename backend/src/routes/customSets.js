const express = require('express');
const db = require('../db');
const languages = require('../utils/languages');
const { parsePrintings } = require('../utils/cardPrintings');
const { searchApiFor } = require('../utils/searchApi');
const { searchLimiter } = require('../middleware/auth');

const router = express.Router();

const GAMES = ['pokemon', 'mtg', 'lorcana'];
const MODES = ['card', 'printing'];
// Rule caps keep one custom set from turning into a full-catalogue scan.
const RULE_LIMITS = { names: 20, illustrators: 20, set_ids: 200, rarities: 30 };
const MAX_TERM = 100;
const MAX_CARDS = 3000;
const SYNC_TERMS = 5;
const SYNC_PAGES = 2;
const SYNC_PAGE_SIZE = 250;
const CARD_COLUMNS = `cc.id, cc.name, cc.printed_name, cc.set_id, cc.set_name, cc.number,
  cc.image_url, cc.rarity, cc.game, cc.language, cc.illustrator, cc.available_printings, cc.price_trend, cc.price_currency,
  cc.price_normal, cc.price_holofoil, cc.price_reverse_holofoil, cc.price_1st_edition`;

class InputError extends Error {}

function cleanList(value, key) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InputError(`${key} must be a list`);
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new InputError(`${key} must contain text`);
    const text = item.trim();
    if (!text) continue;
    if (text.length > MAX_TERM) throw new InputError(`${key} entries must be ${MAX_TERM} characters or fewer`);
    if (!out.some(existing => existing.toLowerCase() === text.toLowerCase())) out.push(text);
  }
  if (out.length > RULE_LIMITS[key]) throw new InputError(`Too many ${key} (max ${RULE_LIMITS[key]})`);
  return out;
}

function cleanRules(rules) {
  if (rules != null && (typeof rules !== 'object' || Array.isArray(rules))) throw new InputError('Invalid rules');
  const source = rules || {};
  return Object.fromEntries(Object.keys(RULE_LIMITS).map(key => [key, cleanList(source[key], key)]));
}

function parseRules(json) {
  try { return cleanRules(JSON.parse(json || '{}')); } catch { return cleanRules({}); }
}

const hasRules = rules => rules.names.length > 0 || rules.illustrators.length > 0 || rules.set_ids.length > 0;

function cleanName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new InputError('Name is required');
  if (name.trim().length > 100) throw new InputError('Name must be 100 characters or fewer');
  return name.trim();
}

function resolveLanguage(game, lang) {
  if (lang == null || lang === '') return null;
  const name = languages.toName(String(lang));
  if (!name || !languages.isLanguageSupported(game, name)) throw new InputError('Invalid language');
  return name;
}

// Server-side twin of frontend/src/utils/setCardEntries.js and the Sets view
// "owned" rule: same game and set, number compared without leading zeros.
const numberKey = value => String(value ?? '').trim().replace(/^0+/, '').toLowerCase();

const shape = row => ({
  id: row.id,
  user_id: row.user_id,
  name: row.name,
  game: row.game,
  completion_mode: row.completion_mode,
  rules: parseRules(row.rules_json),
  include_count: row.include_count || 0,
  exclude_count: row.exclude_count || 0,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

async function ownedSet(id, userId) {
  return db.get(`SELECT * FROM custom_sets WHERE id = ? AND user_id = ?`, [id, userId]);
}

// Cards matching the rules (AND across rule types, OR within one), plus manual
// includes, minus excludes. Rules only see the requested language; a manual
// include is shown whatever its language.
async function resolveMembers(set, language) {
  const rules = parseRules(set.rules_json);
  const overrides = await db.all(`SELECT card_id, mode FROM custom_set_cards WHERE custom_set_id = ?`, [set.id]);
  const excluded = new Set(overrides.filter(o => o.mode === 'exclude').map(o => o.card_id));
  const includedIds = overrides.filter(o => o.mode === 'include').map(o => o.card_id);

  let ruleCards = [];
  if (hasRules(rules)) {
    const where = ['cc.game = ?'];
    const params = [set.game];
    if (language) { where.push('cc.language = ?'); params.push(language); }
    const anyOf = (terms, column) => {
      where.push(`(${terms.map(() => `instr(lower(COALESCE(${column}, '')), lower(?)) > 0`).join(' OR ')})`);
      params.push(...terms);
    };
    if (rules.names.length) {
      where.push(`(${rules.names.map(() => `(instr(lower(cc.name), lower(?)) > 0 OR instr(lower(COALESCE(cc.printed_name, '')), lower(?)) > 0)`).join(' OR ')})`);
      for (const term of rules.names) params.push(term, term);
    }
    if (rules.illustrators.length) anyOf(rules.illustrators, 'cc.illustrator');
    if (rules.set_ids.length) {
      where.push(`cc.set_id IN (${rules.set_ids.map(() => '?').join(', ')})`);
      params.push(...rules.set_ids);
    }
    if (rules.rarities.length) {
      where.push(`lower(COALESCE(cc.rarity, '')) IN (${rules.rarities.map(() => 'lower(?)').join(', ')})`);
      params.push(...rules.rarities);
    }
    ruleCards = await db.all(
      `SELECT ${CARD_COLUMNS} FROM card_cache cc WHERE ${where.join(' AND ')} LIMIT ${MAX_CARDS + 1}`,
      params
    );
  }

  const included = includedIds.length
    ? await db.all(
      `SELECT ${CARD_COLUMNS} FROM card_cache cc WHERE cc.game = ? AND cc.id IN (${includedIds.map(() => '?').join(', ')})`,
      [set.game, ...includedIds]
    )
    : [];

  const byId = new Map();
  for (const card of ruleCards) if (!excluded.has(card.id)) byId.set(card.id, { ...card, manual: false });
  for (const card of included) byId.set(card.id, { ...card, manual: true });
  const cards = [...byId.values()].sort((a, b) =>
    String(a.set_name || a.set_id || '').localeCompare(String(b.set_name || b.set_id || ''))
    || numberKey(a.number).localeCompare(numberKey(b.number), undefined, { numeric: true })
    || String(a.name || '').localeCompare(String(b.name || '')));
  const truncated = ruleCards.length > MAX_CARDS;
  return { cards: truncated ? cards.slice(0, MAX_CARDS) : cards, truncated, excluded: [...excluded] };
}

async function ownership(userId, game, listType = 'collection') {
  const rows = await db.all(
    `SELECT c.card_id, c.printing, c.quantity, cc.set_id, cc.number
     FROM collection c JOIN card_cache cc ON cc.id = c.card_id
     WHERE c.user_id = ? AND c.list_type = ? AND cc.game = ?`,
    [userId, listType, game]
  );
  const bySetNumber = new Map();
  const byCard = new Map();
  for (const row of rows) {
    const push = (map, key) => { if (!map.has(key)) map.set(key, []); map.get(key).push(row); };
    push(byCard, row.card_id);
    if (String(row.number ?? '').trim()) push(bySetNumber, `${row.set_id}|${numberKey(row.number)}`);
  }
  return card => {
    const entries = String(card.number ?? '').trim()
      ? bySetNumber.get(`${card.set_id}|${numberKey(card.number)}`) || []
      : byCard.get(card.id) || [];
    return entries;
  };
}

function slotsFor(card, mode) {
  if (mode !== 'printing') return [null];
  return parsePrintings(card.available_printings) || ['Normal'];
}

router.get('/custom-sets', async (req, res) => {
  try {
    const params = [req.user.id];
    let filter = '';
    if (req.query.game) {
      if (!GAMES.includes(req.query.game)) return res.status(400).json({ error: 'Invalid game' });
      filter = ' AND s.game = ?';
      params.push(req.query.game);
    }
    const rows = await db.all(
      `SELECT s.*,
         (SELECT COUNT(*) FROM custom_set_cards x WHERE x.custom_set_id = s.id AND x.mode = 'include') AS include_count,
         (SELECT COUNT(*) FROM custom_set_cards x WHERE x.custom_set_id = s.id AND x.mode = 'exclude') AS exclude_count
       FROM custom_sets s WHERE s.user_id = ?${filter} ORDER BY lower(s.name), s.id`,
      params
    );
    res.json(rows.map(shape));
  } catch (error) {
    console.error('Failed to list custom sets:', error);
    res.status(500).json({ error: 'Failed to list custom sets' });
  }
});

router.post('/custom-sets', async (req, res) => {
  try {
    const { game, completion_mode: mode = 'card' } = req.body || {};
    if (!GAMES.includes(game)) throw new InputError('Invalid game');
    if (!MODES.includes(mode)) throw new InputError('Invalid completion mode');
    const name = cleanName(req.body.name);
    const rules = cleanRules(req.body.rules);
    const result = await db.run(
      `INSERT INTO custom_sets (user_id, name, game, completion_mode, rules_json) VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, name, game, mode, JSON.stringify(rules)]
    );
    res.status(201).json(shape(await ownedSet(result.lastID, req.user.id)));
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ error: error.message });
    console.error('Failed to create custom set:', error);
    res.status(500).json({ error: 'Failed to create custom set' });
  }
});

router.put('/custom-sets/:id', async (req, res) => {
  try {
    const set = await ownedSet(req.params.id, req.user.id);
    if (!set) return res.status(404).json({ error: 'Custom set not found' });
    const body = req.body || {};
    const name = body.name === undefined ? set.name : cleanName(body.name);
    const mode = body.completion_mode === undefined ? set.completion_mode : body.completion_mode;
    if (!MODES.includes(mode)) throw new InputError('Invalid completion mode');
    const rules = body.rules === undefined ? parseRules(set.rules_json) : cleanRules(body.rules);
    await db.run(
      `UPDATE custom_sets SET name = ?, completion_mode = ?, rules_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [name, mode, JSON.stringify(rules), set.id, req.user.id]
    );
    res.json(shape(await ownedSet(set.id, req.user.id)));
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ error: error.message });
    console.error('Failed to update custom set:', error);
    res.status(500).json({ error: 'Failed to update custom set' });
  }
});

router.delete('/custom-sets/:id', async (req, res) => {
  try {
    const set = await ownedSet(req.params.id, req.user.id);
    if (!set) return res.status(404).json({ error: 'Custom set not found' });
    await db.withTransaction(async () => {
      await db.run(`DELETE FROM custom_set_cards WHERE custom_set_id = ?`, [set.id]);
      await db.run(`DELETE FROM custom_sets WHERE id = ? AND user_id = ?`, [set.id, req.user.id]);
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete custom set:', error);
    res.status(500).json({ error: 'Failed to delete custom set' });
  }
});

// Include a card the rules miss, or exclude one they wrongly match.
router.put('/custom-sets/:id/cards/:cardId', async (req, res) => {
  try {
    const set = await ownedSet(req.params.id, req.user.id);
    if (!set) return res.status(404).json({ error: 'Custom set not found' });
    const mode = req.body?.mode;
    if (!['include', 'exclude'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
    const card = await db.get(`SELECT id, game FROM card_cache WHERE id = ?`, [req.params.cardId]);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    if (card.game !== set.game) return res.status(400).json({ error: 'Card is from a different game' });
    await db.run(
      `INSERT INTO custom_set_cards (custom_set_id, card_id, mode) VALUES (?, ?, ?)
       ON CONFLICT(custom_set_id, card_id) DO UPDATE SET mode = excluded.mode`,
      [set.id, card.id, mode]
    );
    await db.run(`UPDATE custom_sets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [set.id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to update custom set card:', error);
    res.status(500).json({ error: 'Failed to update custom set card' });
  }
});

// Drop a manual include/exclude so the card follows the rules again.
router.delete('/custom-sets/:id/cards/:cardId', async (req, res) => {
  try {
    const set = await ownedSet(req.params.id, req.user.id);
    if (!set) return res.status(404).json({ error: 'Custom set not found' });
    await db.run(`DELETE FROM custom_set_cards WHERE custom_set_id = ? AND card_id = ?`, [set.id, req.params.cardId]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to reset custom set card:', error);
    res.status(500).json({ error: 'Failed to reset custom set card' });
  }
});

router.get('/custom-sets/:id/cards', async (req, res) => {
  try {
    const set = await ownedSet(req.params.id, req.user.id);
    if (!set) return res.status(404).json({ error: 'Custom set not found' });
    const language = resolveLanguage(set.game, req.query.lang);
    const { cards, truncated, excluded } = await resolveMembers(set, language);
    const entriesFor = await ownership(req.user.id, set.game);
    const wishlistFor = await ownership(req.user.id, set.game, 'wishlist');
    const slots = [];
    for (const card of cards) {
      const entries = entriesFor(card);
      const wished = wishlistFor(card);
      const { available_printings: printings, ...rest } = card;
      for (const printing of slotsFor(card, set.completion_mode)) {
        const ofSlot = list => (printing ? list.filter(e => (e.printing || 'Normal') === printing) : list);
        const matching = ofSlot(entries);
        slots.push({
          ...rest,
          available_printings: printings,
          slot_printing: printing,
          owned: matching.length > 0 ? 1 : 0,
          owned_qty: matching.reduce((sum, e) => sum + (e.quantity || 0), 0),
          wishlisted: ofSlot(wished).length > 0 ? 1 : 0,
        });
      }
    }
    const excludedCards = excluded.length
      ? await db.all(
        `SELECT ${CARD_COLUMNS} FROM card_cache cc WHERE cc.id IN (${excluded.map(() => '?').join(', ')})`,
        excluded
      )
      : [];
    res.json({ set: shape(set), cards: slots, truncated, excluded: excludedCards });
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ error: error.message });
    console.error('Failed to resolve custom set cards:', error);
    res.status(500).json({ error: 'Failed to load custom set cards' });
  }
});

// Distinct illustrators/rarities already cached for a game, for the editor's
// suggestions. Only reflects cards Bindarr has seen.
router.get('/custom-sets-suggestions', async (req, res) => {
  try {
    const { game, field } = req.query;
    if (!GAMES.includes(game)) return res.status(400).json({ error: 'Invalid game' });
    const column = { illustrator: 'illustrator', rarity: 'rarity' }[field];
    if (!column) return res.status(400).json({ error: 'Invalid field' });
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, MAX_TERM) : '';
    const rows = await db.all(
      `SELECT ${column} AS value, COUNT(*) AS cards FROM card_cache
       WHERE game = ? AND NULLIF(TRIM(${column}), '') IS NOT NULL
         ${q ? `AND instr(lower(${column}), lower(?)) > 0` : ''}
       GROUP BY ${column} ORDER BY cards DESC, ${column} LIMIT 100`,
      q ? [game, q] : [game]
    );
    res.json(rows);
  } catch (error) {
    console.error('Failed to load custom set suggestions:', error);
    res.status(500).json({ error: 'Failed to load suggestions' });
  }
});

// Search the provider for each name rule. Providers cache what they return, so
// the rules then see printings nobody has searched for yet. Bounded per call.
router.post('/custom-sets/:id/sync', searchLimiter, async (req, res) => {
  try {
    const set = await ownedSet(req.params.id, req.user.id);
    if (!set) return res.status(404).json({ error: 'Custom set not found' });
    const language = resolveLanguage(set.game, req.query.lang || req.body?.lang);
    const rules = parseRules(set.rules_json);
    if (!rules.names.length) return res.status(400).json({ error: 'Add a name rule to fetch cards from the provider' });
    const api = await searchApiFor(set.game, language ? languages.toCode(language) : null);
    if (api.localOnly) return res.json({ fetched: 0, local: true });
    let fetched = 0;
    for (const name of rules.names.slice(0, SYNC_TERMS)) {
      for (let page = 1; page <= SYNC_PAGES; page++) {
        const { cards = [], total } = await api.searchCards({
          name, scope: 'internet', userId: req.user.id, apiKey: req.user.tcg_api_key,
          lang: language ? languages.toCode(language) : undefined, allPrints: true, page, limit: SYNC_PAGE_SIZE,
        });
        fetched += cards.length;
        if (cards.length < SYNC_PAGE_SIZE || (total != null && page * SYNC_PAGE_SIZE >= total)) break;
      }
    }
    res.json({ fetched, terms: Math.min(rules.names.length, SYNC_TERMS) });
  } catch (error) {
    if (error instanceof InputError) return res.status(400).json({ error: error.message });
    console.error('Failed to sync custom set cards:', error);
    if (error.message === 'RATE_LIMIT_EXCEEDED') return res.status(429).json({ error: 'Rate limit exceeded' });
    res.status(502).json({ error: 'Could not fetch cards from the provider' });
  }
});

module.exports = router;
module.exports._test = { cleanRules, numberKey };
