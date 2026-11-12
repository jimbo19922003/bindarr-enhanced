'use strict';

const { randomBytes, createHash } = require('node:crypto');
const axios = require('axios');
const { resolveCardPrice, FINISH_COLUMNS } = require('./priceHelpers');
const { createReportingValuation } = require('./reportingValuation');
const sealedTrades = require('./tradeSealed');

// Card entry IDs remain numbers; sealed listing IDs have a separate, stable namespace.
const isSealedId = value => typeof value === 'string' && /^sealed:[1-9]\d*$/.test(value)
  && Number.isSafeInteger(Number(value.slice(7)));
const validEntryId = value => (Number.isSafeInteger(value) && value > 0) || isSealedId(value);

const schema = [
  `CREATE TABLE IF NOT EXISTS trade_portal (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    currency TEXT NOT NULL DEFAULT 'USD',
    discord_webhook TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS trade_request (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    discord_contact TEXT NOT NULL,
    message TEXT NOT NULL,
    proposal_json TEXT NOT NULL,
    notification TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, request_key)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_trade_request_inbox ON trade_request(user_id, id)',
  `CREATE TABLE IF NOT EXISTS trade_binder (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX IF NOT EXISTS idx_trade_binder_user ON trade_binder(user_id)',
  `CREATE TABLE IF NOT EXISTS trade_binder_item (
    binder_id INTEGER NOT NULL REFERENCES trade_binder(id) ON DELETE CASCADE,
    entry_id INTEGER NOT NULL,
    PRIMARY KEY(binder_id, entry_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_trade_binder_item_entry ON trade_binder_item(entry_id)',
  `CREATE TABLE IF NOT EXISTS trade_execution (
    request_id INTEGER PRIMARY KEY REFERENCES trade_request(id),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    completed_on TEXT NOT NULL,
    currency TEXT NOT NULL,
    given_cents INTEGER,
    received_cents INTEGER NOT NULL,
    cash_in_cents INTEGER NOT NULL,
    cash_out_cents INTEGER NOT NULL,
    realized_gain_cents INTEGER,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

const REQUEST_COLUMNS = [
  ['binder_id', 'INTEGER'],
  ['binder_name', 'TEXT'],
  ['status', "TEXT NOT NULL DEFAULT 'new'"],
  ['owner_note', "TEXT NOT NULL DEFAULT ''"],
  ['updated_at', 'TEXT'],
];

// CREATE TABLE IF NOT EXISTS never upgrades an existing trade_request table.
async function prepare(sql) {
  for (const statement of schema) await sql.run(statement);
  await sealedTrades.prepare(sql);
  const columns = new Set((await sql.all('PRAGMA table_info(trade_request)')).map(column => column.name));
  for (const [name, type] of REQUEST_COLUMNS) {
    if (!columns.has(name)) await sql.run(`ALTER TABLE trade_request ADD COLUMN ${name} ${type}`);
  }
  await sql.run('CREATE INDEX IF NOT EXISTS idx_trade_request_status ON trade_request(user_id, status, id)');
}

const STATUSES = ['new', 'active', 'declined', 'completed', 'archived'];
const MAX_BINDERS = 25;
const MAX_TRADE_CENTS = 100_000_000;

const fail = (status, message) => Object.assign(new Error(message), { status });
const token = () => randomBytes(32).toString('hex');
const text = (value, limit, label, required = false) => {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)
    || (required && !value.trim())) throw fail(400, `Invalid ${label}`);
  return value.trim();
};

function webhookUrl(value) {
  const raw = text(value, 400, 'Discord webhook URL');
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw fail(400, 'Use an HTTPS discord.com webhook URL'); }
  if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port || url.username || url.password
    || url.search || url.hash || !/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{30,200}$/.test(url.pathname)) {
    throw fail(400, 'Use an HTTPS discord.com webhook URL');
  }
  return url.href;
}

const MAX_CASH_CENTS = 10_000_000;

function selections(value, { allowEmpty = false } = {}) {
  if (allowEmpty && (value == null || (Array.isArray(value) && !value.length))) return [];
  if (!Array.isArray(value) || !value.length || value.length > 50) throw fail(400, 'Select between 1 and 50 cards on each side');
  const seen = new Set();
  return value.map(item => {
    if (!item || !validEntryId(item.entry_id) || seen.has(item.entry_id)
      || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) {
      throw fail(400, 'Card selections need unique IDs and positive whole quantities');
    }
    seen.add(item.entry_id);
    return { entry_id: item.entry_id, quantity: item.quantity };
  }).sort((a, b) => String(a.entry_id).localeCompare(String(b.entry_id), 'en', { numeric: true }));
}

function cashCents(value) {
  if (value == null) return 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CASH_CENTS) throw fail(400, 'Cash must be a whole number of cents between 0 and 100000.00');
  return value;
}

// Visitors give wanted cards and/or cash; they always ask for at least one listed card.
function offer(body) {
  const requested = selections(body.requested), offered = selections(body.offered, { allowEmpty: true });
  const cash = cashCents(body.cash_cents);
  if (!offered.length && !cash) throw fail(400, 'Offer at least one wanted card or a cash amount');
  return { requested, offered, cash_cents: cash };
}

function summarize(requested, offered, currency, cash = 0) {
  const total = lines => {
    let known = 0, unknown = 0;
    for (const line of lines) {
      // Stacked lines carry per-copy totals; copies of one stack can be priced differently.
      if (line.known_cents !== undefined) {
        known += line.known_cents;
        unknown += line.unknown_quantity;
      } else if (line.unit_cents == null) unknown += line.quantity;
      else known += line.unit_cents * line.quantity;
      if (!Number.isSafeInteger(known)) throw fail(400, 'Trade value is too large');
    }
    return { known_cents: known, unknown_quantity: unknown };
  };
  const receive = total(requested), give = total(offered);
  give.known_cents += cash;
  if (!Number.isSafeInteger(give.known_cents)) throw fail(400, 'Trade value is too large');
  const complete = receive.unknown_quantity === 0 && give.unknown_quantity === 0;
  const difference = complete ? give.known_cents - receive.known_cents : null;
  return {
    currency, requested: receive, offered: give, cash_cents: cash,
    difference_cents: difference,
    difference_percent: complete && receive.known_cents > 0
      ? Math.round(difference / receive.known_cents * 1000) / 10 : null,
  };
}

