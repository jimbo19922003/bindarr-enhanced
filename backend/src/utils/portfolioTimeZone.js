'use strict';

const DEFAULT_TIME_ZONE = 'America/Chicago';

function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value || value.length > 80 || value !== value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function effectiveTimeZone(stored, environment = process.env.PORTFOLIO_TIMEZONE) {
  const value = stored || environment || DEFAULT_TIME_ZONE;
  if (!isValidTimeZone(value)) throw new Error('Invalid portfolio timezone configuration');
  return value;
}

async function readTimeZone(db) {
  const row = await db.get('SELECT portfolio_time_zone FROM app_settings WHERE id = 1');
  return effectiveTimeZone(row?.portfolio_time_zone);
}

module.exports = { DEFAULT_TIME_ZONE, isValidTimeZone, effectiveTimeZone, readTimeZone };
