'use strict';

const { randomBytes, createHash } = require('node:crypto');
const axios = require('axios');
const { resolveCardPrice, FINISH_COLUMNS } = require('./priceHelpers');
const { createReportingValuation } = require('./reportingValuation');

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
];

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

function selections(value) {
  if (!Array.isArray(value) || !value.length || value.length > 50) throw fail(400, 'Select between 1 and 50 cards on each side');
  const seen = new Set();
  return value.map(item => {
    if (!item || !Number.isSafeInteger(item.entry_id) || item.entry_id < 1 || seen.has(item.entry_id)
      || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) {
      throw fail(400, 'Card selections need unique IDs and positive whole quantities');
    }
    seen.add(item.entry_id);
    return { entry_id: item.entry_id, quantity: item.quantity };
  }).sort((a, b) => a.entry_id - b.entry_id);
}

function summarize(requested, offered, currency) {
  const total = lines => {
    let known = 0, unknown = 0;
    for (const line of lines) {
      if (line.unit_cents == null) unknown += line.quantity;
      else {
        known += line.unit_cents * line.quantity;
        if (!Number.isSafeInteger(known)) throw fail(400, 'Trade value is too large');
      }
    }
    return { known_cents: known, unknown_quantity: unknown };
  };
  const receive = total(requested), give = total(offered);
  const complete = receive.unknown_quantity === 0 && give.unknown_quantity === 0;
  const difference = complete ? give.known_cents - receive.known_cents : null;
  return {
    currency, requested: receive, offered: give,
    difference_cents: difference,
    difference_percent: complete && receive.known_cents > 0
      ? Math.round(difference / receive.known_cents * 1000) / 10 : null,
  };
}

