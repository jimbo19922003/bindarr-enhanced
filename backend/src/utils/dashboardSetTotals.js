'use strict';

function clean(value, field) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new TypeError(`Invalid ${field} in dashboard set totals`);
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function setKey(game, id, name) {
  const gameKey = clean(game, 'game').toLowerCase();
  const setName = clean(name, 'set name');
  const setId = clean(id, 'set id');
  return JSON.stringify([gameKey, setName ? 'name' : setId ? 'id' : 'unknown', (setName || setId).toLowerCase()]);
}

function preferName(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  const mixed = value => value !== value.toUpperCase();
  if (mixed(current) !== mixed(candidate)) return mixed(candidate) ? candidate : current;
  return candidate.localeCompare(current) < 0 ? candidate : current;
}

function createDashboardSetTotals({ onConflict = () => {} } = {}) {
  const buckets = new Map();
  const namesById = new Map();
  const reportedConflicts = new Set();
  function add({ game, id, name, count = 0, value }) {
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(value) || value < 0) {
      throw new TypeError('Invalid count or value in dashboard set totals');
    }
    const setName = clean(name, 'set name');
    const setId = clean(id, 'set id');
    const key = setKey(game, id, name);
    if (setId && setName) {
      const idKey = JSON.stringify([clean(game, 'game').toLowerCase(), setId.toLowerCase()]);
      const previous = namesById.get(idKey);
      if (previous && previous !== key && !reportedConflicts.has(idKey)) {
        onConflict({ game: clean(game, 'game'), id: setId });
        reportedConflicts.add(idKey);
      }
      if (!previous) namesById.set(idKey, key);
    }
    const bucket = buckets.get(key) || { id: setId, name: setName || (setId ? `Other (${setId})` : 'Other'), count: 0, value: 0 };
    if (setName) bucket.name = preferName(bucket.name, setName);
    if (setId && (!bucket.id || setId.localeCompare(bucket.id) < 0)) bucket.id = setId;
    bucket.count += count;
    bucket.value += value;
    if (!Number.isSafeInteger(bucket.count) || !Number.isFinite(bucket.value)) throw new RangeError('Dashboard set total is too large');
    buckets.set(key, bucket);
  }
  function list() {
    return [...buckets.values()].map(row => ({ ...row, value: Number(row.value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, 8);
  }
  return { add, list };
}

module.exports = { createDashboardSetTotals, setKey };
