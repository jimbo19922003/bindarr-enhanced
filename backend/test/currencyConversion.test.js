'use strict';

const assert = require('assert');
const { createCurrencyService } = require('../src/utils/currencyConversion');

async function main() {
  let timestamp = Date.parse('2026-11-06T12:00:00Z');
  let stored;
  let requests = 0;
  let offline = false;
  const db = {
    async run(sql, params) {
      if (sql.startsWith('INSERT')) stored = { fetched_at: params[0], payload: params[1] };
    },
    async get() { return stored; },
  };
  const get = async () => {
    requests++;
    if (offline) throw new Error('offline');
    return { data: [
      { base: 'USD', quote: 'EUR', rate: 0.8, date: '2026-11-06' },
      { base: 'USD', quote: 'GBP', rate: 0.5, date: '2026-11-06' },
    ] };
  };
  const make = () => createCurrencyService({ db, get, now: () => timestamp });
  const fx = make();
  assert.strictEqual((await fx.convertCents(1000, 'USD')).convertedCents, 1000);
  assert.strictEqual(requests, 0);
  const batch = await Promise.all(Array.from({ length: 10 }, () => fx.convertCents(1000, 'EUR')));
  assert.ok(batch.every(row => row.convertedCents === 1250));
  assert.strictEqual(requests, 1);
  assert.strictEqual((await fx.convertCents(1000, 'EUR', 'GBP')).convertedCents, 625);
  assert.strictEqual((await fx.convertCents(1, 'EUR')).convertedCents, 1);
  assert.strictEqual((await make().convertCents(1000, 'EUR')).convertedCents, 1250);
  assert.strictEqual(requests, 1);
  offline = true;
  timestamp += 86400001;
  const fallback = await fx.convertCents(1000, 'EUR');
  assert.strictEqual(fallback.convertedCents, 1250);
  assert.strictEqual(fallback.stale, true);
  assert.deepStrictEqual(fallback.rateDates, ['2026-11-06']);
  const afterFailure = requests;
  await fx.convertCents(1000, 'EUR');
  assert.strictEqual(requests, afterFailure);
  assert.strictEqual((await fx.convertCents(1000, 'XYZ')).convertedCents, null);
  timestamp += 8 * 86400000;
  assert.strictEqual((await fx.convertCents(1000, 'EUR')).convertedCents, null);
  await assert.rejects(() => fx.convertCents(-1, 'USD'), TypeError);
  await assert.rejects(() => fx.convertCents(1.5, 'EUR'), TypeError);
  await assert.rejects(() => fx.convertCents(1000, 'EUR/USD'), TypeError);
  const empty = createCurrencyService({
    db: { async run() {}, async get() {} },
    get: async () => ({ data: [{ base: 'USD', quote: 'EUR', rate: -1, date: '2026-11-06' }] }),
    now: () => Date.parse('2026-11-06T12:00:00Z'),
  });
  assert.strictEqual((await empty.convertCents(1000, 'EUR')).convertedCents, null);
  console.log('currencyConversion.test.js: all assertions passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
