'use strict';

const sealed = require('./sealedInventory');
const accounting = require('./openingAccounting');
const { matcher, normName } = require('./setCatalogueMatch');

function bound(value, name, max, required) {
  const text = String(value == null ? '' : value).trim();
  if (required && !text) throw new TypeError(`${name} is required`);
  if (text.length > max) throw new TypeError(`${name} is too long`);
  return text;
}

function blank(value) {
  return value == null || String(value).trim() === '';
}

function optionalMoney(value, name) {
  if (blank(value)) return null;
  return sealed.moneyToCents(value, name);
}

function imageUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length > 500) throw new TypeError('Image URL is too long');
  let url;
  try { url = new URL(text); } catch { throw new TypeError('Image URL must be an http(s) address'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('Image URL must be an http(s) address');
  if (url.username || url.password) throw new TypeError('Image URL must not include credentials');
  return url.toString();
}

// Amounts are in the opening's currency. A different code is rejected rather
// than converted. A blank amount is unpriced, which is not the same as zero.
function normalizePull(body, currency) {
  const input = body || {};
  if (!blank(input.currency) && String(input.currency).trim().toUpperCase() !== currency) {
    throw new RangeError('Pull currency differs from the opening currency');
  }
  const currentUnit = optionalMoney(input.current_value, 'Current value');
  const currentLine = optionalMoney(input.line_value, 'Line value');
  const openedUnit = optionalMoney(input.value_at_opening, 'Value at opening');
  const openedLine = optionalMoney(input.opened_line_value, 'Opened line value');
  if (currentUnit != null && currentLine != null) throw new TypeError('Enter a unit value or a line total, not both');
  if (openedUnit != null && openedLine != null) throw new TypeError('Enter one value-at-opening snapshot');
  const quantity = Number(input.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 5000) {
    throw new TypeError('Pull quantity must be a whole number from 1 to 5000');
  }
  let collectionId = null;
  if (!blank(input.collection_id)) {
    collectionId = Number(input.collection_id);
    if (!Number.isSafeInteger(collectionId) || collectionId < 1) throw new TypeError('Collection card not found');
  }
  return {
    name: bound(input.name, 'Pull name', 200, false),
    cardId: bound(input.card_id, 'Card', 80, false),
    collectionId,
    printing: blank(input.printing) ? 'Normal' : bound(input.printing, 'Printing', 40, true),
    setName: bound(input.set_name, 'Set', 120, false),
    number: bound(input.number, 'Number', 20, false),
    imageUrl: imageUrl(input.image_url),
    quantity,
    currentUnit,
    currentLine,
    openedUnit,
    openedLine,
    currentBlank: currentUnit == null && currentLine == null,
  };
}

// A catalog price fills a blank current value only when it is already in the
// opening currency. A different currency is left unpriced.
function applyCatalogPrice(pull, card, currency) {
  if (!pull.currentBlank || !card || card.price_trend == null || card.price_trend === '') return;
  const priceCurrency = String(card.price_currency || 'USD').toUpperCase();
  if (priceCurrency !== currency) return;
  const amount = Number(card.price_trend);
  if (!Number.isFinite(amount) || amount <= 0) return;
  pull.currentUnit = sealed.moneyToCents(amount, 'Current value');
  pull.currentBlank = false;
}

// The price known when the pull is first recorded is the value at opening.
// A later edit of the current price does not rewrite it, and a blank stays blank.
function snapshotOpeningValue(pull) {
  if (pull.openedUnit != null || pull.openedLine != null) return;
  if (pull.currentUnit != null) pull.openedUnit = pull.currentUnit;
  else if (pull.currentLine != null) pull.openedLine = pull.currentLine;
}

function fillFromCard(pull, card) {
  if (!card) return;
  if (!pull.name) pull.name = card.name || '';
  if (!pull.setName) pull.setName = card.set_name || '';
  if (!pull.number) pull.number = card.number || '';
  if (!pull.imageUrl && card.image_url) pull.imageUrl = String(card.image_url);
  if (!pull.cardId) pull.cardId = card.card_id || card.id || '';
}

function signedMoney(cents) {
  const negative = cents < 0;
  return `${negative ? '-' : ''}${sealed.centsToMoney(Math.abs(cents))}`;
}

function moneyOrNull(cents) {
  return cents == null ? null : sealed.centsToMoney(cents);
}

function presentOpening(row, pulls) {
  const report = accounting.openingReport({
    costCents: row.cost_cents,
    currency: row.currency,
    entryComplete: row.entry_complete === 1 || row.entry_complete === true,
    pulls: pulls.map(pull => ({
      quantity: pull.quantity,
      unitValueCents: pull.current_unit_cents,
      lineValueCents: pull.current_line_cents,
      currency: row.currency,
      openedUnitValueCents: pull.opened_unit_cents,
      openedLineValueCents: pull.opened_line_cents,
    })),
  });
  return {
    id: row.id,
    product_id: row.product_id,
    lot_id: row.lot_id,
    quantity: row.quantity,
    cost_cents: row.cost_cents,
    cost: sealed.centsToMoney(row.cost_cents),
    currency: row.currency,
    opened_at: row.opened_at,
    notes: row.notes || '',
    entry_complete: row.entry_complete === 1,
    pulls: pulls.map(pull => ({
      id: pull.id,
      opening_id: pull.opening_id,
      card_id: pull.card_id || '',
      collection_id: pull.collection_id || null,
      name: pull.name,
      set_name: pull.set_name || '',
      number: pull.number || '',
      image_url: pull.image_url || '',
      quantity: pull.quantity,
      current_value: moneyOrNull(pull.current_unit_cents),
      line_value: moneyOrNull(pull.current_line_cents),
      value_at_opening: moneyOrNull(pull.opened_unit_cents),
      opened_line_value: moneyOrNull(pull.opened_line_cents),
    })),
    analytics: {
      currency: report.currency,
      cost_cents: report.costCents,
      cost: sealed.centsToMoney(report.costCents),
      recorded_quantity: report.recordedQuantity,
      unpriced_quantity: report.unpricedQuantity,
      known_value_cents: report.knownValueCents,
      known_value: sealed.centsToMoney(report.knownValueCents),
      valuation_complete: report.valuationComplete,
      entry_complete: report.entryComplete,
      value_difference_cents: report.valueDifferenceCents,
      value_difference: signedMoney(report.valueDifferenceCents),
      value_difference_kind: report.valueDifferenceKind,
      cost_recovery_percent: report.costRecoveryPercent,
      opened_value_cents: report.openedValueCents,
      opened_value: moneyOrNull(report.openedValueCents),
      snapshotted_quantity: report.snapshottedQuantity,
      missing_snapshot_quantity: report.missingSnapshotQuantity,
    },
  };
}

// A sealed product's set code is the seller catalog's code (PokéWallet "30C").
// Card search uses the card catalog's id ("30th"). Prefer a card-catalog row
// whose name is the sealed set's name, then one saved card set with that name.
// Two different saved set ids for the same name are not guessed between.
function pickCatalogSet({ code, name, cached, sets }) {
  const list = Array.isArray(sets) ? sets : [];
  const found = matcher(list)(code || '', name || '');
  if (found && found.id) return { set_id: String(found.id), set_name: found.name || name || '' };
  const wanted = normName(name);
  const hits = [];
  const seen = new Set();
  if (wanted) {
    for (const row of cached || []) {
      if (normName(row.set_name) !== wanted) continue;
      const id = String(row.set_id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      hits.push({ set_id: id, set_name: row.set_name || name || '' });
    }
  }
  if (hits.length === 1) return hits[0];
  return { set_id: '', set_name: name || '' };
}

function openedOn(value, currency) {
  return sealed.normalizeLot({
    quantity: 1,
    total_cost: '0',
    currency,
    purchased_at: value,
  }).purchased_at;
}

function notesOf(value) {
  return sealed.normalizeLot({
    quantity: 1,
    total_cost: '0',
    currency: 'USD',
    notes: value,
  }).notes;
}

module.exports = {
  applyCatalogPrice,
  fillFromCard,
  normalizePull,
  notesOf,
  openedOn,
  pickCatalogSet,
  presentOpening,
  snapshotOpeningValue,
};
