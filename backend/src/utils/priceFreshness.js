'use strict';

const MAX_QUOTE_AGE_MS = 48 * 60 * 60 * 1000;

function quoteTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const time = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(text) ? text : text.replace(' ', 'T') + 'Z');
  return Number.isFinite(time) ? time : null;
}

function isFreshQuote(value, now = Date.now()) {
  const time = quoteTime(value);
  return time != null && time <= now + 300000 && now - time <= MAX_QUOTE_AGE_MS;
}

module.exports = { MAX_QUOTE_AGE_MS, quoteTime, isFreshQuote };