async function postDiscord(url, contact, proposal, id, binderName = null) {
  const lines = items => items.map(card =>
    `${card.quantity}x ${card.name} (${card.kind === 'sealed'
      ? `sealed ${card.product_type}; ${card.set_name}; ${card.language}`
      : `${card.set_name} #${card.number}; ${card.printing}; ${card.language}; ${card.condition}`})`
  ).join('\n').slice(0, 1000) || 'None';
  const cash = proposal.summary.cash_cents || 0;
  await axios.post(url, {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `Bindarr trade request #${id}${binderName ? ` via ${binderName}` : ''}`.slice(0, 256),
      description: `Discord contact: ${contact}`,
      fields: [
        { name: 'Items requested from you', value: lines(proposal.requested) },
        { name: 'Items offered to you', value: lines(proposal.offered) },
        ...(cash ? [{ name: 'Cash offered to you', value: `${(cash / 100).toFixed(2)} ${proposal.summary.currency}` }] : []),
        { name: 'Estimated balance (offered minus requested)', value: proposal.summary.difference_percent == null
          ? 'Unknown: missing prices or no comparison value'
          : `${proposal.summary.difference_percent > 0 ? '+' : ''}${proposal.summary.difference_percent}% (${proposal.summary.currency})` },
      ],
      footer: { text: 'Open Trades > Inbox in Bindarr for the full proposal and message. Inventory is unchanged.' },
    }],
  }, { timeout: 8000, maxRedirects: 0 });
}