async function postDiscord(url, contact, proposal, id) {
  const lines = items => items.map(card =>
    `${card.quantity}x ${card.name} (${card.set_name} #${card.number}; ${card.printing}; ${card.language}; ${card.condition})`
  ).join('\n').slice(0, 1000);
  await axios.post(url, {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `Bindarr trade request #${id}`,
      description: `Discord contact: ${contact}`,
      fields: [
        { name: 'Cards requested from you', value: lines(proposal.requested) },
        { name: 'Cards offered to you', value: lines(proposal.offered) },
        { name: 'Estimated balance (offered minus requested)', value: proposal.summary.difference_percent == null
          ? 'Unknown: missing prices or no comparison value'
          : `${proposal.summary.difference_percent > 0 ? '+' : ''}${proposal.summary.difference_percent}% (${proposal.summary.currency})` },
      ],
      footer: { text: 'Open Settings > Trade-only sharing in Bindarr for the full proposal and message. Inventory is unchanged.' },
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
    const row = await sql.get(`SELECT p.*, u.username FROM trade_portal p JOIN users u ON u.id = p.user_id
      WHERE p.token = ? AND p.enabled = 1`, [shareToken]);
    if (!row) throw fail(404, 'Trade page not found');
    return row;
  }

  async function cards(userId, ids, sql = db) {
    if (ids && !ids.length) return [];
    return sql.all(`SELECT c.id AS entry_id, c.card_id, c.quantity, c.condition, c.printing, c.language,
      c.grader, c.grade, c.market_value, c.list_type, c.is_trade,
      cc.name, cc.printed_name, cc.set_name, cc.number, cc.image_url, cc.game,
      cc.price_trend, cc.price_normal, cc.price_holofoil, cc.price_reverse_holofoil, cc.price_1st_edition,
      cc.price_currency, cc.price_source
      FROM collection c JOIN card_cache cc ON cc.id = c.card_id
      WHERE c.user_id = ? AND c.quantity > 0
      AND (c.list_type = 'wishlist' OR (c.list_type = 'collection' AND c.is_trade = 1))
      ${ids ? `AND c.id IN (${ids.map(() => '?').join(',')})` : ''}
      ORDER BY cc.name, c.id`, [userId, ...(ids || [])]);
  }

  async function present(row, valuation) {
    const price = Number(resolveCardPrice(row));
    let unitCents = null, priceState = 'unknown';
    const exact = row.market_value > 0 || (FINISH_COLUMNS[row.printing] && row[FINISH_COLUMNS[row.printing]] > 0);
    if (Number.isFinite(price) && price > 0) {
      try {
        unitCents = await valuation.cents(Math.round(price * 100), row.price_currency || 'USD');
        priceState = exact ? 'priced' : 'estimate';
      } catch (error) {
        if (error.code !== 'VALUATION_FX_UNAVAILABLE') throw error;
        priceState = 'fx_unavailable';
      }
    }
    return {
      entry_id: row.entry_id, card_id: row.card_id, name: row.name, printed_name: row.printed_name,
      set_name: row.set_name, number: row.number, image_url: row.image_url, game: row.game,
      quantity: row.quantity, condition: row.condition, printing: row.printing, language: row.language,
      grader: row.grader, grade: row.grade, unit_cents: unitCents, price_state: priceState,
    };
  }

  async function listing(shareToken) {
    const user = await owner(shareToken), valuation = valuationFor(user.currency);
    const available = [], wanted = [];
    for (const row of await cards(user.user_id)) {
      (row.list_type === 'wishlist' ? wanted : available).push(await present(row, valuation));
    }
    return { owner: user.username, currency: user.currency, available, wanted, ...valuation.metadata() };
  }

  async function proposal(user, body, sql = db) {
    const requested = selections(body.requested), offered = selections(body.offered);
    const rows = new Map((await cards(user.user_id, [...requested, ...offered].map(row => row.entry_id), sql))
      .map(row => [row.entry_id, row]));
    const valuation = valuationFor(user.currency);
    const side = async (items, listType) => {
      const result = [];
      for (const item of items) {
        const row = rows.get(item.entry_id);
        if (!row || row.list_type !== listType || item.quantity > row.quantity) {
          throw fail(409, 'A selected card is no longer available in that quantity. Refresh the trade page.');
        }
        result.push({ ...await present(row, valuation), quantity: item.quantity });
      }
      return result;
    };
    const receive = await side(requested, 'collection'), give = await side(offered, 'wishlist');
    return { requested: receive, offered: give, summary: summarize(receive, give, user.currency), ...valuation.metadata() };
  }

  async function deliver(userId, id) {
    const user = await db.get('SELECT discord_webhook FROM trade_portal WHERE user_id = ?', [userId]);
    const row = await db.get('SELECT * FROM trade_request WHERE user_id = ? AND id = ?', [userId, id]);
    if (!row) throw fail(404, 'Trade request not found');
    let state = 'not_configured';
    if (user?.discord_webhook) {
      try {
        await notify(webhookUrl(user.discord_webhook), row.discord_contact, JSON.parse(row.proposal_json), row.id);
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
    const clean = { requested: selections(body.requested), offered: selections(body.offered), discord_contact: contact, message };
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
          (user_id, request_key, payload_hash, discord_contact, message, proposal_json) VALUES (?, ?, ?, ?, ?, ?)`,
        [user.user_id, body.request_key, hash, contact, message, JSON.stringify(quote)]);
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

  return {
    settings, update, listing, submit,
    quote: async (shareToken, body) => proposal(await owner(shareToken), body),
    rotate: async userId => {
      await settings(userId);
      await db.run('UPDATE trade_portal SET token = ? WHERE user_id = ?', [token(), userId]);
      return settings(userId);
    },
    inbox: async (userId, before) => {
      if (before != null && (!Number.isSafeInteger(before) || before < 1)) throw fail(400, 'Invalid inbox cursor');
      const rows = await db.all(`SELECT id, discord_contact, message, proposal_json, notification, created_at
        FROM trade_request WHERE user_id = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT 20`,
      [userId, ...(before ? [before] : [])]);
      return { requests: rows.map(({proposal_json, ...row}) => ({...row, proposal: JSON.parse(proposal_json)})),
        next_before: rows.length === 20 ? rows[rows.length - 1].id : null };
    },
    retry: deliver,
    remove: async (userId, id) => {
      const result = await db.run('DELETE FROM trade_request WHERE user_id = ? AND id = ?', [userId, id]);
      if (!result.changes) throw fail(404, 'Trade request not found');
    },
  };
}

module.exports = { schema, createTradePortal, webhookUrl, selections, summarize };
