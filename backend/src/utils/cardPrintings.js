'use strict';

const TYPES = ['Normal', 'Holofoil', 'Reverse Holofoil', '1st Edition', 'Promo'];
const fields = [['normal', 'Normal'], ['holo', 'Holofoil'], ['reverse', 'Reverse Holofoil'],
  ['firstEdition', '1st Edition'], ['wPromo', 'Promo']];

function tcgdexPrintings(variants) {
  if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return null;
  if (!fields.every(([key]) => typeof variants[key] === 'boolean')) return null;
  const result = fields.filter(([key]) => variants[key]).map(([, value]) => value);
  return result.length ? result : null;
}

function parsePrintings(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(value) || !value.length || value.some(item => !TYPES.includes(item))) return null;
  return [...new Set(value)];
}

function validatePrinting(card, printing) {
  if (!TYPES.includes(printing)) throw new TypeError('Invalid card printing');
  const allowed = parsePrintings(card?.available_printings);
  if (allowed && !allowed.includes(printing)) throw new TypeError('This printing is not available for the selected card');
}

module.exports = { tcgdexPrintings, parsePrintings, validatePrinting };