function createTradePortal({ db, connect = () => require('./salesRepository').openConnection(db.dbPath), valuationFor = createReportingValuation, notify = postDiscord }) {
  async function settings(userId) {
    await db.run('INSERT OR IGNORE INTO trade_portal(user_id, token) VALUES (?, ?)', [userId, token()]);
    const row = await db.get('SELECT * FROM trade_portal WHERE user_id = ?', [userId]);
    return { enabled: !!row.enabled, token: row.token, currency: row.currency, webhook_configured: !!row.discord_webhook };
  }

  async function update(userId, body) {
    if (typeof body.enabled !== 'boolean') throw fail(400, 'Enabled must be a boolean');
    const currency = String(body.currency || '').toUpperCase();
    valuationFor(currency);
    const webhook = body.discord_webhook === undefined ? undefined : webhookUrl(body.discord_webhook);
    await settings(userId);
    await db.run(`UPDATE trade_portal SET enabled = ?, currency = ?
      ${webhook === undefined ? '' : ', discord_webhook = ?'} WHERE user_id = ?`,
    [body.enabled ? 1 : 0, currency, ...(webhook === undefined ? [] : [webhook]), userId]);
    return settings(userId);
  }

  async function owner(shareToken, sql = db) {
    if (!/^[a-f0-9]{64}$/.test(shareToken)) throw fail(404, 'Trade page not found');
    const row = await sql.get(`SELECT p.*, u.username, NULL AS binder_id, NULL AS binder_name
      FROM trade_portal p JOIN users u ON u.id = p.user_id
      WHERE p.token = ? AND p.enabled = 1`, [shareToken])
      || await sql.get(`SELECT p.*, u.username, b.id AS binder_id, b.name AS binder_name
      FROM trade_binder b JOIN trade_portal p ON p.user_id = b.user_id JOIN users u ON u.id = b.user_id
      WHERE b.token = ? AND b.enabled = 1`, [shareToken]);
    if (!row) throw fail(404, 'Trade page not found');
    return row;
  }

  async function cards(userId, ids, sql = db, binderId = null) {
    if (ids && !ids.length) return [];
    const cardIds = ids?.filter(value => !isSealedId(value));
    const cardRows = cardIds && !cardIds.length ? [] : await sql.all(`SELECT c.id AS entry_id, c.card_id, c.quantity, c.condition, c.printing, c.language,
      c.grader, c.grade, c.market_value, c.list_type, c.is_trade,
      cc.name, cc.printed_name, cc.set_name, cc.number, cc.image_url, cc.game, cc.rarity,
      cc.price_trend, cc.price_normal, cc.price_holofoil, cc.price_reverse_holofoil, cc.price_1st_edition,
      cc.price_currency, cc.price_source
      FROM collection c JOIN card_cache cc ON cc.id = c.card_id
      WHERE c.user_id = ? AND c.quantity > 0
      AND (c.list_type = 'wishlist' OR (c.list_type = 'collection' AND c.is_trade = 1))
      ${cardIds ? `AND c.id IN (${cardIds.map(() => '?').join(',')})` : ''}
      ${binderId ? 'AND c.id IN (SELECT entry_id FROM trade_binder_item WHERE binder_id = ?)' : ''}
      ORDER BY cc.name, c.id`, [userId, ...(cardIds || []), ...(binderId ? [binderId] : [])]);
    return [...cardRows, ...await sealedTrades.rows(sql, userId, { ids: ids ?? undefined, binderId })];
  }

  async function present(row, valuation) {
    const isSealed = row.kind === 'sealed';
    const price = isSealed ? (row.market_price_cents == null ? NaN : row.market_price_cents / 100) : Number(resolveCardPrice(row));
    let unitCents = null, priceState = 'unknown';
    const exact = row.market_value > 0 || (FINISH_COLUMNS[row.printing] && row[FINISH_COLUMNS[row.printing]] > 0);
    if (Number.isFinite(price) && (price > 0 || (isSealed && price === 0))) {
      try {
        unitCents = await valuation.cents(Math.round(price * 100), (isSealed ? row.market_currency : row.price_currency) || 'USD');
        priceState = isSealed || exact ? 'priced' : 'estimate';
      } catch (error) {
        if (error.code !== 'VALUATION_FX_UNAVAILABLE') throw error;
        priceState = 'fx_unavailable';
      }
    }
    return {
      kind: isSealed ? 'sealed' : 'card',
      ...(isSealed ? { product_id: row.product_id, product_type: row.product_type } : {}),
      entry_id: row.entry_id, card_id: row.card_id, name: row.name, printed_name: row.printed_name,
      set_name: row.set_name, number: row.number, image_url: row.image_url, game: row.game, rarity: row.rarity || null,
      quantity: row.quantity, condition: row.condition, printing: row.printing, language: row.language,
      grader: row.grader, grade: row.grade, unit_cents: unitCents, price_state: priceState,
    };
  }

  // Identical copies (same card, condition, printing, language and grade) are one stack.
  // A stack is addressed by its lowest copy ID; selling that copy makes stale pages refresh.
  async function stacks(rows, valuation) {
    const byKey = new Map();
    for (const row of rows) {
      const card = await present(row, valuation);
      const key = row.kind === 'sealed' ? row.entry_id : JSON.stringify([row.list_type, row.card_id, row.condition, row.printing, row.language,
        row.grader || 'Raw', row.grade ?? null]);
      const copy = { entry_id: row.entry_id, quantity: row.quantity, unit_cents: card.unit_cents, price_state: card.price_state };
      const stack = byKey.get(key);
      if (stack) {
        stack.quantity += row.quantity;
        stack.copies.push(copy);
      } else byKey.set(key, { ...card, list_type: row.list_type, copies: [copy] });
    }
    return [...byKey.values()];
  }

  const publicStack = ({ copies, list_type: _listType, ...card }) => ({
    ...card, price_varies: new Set(copies.map(copy => copy.unit_cents)).size > 1,
  });

  async function listing(shareToken) {
    const user = await owner(shareToken), valuation = valuationFor(user.currency);
    const available = [], wanted = [];
    for (const stack of await stacks(await cards(user.user_id, null, db, user.binder_id), valuation)) {
      (stack.list_type === 'wishlist' ? wanted : available).push(publicStack(stack));
    }
    return { owner: user.username, binder: user.binder_name, currency: user.currency, available, wanted, ...valuation.metadata() };
  }

  async function proposal(user, body, sql = db) {
    const { requested, offered, cash_cents: cash } = offer(body);
    const valuation = valuationFor(user.currency);
    const byId = new Map((await stacks(await cards(user.user_id, null, sql, user.binder_id), valuation)).map(stack => [stack.entry_id, stack]));
    const side = (items, listType) => items.map(item => {
      const stack = byId.get(item.entry_id);
      if (!stack || stack.list_type !== listType || item.quantity > stack.quantity) {
        throw fail(409, 'A selected card is no longer available in that quantity. Refresh the trade page.');
      }
      let left = item.quantity, known = 0, unknown = 0;
      const entryIds = [], allocations = [], states = new Set();
      for (const copy of stack.copies) {
        if (!left) break;
        const take = Math.min(left, copy.quantity);
        left -= take;
        entryIds.push(copy.entry_id);
        allocations.push({ entry_id: copy.entry_id, quantity: take });
        states.add(copy.price_state);
        if (copy.unit_cents == null) unknown += take; else known += copy.unit_cents * take;
      }
      const priceState = ['fx_unavailable', 'unknown', 'estimate'].find(state => states.has(state)) || 'priced';
      return { ...publicStack(stack), quantity: item.quantity, entry_ids: entryIds, allocations, price_state: priceState,
        unit_cents: unknown ? null : Math.round(known / item.quantity), known_cents: known, unknown_quantity: unknown };
    });
    const receive = side(requested, 'collection'), give = side(offered, 'wishlist');
    return { requested: receive, offered: give, summary: summarize(receive, give, user.currency, cash), ...valuation.metadata() };
  }

  async function deliver(userId, id) {
    const user = await db.get('SELECT discord_webhook FROM trade_portal WHERE user_id = ?', [userId]);
    const row = await db.get('SELECT * FROM trade_request WHERE user_id = ? AND id = ?', [userId, id]);
    if (!row) throw fail(404, 'Trade request not found');
    let state = 'not_configured';
    if (user?.discord_webhook) {
      try {
        await notify(webhookUrl(user.discord_webhook), row.discord_contact, JSON.parse(row.proposal_json), row.id, row.binder_name);
        state = 'delivered';
      } catch (error) {
        console.error('Trade Discord notification failed', error.code || 'DELIVERY_FAILED');
        state = 'failed';
      }
    }
    await db.run('UPDATE trade_request SET notification = ? WHERE user_id = ? AND id = ?', [state, userId, id]);
    return state;
  }

  async function submit(shareToken, body) {
    const user = await owner(shareToken);
    const contact = text(body.discord_contact, 100, 'Discord contact', true);
    if (/[\r\n]/.test(contact)) throw fail(400, 'Discord contact must be a single line');
    const message = text(body.message ?? '', 1000, 'message');
    if (typeof body.request_key !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(body.request_key)) throw fail(400, 'A valid request key is required');
    const clean = { ...offer(body), discord_contact: contact, message };
    const hash = createHash('sha256').update(JSON.stringify(clean)).digest('hex');
    const sql = await connect();
    let saved, began = false;
    try {
      await sql.run('BEGIN IMMEDIATE');
      began = true;
      // Recheck the token after waiting for the write lock: disabling/rotating revokes it immediately.
      const current = await owner(shareToken, sql);
      const prior = await sql.get('SELECT id, payload_hash, notification FROM trade_request WHERE user_id = ? AND request_key = ?', [user.user_id, body.request_key]);
      if (prior) {
        if (prior.payload_hash !== hash) throw fail(409, 'Request key was already used for a different proposal');
        saved = { id: prior.id, notification: prior.notification, replayed: true };
      } else {
        const quote = await proposal(current, clean, sql);
        const inserted = await sql.run(`INSERT INTO trade_request
          (user_id, request_key, payload_hash, discord_contact, message, proposal_json, binder_id, binder_name, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [user.user_id, body.request_key, hash, contact, message, JSON.stringify(quote), current.binder_id, current.binder_name]);
        saved = { id: inserted.lastID, replayed: false };
      }
      await sql.run('COMMIT');
      began = false;
    } catch (error) {
      if (began) await sql.run('ROLLBACK');
      throw error;
    } finally { await sql.close(); }
    if (!saved.replayed) saved.notification = await deliver(user.user_id, saved.id);
    return saved;
  }

  async function transaction(work, { rollback = false } = {}) {
    const sql = await connect();
    let began = false;
    try {
      await sql.run('BEGIN IMMEDIATE');
      began = true;
      const result = await work(sql);
      await sql.run(rollback ? 'ROLLBACK' : 'COMMIT');
      began = false;
      return result;
    } catch (error) {
      if (began) await sql.run('ROLLBACK').catch(() => {});
      throw error;
    } finally { await sql.close(); }
  }

  const id = (value, label = 'ID') => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) throw fail(400, `Invalid ${label}`);
    return number;
  };
  const ids = (value, label, max = 1000) => {
    if (!Array.isArray(value) || value.length > max) throw fail(400, `Invalid ${label}`);
    const list = [...new Set(value.map(item => id(item, label)))];
    return list;
  };
  const entryIds = (value, max = 1000) => {
    if (!Array.isArray(value) || value.length > max || value.some(item => !validEntryId(item))) throw fail(400, 'Invalid item selection');
    return [...new Set(value)];
  };
  const binderName = value => text(value, 60, 'trade page name', true);
  const presentBinder = row => ({ id: row.id, name: row.name, token: row.token, enabled: !!row.enabled,
    created_at: row.created_at, items: row.items ?? 0 });

  async function binder(userId, binderId, sql = db) {
    const row = await sql.get('SELECT * FROM trade_binder WHERE id = ? AND user_id = ?', [id(binderId, 'trade page'), userId]);
    if (!row) throw fail(404, 'Trade page not found');
    return row;
  }

  async function binders(userId) {
    const rows = await db.all(`SELECT b.*, (SELECT COUNT(*) FROM trade_binder_item i
        JOIN collection c ON c.id = i.entry_id AND c.user_id = b.user_id AND c.quantity > 0
        AND (c.list_type = 'wishlist' OR (c.list_type = 'collection' AND c.is_trade = 1))
        WHERE i.binder_id = b.id) AS items
      FROM trade_binder b WHERE b.user_id = ? ORDER BY b.name COLLATE NOCASE, b.id`, [userId]);
    for (const row of rows) row.items += (await sealedTrades.rows(db, userId, { binderId: row.id })).length;
    return rows.map(presentBinder);
  }

  async function createBinder(userId, body) {
    const name = binderName(body.name);
    await settings(userId);
    return transaction(async sql => {
      const { count } = await sql.get('SELECT COUNT(*) AS count FROM trade_binder WHERE user_id = ?', [userId]);
      if (count >= MAX_BINDERS) throw fail(409, `You can have up to ${MAX_BINDERS} trade pages`);
      const inserted = await sql.run('INSERT INTO trade_binder(user_id, name, token, enabled) VALUES (?, ?, ?, ?)',
        [userId, name, token(), body.enabled === false ? 0 : 1]);
      return presentBinder(await binder(userId, inserted.lastID, sql));
    });
  }

  async function updateBinder(userId, binderId, body) {
    const row = await binder(userId, binderId);
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw fail(400, 'Enabled must be a boolean');
    const name = body.name === undefined ? row.name : binderName(body.name);
    const enabled = body.enabled === undefined ? row.enabled : body.enabled ? 1 : 0;
    await db.run('UPDATE trade_binder SET name = ?, enabled = ? WHERE id = ? AND user_id = ?', [name, enabled, row.id, userId]);
    return presentBinder(await binder(userId, row.id));
  }

  // Binder membership is limited to the owner's currently listed trade copies and wanted entries.
  async function assign(userId, body) {
    const entries = entryIds(body.entry_ids);
    const addTo = ids(body.add_to ?? [], 'trade page', MAX_BINDERS), removeFrom = ids(body.remove_from ?? [], 'trade page', MAX_BINDERS);
    if (!entries.length || (!addTo.length && !removeFrom.length)) throw fail(400, 'Choose items and a trade page');
    return transaction(async sql => {
      for (const binderId of [...addTo, ...removeFrom]) await binder(userId, binderId, sql);
      if (addTo.length && (await cards(userId, entries, sql)).length !== entries.length) {
        throw fail(409, 'Only items listed for trade or on your wanted list can be added to a trade page');
      }
      for (const binderId of removeFrom) {
        await sql.run(`DELETE FROM trade_binder_item WHERE binder_id = ? AND entry_id IN (${entries.map(() => '?').join(',')})`,
          [binderId, ...entries]);
      }
      for (const binderId of addTo) {
        for (const entryId of entries) await sql.run('INSERT OR IGNORE INTO trade_binder_item(binder_id, entry_id) VALUES (?, ?)', [binderId, entryId]);
      }
      return { ok: true };
    });
  }

  // Master list: every listed copy and wanted entry, stacked, with the binders holding each stack.
  async function items(userId) {
    const portal = await settings(userId), valuation = valuationFor(portal.currency);
    const membership = new Map();
    for (const row of await db.all(`SELECT i.binder_id, i.entry_id FROM trade_binder_item i
      JOIN trade_binder b ON b.id = i.binder_id WHERE b.user_id = ?`, [userId])) {
      if (!membership.has(row.entry_id)) membership.set(row.entry_id, new Set());
      membership.get(row.entry_id).add(row.binder_id);
    }
    const available = [], wanted = [];
    for (const stack of await stacks(await cards(userId), valuation)) {
      const entryIds = stack.copies.map(copy => copy.entry_id);
      const binderIds = [...new Set(entryIds.flatMap(entryId => [...(membership.get(entryId) || [])]))].sort((a, b) => a - b);
      const known = stack.copies.reduce((sum, copy) => sum + (copy.unit_cents ?? 0) * copy.quantity, 0);
      (stack.list_type === 'wishlist' ? wanted : available).push({ ...publicStack(stack), list_type: stack.list_type,
        entry_ids: entryIds, binder_ids: binderIds, known_cents: known,
        unknown_quantity: stack.copies.filter(copy => copy.unit_cents == null).reduce((sum, copy) => sum + copy.quantity, 0) });
    }
    return { currency: portal.currency, available, wanted, ...valuation.metadata() };
  }

  // Trade copies become ordinary collection copies again; wanted entries are removed from the wishlist.
  async function unlist(userId, body) {
    const entries = entryIds(body.entry_ids);
    if (!entries.length) throw fail(400, 'Choose cards to remove');
    return transaction(async sql => {
      const rows = await cards(userId, entries, sql);
      if (rows.length !== entries.length) throw fail(409, 'Some cards are no longer listed. Refresh and try again.');
      const marks = entries.map(() => '?').join(',');
      const copies = rows.filter(row => row.kind !== 'sealed' && row.list_type === 'collection').map(row => row.entry_id);
      const wants = rows.filter(row => row.kind !== 'sealed' && row.list_type === 'wishlist').map(row => row.entry_id);
      if (copies.length) await sql.run(`UPDATE collection SET is_trade = 0 WHERE user_id = ? AND list_type = 'collection' AND id IN (${copies.map(() => '?').join(',')})`, [userId, ...copies]);
      if (wants.length) await sql.run(`DELETE FROM collection WHERE user_id = ? AND list_type = 'wishlist' AND id IN (${wants.map(() => '?').join(',')})`, [userId, ...wants]);
      await sealedTrades.unlist(sql, userId, entries.filter(isSealedId));
      await sql.run(`DELETE FROM trade_binder_item WHERE entry_id IN (${marks})
        AND binder_id IN (SELECT id FROM trade_binder WHERE user_id = ?)`, [...entries, userId]);
      return { unlisted: rows.filter(row => row.list_type === 'collection').length,
        removed_wanted: rows.filter(row => row.list_type === 'wishlist').length };
    });
  }

  async function tradeRequest(userId, requestId, sql = db) {
    const row = await sql.get('SELECT * FROM trade_request WHERE user_id = ? AND id = ?', [userId, id(requestId, 'trade request')]);
    if (!row) throw fail(404, 'Trade request not found');
    return row;
  }

  const presentRequest = ({ proposal_json: proposalJson, request_key: _key, payload_hash: _hash, user_id: _user, execution_json: executionJson, ...row }) => ({
    ...row, status: row.status || 'new', proposal: JSON.parse(proposalJson),
    execution: executionJson ? JSON.parse(executionJson) : null,
  });

  async function inbox(userId, before, status = 'all') {
    if (before != null && (!Number.isSafeInteger(before) || before < 1)) throw fail(400, 'Invalid inbox cursor');
    if (status !== 'all' && !STATUSES.includes(status)) throw fail(400, 'Invalid trade status');
    const filters = [...(before ? ['r.id < ?'] : []), ...(status === 'all' ? [] : ['r.status = ?'])];
    const rows = await db.all(`SELECT r.*, e.result_json AS execution_json FROM trade_request r
      LEFT JOIN trade_execution e ON e.request_id = r.id
      WHERE r.user_id = ? ${filters.map(filter => `AND ${filter}`).join(' ')} ORDER BY r.id DESC LIMIT 20`,
    [userId, ...(before ? [before] : []), ...(status === 'all' ? [] : [status])]);
    return { requests: rows.map(presentRequest), next_before: rows.length === 20 ? rows[rows.length - 1].id : null };
  }

  async function counts(userId) {
    const result = Object.fromEntries(STATUSES.map(status => [status, 0]));
    for (const row of await db.all('SELECT status, COUNT(*) AS count FROM trade_request WHERE user_id = ? GROUP BY status', [userId])) {
      if (row.status in result) result[row.status] = row.count;
    }
    return result;
  }

  async function updateRequest(userId, requestId, body) {
    const row = await tradeRequest(userId, requestId);
    const note = body.owner_note === undefined ? row.owner_note : text(body.owner_note, 2000, 'note');
    let status = row.status;
    if (body.status !== undefined) {
      if (!['new', 'active', 'declined', 'archived'].includes(body.status)) throw fail(400, 'Use the completion workflow to complete a trade');
      if (row.status === 'completed' && body.status !== 'completed') throw fail(409, 'Completed trades stay in history and cannot be reopened');
      status = body.status;
    }
    await db.run('UPDATE trade_request SET status = ?, owner_note = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?',
      [status, note, userId, row.id]);
    return presentRequest(await db.get(`SELECT r.*, e.result_json AS execution_json FROM trade_request r
      LEFT JOIN trade_execution e ON e.request_id = r.id WHERE r.id = ?`, [row.id]));
  }

  const copyIds = line => Array.isArray(line.entry_ids) ? line.entry_ids : [line.entry_id];
  const cacheColumns = `cc.name, cc.printed_name, cc.set_name, cc.number, cc.image_url, cc.game,
    cc.price_trend, cc.price_normal, cc.price_holofoil, cc.price_reverse_holofoil, cc.price_1st_edition,
    cc.price_currency, cc.price_source`;

  // Completion is booked in USD because card sales and acquisition basis are USD-only.
  async function completionDraft(userId, requestId, sql = db) {
    const row = await tradeRequest(userId, requestId, sql);
    if (row.status === 'completed') throw fail(409, 'This trade is already completed');
    const proposalData = JSON.parse(row.proposal_json), usd = valuationFor('USD');
    const givenIds = [...new Set(proposalData.requested.flatMap(copyIds))];
    const cardIds = givenIds.filter(value => !isSealedId(value));
    const copies = cardIds.length ? await sql.all(`SELECT c.id AS entry_id, c.card_id, c.quantity, c.condition, c.printing,
        c.language, c.grader, c.grade, c.market_value, c.list_type, ${cacheColumns}
      FROM collection c JOIN card_cache cc ON cc.id = c.card_id
      WHERE c.user_id = ? AND c.id IN (${cardIds.map(() => '?').join(',')})`, [userId, ...cardIds]) : [];
    copies.push(...await sealedTrades.rows(sql, userId, { ids: givenIds.filter(isSealedId) }));
    const byId = new Map(copies.map(copy => [copy.entry_id, copy]));
    const given = [];
    for (const entryId of givenIds) {
      const copy = byId.get(entryId);
      if (!copy) { given.push({ entry_id: entryId, available: false, reason: 'missing' }); continue; }
      const card = await present(copy, usd);
      if (copy.kind === 'sealed') {
        const proposed = proposalData.requested.find(line => line.entry_id === entryId);
        const quantity = Math.min(copy.quantity, proposed.quantity);
        given.push({ ...card, lot_id: copy.lot_id, currency: copy.currency, quantity, max_quantity: quantity,
          available: copy.list_type === 'collection' && quantity > 0, value_cents: card.unit_cents });
        continue;
      }
      given.push({ ...card, quantity: 1, available: copy.list_type === 'collection' && copy.quantity === 1,
        reason: copy.list_type !== 'collection' ? copy.list_type : copy.quantity !== 1 ? 'split' : null, value_cents: card.unit_cents });
    }
    const received = [];
    for (const [index, line] of proposalData.offered.entries()) {
      if (line.kind === 'sealed') {
        const product = await sql.get('SELECT * FROM sealed_product WHERE id = ? AND user_id = ? AND archived_at IS NULL',
          [line.product_id, userId]);
        const card = product ? await present({ ...product, kind: 'sealed', product_id: product.id }, usd) : null;
        received.push({ ...line, index, available: !!product, unit_cents: card?.unit_cents ?? null,
          wishlist_ids: copyIds(line) });
        continue;
      }
      const cache = await sql.get(`SELECT cc.id AS card_id, ${cacheColumns} FROM card_cache cc WHERE cc.id = ?`, [line.card_id]);
      const card = cache ? await present({ ...cache, entry_id: null, quantity: line.quantity, condition: line.condition,
        printing: line.printing, language: line.language, grader: line.grader, grade: line.grade, market_value: null }, usd) : null;
      received.push({ index, card_id: line.card_id, name: line.name, printed_name: line.printed_name, set_name: line.set_name,
        number: line.number, image_url: line.image_url, game: line.game, condition: line.condition, printing: line.printing,
        language: line.language, grader: line.grader, grade: line.grade, quantity: line.quantity,
        unit_cents: card?.unit_cents ?? null, wishlist_ids: copyIds(line) });
    }
    let cashIn = proposalData.summary.cash_cents || 0;
    if (cashIn) {
      try { cashIn = await usd.cents(cashIn, proposalData.summary.currency || 'USD'); }
      catch (error) { if (error.code !== 'VALUATION_FX_UNAVAILABLE') throw error; cashIn = null; }
    }
    return { id: row.id, contact: row.discord_contact, currency: 'USD', proposal_currency: proposalData.summary.currency,
      proposal_cash_cents: proposalData.summary.cash_cents || 0, given, received, cash_in_cents: cashIn,
      completed_on: new Date().toISOString().slice(0, 10) };
  }

  const money = (value, label) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TRADE_CENTS) throw fail(400, `Invalid ${label}`);
    return value;
  };

  // Largest-remainder split so allocated proceeds always add up to the exact total.
  function allocate(total, weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    const shares = weights.map(weight => total * weight / sum);
    const result = shares.map(Math.floor);
    let left = total - result.reduce((a, b) => a + b, 0);
    const order = shares.map((share, index) => [share - Math.floor(share), index]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (let i = 0; left > 0; i = (i + 1) % order.length, left--) result[order[i][1]]++;
    return result;
  }

  function completionTerms(draft, body) {
    const date = body.completed_on;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
      || new Date(date).toISOString().slice(0, 10) !== date) throw fail(400, 'Invalid trade date');
    const selected = body.given ?? [];
    if (!Array.isArray(selected)) throw fail(400, 'Invalid given items');
    const givenIds = entryIds(selected.map(item => typeof item === 'object' && item !== null ? item.entry_id : item));
    if (givenIds.length !== selected.length) throw fail(400, 'Duplicate given items');
    const given = givenIds.map((entryId, index) => {
      const copy = draft.given.find(item => item.entry_id === entryId);
      if (!copy) throw fail(400, 'Given cards must come from the proposal');
      if (!copy.available) throw fail(409, 'A given card is no longer in your collection');
      const quantity = typeof selected[index] === 'object' ? selected[index].quantity : 1;
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > (copy.max_quantity ?? 1)) throw fail(409, 'Invalid given quantity');
      return { ...copy, quantity };
    });
    if (!Array.isArray(body.received) || body.received.length > draft.received.length) throw fail(400, 'Invalid received cards');
    const seen = new Set();
    const received = body.received.map(item => {
      const line = draft.received.find(candidate => candidate.index === item?.index);
      if (!line || seen.has(line.index)) throw fail(400, 'Received cards must come from the proposal');
      if (line.available === false) throw fail(409, 'A received product is no longer available. Restore its catalogue entry first.');
      seen.add(line.index);
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) throw fail(400, 'Invalid received quantity');
      return { ...line, quantity: item.quantity, unit_cents: money(item.unit_cents, 'received card value') };
    });
    const other = money(body.other_received_cents ?? 0, 'other received value');
    const cashIn = money(body.cash_in_cents ?? 0, 'cash received'), cashOut = money(body.cash_out_cents ?? 0, 'cash paid');
    if (!given.length && !received.length) throw fail(400, 'Select at least one card given or received');
    const receivedCents = received.reduce((sum, line) => sum + line.unit_cents * line.quantity, 0) + other;
    money(receivedCents, 'total received value');
    const proceeds = receivedCents + cashIn - cashOut;
    if (proceeds > MAX_TRADE_CENTS) throw fail(400, 'Total proceeds are too large');
    if (given.length && proceeds < 0) throw fail(400, 'Cash paid is larger than everything received, so the cards given would have negative proceeds');
    if (!given.length && proceeds !== 0) throw fail(400, 'With no cards given, the value of received cards must equal the net cash you paid');
    const values = given.map(copy => copy.value_cents == null ? null : copy.value_cents * copy.quantity);
    const weights = values.every(value => value != null) && values.some(value => value > 0) ? values : given.map(copy => copy.quantity);
    const allocation = given.length ? allocate(proceeds, weights) : [];
    return { date, given: given.map((copy, index) => ({ ...copy, proceeds_cents: allocation[index] })), received,
      other_received_cents: other, cash_in_cents: cashIn, cash_out_cents: cashOut, received_cents: receivedCents,
      remove_from_wishlist: body.remove_from_wishlist !== false, allow_unknown_basis: body.allow_unknown_basis === true };
  }

  // Given copies are sold at the fair value of everything received (cards + cash in - cash out);
  // received copies are acquired at the value entered for them. Everything commits or nothing does.
  async function complete(userId, requestId, body, { commit = true } = {}) {
    const { saleSteps } = require('./salesApplication');
    return transaction(async sql => {
      await saleSteps.prepare(sql);
      if (await sql.get('SELECT request_id FROM trade_execution WHERE request_id = ? AND user_id = ?', [id(requestId, 'trade request'), userId])) {
        throw fail(409, 'This trade is already completed');
      }
      const draft = await completionDraft(userId, requestId, sql), terms = completionTerms(draft, body);
      const sales = [], usd = valuationFor('USD');
      for (const copy of terms.given) {
        const sealed = copy.kind === 'sealed', currency = sealed ? copy.currency : 'USD';
        const nativeProceeds = currency === 'USD' ? copy.proceeds_cents
          : await valuationFor(currency).cents(copy.proceeds_cents, 'USD');
        const sale = saleSteps.input({ kind: sealed ? 'sealed' : 'card', id: sealed ? copy.lot_id : copy.entry_id,
          quantity: copy.quantity, proceedsCents: nativeProceeds, feesCents: 0, currency, soldOn: terms.date });
        const state = await saleSteps.state(sql, userId, sale), checked = saleSteps.review(userId, sale, state);
        const basis = checked.soldBasisCents == null ? null : currency === 'USD' ? checked.soldBasisCents
          : await usd.cents(checked.soldBasisCents, currency);
        sales.push({ copy, sale, state, checked, basis, gain: basis == null ? null : copy.proceeds_cents - basis });
      }
      const unknownBasis = sales.filter(item => item.basis == null).length;
      const gain = unknownBasis ? null : sales.reduce((sum, item) => sum + item.gain, 0);
      const summary = {
        id: draft.id, currency: 'USD', completed_on: terms.date,
        given: sales.map(({ copy, basis, gain: lineGain, sale }) => ({ entry_id: copy.entry_id, kind: copy.kind,
          quantity: copy.quantity, name: copy.printed_name || copy.name,
          set_name: copy.set_name, number: copy.number, condition: copy.condition, printing: copy.printing,
          value_cents: copy.value_cents, proceeds_cents: copy.proceeds_cents, basis_cents: basis,
          gain_cents: lineGain, sale_currency: sale.currency, sale_proceeds_cents: sale.proceedsCents })),
        received: terms.received.map(line => ({ index: line.index, kind: line.kind || 'card', card_id: line.card_id,
          product_id: line.product_id, name: line.printed_name || line.name,
          set_name: line.set_name, number: line.number, condition: line.condition, printing: line.printing,
          quantity: line.quantity, unit_cents: line.unit_cents })),
        other_received_cents: terms.other_received_cents, cash_in_cents: terms.cash_in_cents, cash_out_cents: terms.cash_out_cents,
        received_cents: terms.received_cents, proceeds_cents: terms.received_cents + terms.cash_in_cents - terms.cash_out_cents,
        given_cents: sales.some(item => item.copy.value_cents == null) ? null
          : sales.reduce((sum, item) => sum + item.copy.value_cents * item.copy.quantity, 0),
        unknown_basis: unknownBasis, realized_gain_cents: gain, remove_from_wishlist: terms.remove_from_wishlist,
      };
      if (!commit) return summary;
      if (unknownBasis && !terms.allow_unknown_basis) throw fail(400, 'Acknowledge that cards with unknown cost basis have no realized gain');
      for (const [index, { copy, sale, state, checked }] of sales.entries()) {
        const saved = await saleSteps.write(sql, userId, sale, state, checked, `trade-${draft.id}-${copy.entry_id}`,
          JSON.stringify({ ...sale, trade_request_id: draft.id }));
        summary.given[index].sale_id = saved.saleId;
      }
      for (const [index, line] of terms.received.entries()) {
        if (line.kind === 'sealed') {
          const product = await sql.get('SELECT id FROM sealed_product WHERE id = ? AND user_id = ? AND archived_at IS NULL',
            [line.product_id, userId]);
          if (!product) throw fail(409, 'A received sealed product is no longer available');
          const cost = line.unit_cents * line.quantity;
          const lot = await sql.run(`INSERT INTO sealed_lot (user_id, product_id, quantity, remaining_quantity,
            total_cost_cents, remaining_cost_cents, currency, purchased_at, notes)
            VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?)`,
          [userId, line.product_id, line.quantity, line.quantity, cost, cost, terms.date, `Trade #${draft.id}`]);
          summary.received[index].lot_id = lot.lastID;
          if (terms.remove_from_wishlist) {
            let left = line.quantity;
            for (const wishlistId of line.wishlist_ids) {
              const want = await sql.get("SELECT id, quantity FROM trade_sealed_listing WHERE 'sealed:' || id = ? AND user_id = ? AND list_type = 'wishlist'",
                [wishlistId, userId]);
              if (!want || !left) continue;
              const take = Math.min(left, want.quantity);
              left -= take;
              if (want.quantity > take) await sql.run('UPDATE trade_sealed_listing SET quantity = ? WHERE id = ? AND user_id = ?',
                [want.quantity - take, want.id, userId]);
              else await sealedTrades.unlist(sql, userId, [wishlistId]);
            }
          }
          continue;
        }
        const cache = await sql.get('SELECT game FROM card_cache WHERE id = ?', [line.card_id]);
        if (!cache) throw fail(409, 'A received card is missing from the card cache. Search for it once, then try again.');
        const entryIds = [];
        for (let copy = 0; copy < line.quantity; copy++) {
          const inserted = await sql.run(`INSERT INTO collection (user_id, card_id, quantity, condition, printing, language,
            grader, grade, purchase_price, list_type, is_trade, game) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'collection', 0, ?)`,
          [userId, line.card_id, line.condition, line.printing, line.language, line.grader || 'Raw', line.grade ?? null,
            line.unit_cents / 100, cache.game || line.game || 'pokemon']);
          entryIds.push(inserted.lastID);
        }
        summary.received[index].entry_ids = entryIds;
        if (terms.remove_from_wishlist) {
          let left = line.quantity;
          for (const wishlistId of line.wishlist_ids) {
            if (!left) break;
            const want = await sql.get("SELECT quantity FROM collection WHERE id = ? AND user_id = ? AND list_type = 'wishlist'", [wishlistId, userId]);
            if (!want) continue;
            const take = Math.min(left, want.quantity);
            left -= take;
            if (want.quantity - take > 0) await sql.run('UPDATE collection SET quantity = ? WHERE id = ? AND user_id = ?', [want.quantity - take, wishlistId, userId]);
            else {
              await sql.run("DELETE FROM collection WHERE id = ? AND user_id = ? AND list_type = 'wishlist'", [wishlistId, userId]);
              await sql.run('DELETE FROM trade_binder_item WHERE entry_id = ?', [wishlistId]);
            }
          }
        }
      }
      if (terms.given.length) {
        const removed = terms.given.filter(copy => copy.kind !== 'sealed' ||
          sales.find(item => item.copy.entry_id === copy.entry_id).checked.remainingQuantity === 0);
        if (removed.length) await sql.run(`DELETE FROM trade_binder_item WHERE entry_id IN (${removed.map(() => '?').join(',')})
          AND binder_id IN (SELECT id FROM trade_binder WHERE user_id = ?)`, [...removed.map(copy => copy.entry_id), userId]);
      }
      await sql.run(`INSERT INTO trade_execution (request_id, user_id, completed_on, currency, given_cents, received_cents,
        cash_in_cents, cash_out_cents, realized_gain_cents, result_json) VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?)`,
      [draft.id, userId, terms.date, summary.given_cents, terms.received_cents, terms.cash_in_cents, terms.cash_out_cents,
        gain, JSON.stringify(summary)]);
      await sql.run("UPDATE trade_request SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?", [draft.id, userId]);
      return summary;
    }, { rollback: !commit });
  }

  async function history(userId) {
    const rows = await db.all(`SELECT e.*, r.discord_contact, r.binder_name FROM trade_execution e
      JOIN trade_request r ON r.id = e.request_id WHERE e.user_id = ? ORDER BY e.completed_on DESC, e.request_id DESC LIMIT 200`, [userId]);
    const totals = { trades: rows.length, given_cents: 0, given_unknown: 0, received_cents: 0, cash_in_cents: 0,
      cash_out_cents: 0, realized_gain_cents: 0, gain_unknown: 0 };
    for (const row of rows) {
      if (row.given_cents == null) totals.given_unknown++; else totals.given_cents += row.given_cents;
      if (row.realized_gain_cents == null) totals.gain_unknown++; else totals.realized_gain_cents += row.realized_gain_cents;
      totals.received_cents += row.received_cents;
      totals.cash_in_cents += row.cash_in_cents;
      totals.cash_out_cents += row.cash_out_cents;
    }
    return { currency: 'USD', totals, trades: rows.map(({ result_json: resultJson, user_id: _user, ...row }) => ({ ...row, result: JSON.parse(resultJson) })) };
  }

  return {
    settings, update, listing, submit,
    quote: async (shareToken, body) => proposal(await owner(shareToken), body),
    rotate: async userId => {
      await settings(userId);
      await db.run('UPDATE trade_portal SET token = ? WHERE user_id = ?', [token(), userId]);
      return settings(userId);
    },
    inbox, counts, updateRequest, items, unlist, history,
    binders, createBinder, updateBinder, assign,
    rotateBinder: async (userId, binderId) => {
      const row = await binder(userId, binderId);
      await db.run('UPDATE trade_binder SET token = ? WHERE id = ? AND user_id = ?', [token(), row.id, userId]);
      return presentBinder(await binder(userId, row.id));
    },
    deleteBinder: async (userId, binderId) => {
      const row = await binder(userId, binderId);
      await db.run('DELETE FROM trade_binder_item WHERE binder_id = ?', [row.id]);
      await db.run('DELETE FROM trade_binder WHERE id = ? AND user_id = ?', [row.id, userId]);
    },
    completionDraft: (userId, requestId) => completionDraft(userId, requestId),
    previewCompletion: (userId, requestId, body) => complete(userId, requestId, body, { commit: false }),
    complete: (userId, requestId, body) => complete(userId, requestId, body),
    retry: deliver,
    remove: async (userId, requestId) => {
      const row = await tradeRequest(userId, requestId);
      if (row.status === 'completed') throw fail(409, 'Completed trades stay in history; archive is not needed');
      await db.run('DELETE FROM trade_request WHERE user_id = ? AND id = ?', [userId, row.id]);
    },
  };
}

module.exports = { schema, prepare, STATUSES, createTradePortal, webhookUrl, selections, summarize };
