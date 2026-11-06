'use strict';

// Pure matching and quote parsing for PokéWallet responses.
//
// Nothing here talks to the network or the database. A match is accepted only
// when the collector number, the card name, and the set all agree, and the
// product is a single. Anything else stays a candidate for a person to confirm.

const TCGPLAYER_HOSTS = new Set(['tcgplayer.com', 'www.tcgplayer.com']);
const CARDMARKET_HOSTS = new Set(['cardmarket.com', 'www.cardmarket.com']);

function foldName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// "003", "3/102" and "3" are the same collector number. "TG01" is not "TG1".
function collectorNumber(value) {
  const head = String(value || '').trim().toLowerCase().split('/')[0].trim();
  if (!head) return '';
  if (/^\d+$/.test(head)) return String(Number(head));
  return head;
}

function isProviderCardId(value) {
  return /^(pk_[a-f0-9]{16,128}|[a-f0-9]{32,128})$/i.test(String(value || ''));
}

function safeProductUrl(value, hosts) {
  if (typeof value !== 'string' || value.length > 500) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname.toLowerCase())) return null;
  return url;
}

function productIdFromUrl(value) {
  const url = safeProductUrl(value, TCGPLAYER_HOSTS);
  if (!url) return null;
  const match = url.pathname.match(/\/product\/(\d+)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function quoteTime(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}T/.test(text) && text.length <= 40 ? text : null;
}

function infoOf(result) {
  return (result && result.card_info) || {};
}

// One currency for every printing column. TCGplayer USD wins when it has a
// market price; Cardmarket EUR is used only when TCGplayer has none. Low and
// mid prices are not treated as the market quote.
function extractQuote(result) {
  const info = infoOf(result);
  if (info.product_type !== 'card') return { ok: false, reason: 'not_a_card' };
  const tcg = result && result.tcgplayer;
  const rows = tcg && Array.isArray(tcg.prices) ? tcg.prices : [];
  const bySubtype = {};
  let updated = null;
  for (const row of rows) {
    const amount = positive(row && row.market_price);
    const subtype = row && row.sub_type_name;
    if (!amount || !subtype || bySubtype[subtype]) continue;
    bySubtype[subtype] = amount;
    updated = quoteTime(row.updated_at) || updated;
  }
  const normal = bySubtype.Normal ?? bySubtype.Unlimited ?? null;
  const holofoil = bySubtype.Holofoil ?? null;
  const reverse = bySubtype['Reverse Holofoil'] ?? null;
  const firstEdition = bySubtype['1st Edition'] ?? null;
  const trend = holofoil ?? normal ?? reverse ?? firstEdition ?? null;
  if (trend) {
    const url = safeProductUrl(tcg.url, TCGPLAYER_HOSTS);
    return {
      ok: true,
      currency: 'USD',
      source: 'pokewallet-tcgplayer',
      price_trend: trend,
      price_normal: normal,
      price_holofoil: holofoil,
      price_reverse_holofoil: reverse,
      price_1st_edition: firstEdition,
      price_avg1: null,
      price_avg7: null,
      price_avg30: null,
      updated_at: updated,
      tcgplayer_url: url ? url.toString() : null,
      cardmarket_url: null,
      tcgplayer_product_id: productIdFromUrl(tcg.url),
      product_type: 'card',
    };
  }
  if (bySubtype.Shadowless && !trend) return { ok: false, reason: 'variant_unconfirmed' };

  const market = result && result.cardmarket;
  const cmRows = market && Array.isArray(market.prices) ? market.prices : [];
  const cm = {};
  for (const row of cmRows) {
    const variant = row && row.variant_type;
    if (variant !== 'normal' && variant !== 'holo') continue;
    const amount = positive(row.trend) ?? positive(row.avg);
    if (!amount || cm[variant]) continue;
    cm[variant] = row;
    updated = quoteTime(row.updated_at) || updated;
  }
  const cmNormal = cm.normal ? (positive(cm.normal.trend) ?? positive(cm.normal.avg)) : null;
  const cmHolo = cm.holo ? (positive(cm.holo.trend) ?? positive(cm.holo.avg)) : null;
  const cmTrend = cmHolo ?? cmNormal ?? null;
  if (!cmTrend) return { ok: false, reason: rows.length || cmRows.length ? 'unpriced' : 'unpriced' };
  const representative = cmHolo ? cm.holo : cm.normal;
  const url = safeProductUrl(market.product_url, CARDMARKET_HOSTS);
  return {
    ok: true,
    currency: 'EUR',
    source: 'pokewallet-cardmarket',
    price_trend: cmTrend,
    price_normal: cmNormal,
    price_holofoil: cmHolo,
    price_reverse_holofoil: null,
    price_1st_edition: null,
    price_avg1: positive(representative.avg1),
    price_avg7: positive(representative.avg7),
    price_avg30: positive(representative.avg30),
    updated_at: updated,
    tcgplayer_url: null,
    cardmarket_url: url ? url.toString() : null,
    tcgplayer_product_id: null,
    product_type: 'card',
  };
}

// PokéWallet often appends the collector number, and sometimes a set code,
// after the printed name: "Mewtwo ex - 151/158", "Pikachu - 025/165".
// Parenthetical suffixes are already removed by foldName. A trailing word
// such as "ex" is a different card and does not match.
function nameMatches(card, info) {
  const want = foldName(card && card.name);
  if (!want) return false;
  return [info.name, info.clean_name].some(name => foldedNameAgrees(want, foldName(name)));
}

function foldedNameAgrees(want, got) {
  if (!want || !got) return false;
  if (got === want) return true;
  if (!got.startsWith(want + ' ')) return false;
  const rest = got.slice(want.length + 1);
  return rest.split(' ').every(token => /^\d+$/.test(token) || /^[a-z]*\d+[a-z0-9]*$/.test(token));
}

function setAgrees(card, info) {
  const code = String(card && card.set_id || '').trim().toLowerCase();
  const theirs = String(info.set_code || '').trim().toLowerCase();
  if (code && theirs && code === theirs) return true;
  const ours = foldName(card && card.set_name);
  const setName = foldName(info.set_name);
  return !!ours && ours === setName;
}

function summarizeCandidate(result) {
  const info = infoOf(result);
  const quote = extractQuote(result);
  return {
    id: String(result && result.id || ''),
    name: String(info.name || ''),
    set_code: String(info.set_code || ''),
    set_name: String(info.set_name || ''),
    card_number: String(info.card_number || ''),
    product_type: String(info.product_type || ''),
    currency: quote.ok ? quote.currency : null,
    amount: quote.ok ? quote.price_trend : null,
  };
}

// results is the PokéWallet `results` array (or a one-element list for a direct card).
// `total` is the reported hit count. A unique name+number that does not agree on
// the set is returned as one candidate and is not applied.
function matchSearchResults(card, results, total) {
  const list = Array.isArray(results) ? results : [];
  const sameCard = list.filter(result => {
    const info = infoOf(result);
    return info.product_type === 'card'
      && collectorNumber(info.card_number) === collectorNumber(card && card.number)
      && collectorNumber(card && card.number) !== ''
      && nameMatches(card, info);
  });
  if (sameCard.length > 1) {
    return { status: 'ambiguous', reason: 'several_printings', matches: [], candidates: sameCard.slice(0, 5).map(summarizeCandidate) };
  }
  if (sameCard.length === 1) {
    const one = sameCard[0];
    if (setAgrees(card, infoOf(one))) {
      return { status: 'matched', reason: null, matches: [one], candidates: [summarizeCandidate(one)] };
    }
    return { status: 'ambiguous', reason: 'set_unconfirmed', matches: [], candidates: [summarizeCandidate(one)] };
  }
  const reported = Number(total);
  if (Number.isFinite(reported) && reported > list.length) {
    return { status: 'unmatched', reason: 'search_truncated', matches: [], candidates: [] };
  }
  return { status: 'unmatched', reason: 'no_safe_match', matches: [], candidates: [] };
}

function printedNumber(value) {
  const head = String(value || '').trim().split('/')[0].trim();
  if (!head) return '';
  if (/^\d+$/.test(head)) return String(Number(head));
  return head;
}

// A short set id we can hand to PokéWallet. Long labels are not set codes.
function setCodeToken(setId) {
  const raw = String(setId || '').trim();
  if (!raw || /\s/.test(raw) || raw.length > 16) return '';
  return raw;
}

// The card name on its own. Used when a set-qualified search comes back empty,
// and as the name half of the set-qualified query.
function nameQuery(card) {
  const name = String(card && card.name || '').trim().replace(/\s+/g, ' ');
  if (name.length > 100) return name.slice(0, 100).trim();
  return name;
}

// PokéWallet's documented search shapes are a card name, a set code, a
// collector number on its own, a numeric set id plus a number ("24541 148"),
// or a name plus a set code ("cubone cbb3c"). A name plus a collector number
// ("Mewtwo ex 151") is not one of those shapes and comes back empty. The
// collector number is applied to the results instead.
function searchQuery(card) {
  const name = nameQuery(card);
  const number = printedNumber(card && card.number);
  const setCode = setCodeToken(card && card.set_id);
  let query = '';
  if (setCode && /^\d+$/.test(setCode) && number) query = `${setCode} ${number}`;
  else if (name && setCode) query = `${name} ${setCode}`;
  else if (name) query = name;
  else query = [setCode, number].filter(Boolean).join(' ');
  query = query.replace(/\s+/g, ' ').trim();
  if (query.length > 100) query = query.slice(0, 100).trim();
  return query;
}

module.exports = {
  foldName,
  collectorNumber,
  isProviderCardId,
  extractQuote,
  matchSearchResults,
  nameQuery,
  searchQuery,
  summarizeCandidate,
  productIdFromUrl,
};
