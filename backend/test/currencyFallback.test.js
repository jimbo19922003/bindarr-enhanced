'use strict';
const assert = require('assert');
const { createCurrencyService, parseEcb } = require('../src/utils/currencyConversion');

async function main() {
  const timestamp = Date.parse('2026-11-06T12:00:00Z');
  const xml = `<gesmes:Envelope><Cube><Cube time='2026-11-06'>
    <Cube currency='USD' rate='1.25'/>
    <Cube currency='GBP' rate='0.625'/>
    <Cube currency='CAD' rate='1.75'/>
    <Cube currency='AUD' rate='2'/>
    <Cube currency='JPY' rate='200'/>
    </Cube></Cube></gesmes:Envelope>`;
  const rows = parseEcb(xml);
  assert.strictEqual(rows.find(row => row.quote === 'EUR').rate, 0.8);
  assert.strictEqual(rows.find(row => row.quote === 'GBP').rate, 0.5);
  assert.throws(() => parseEcb('<html>error</html>'));
  assert.throws(() => parseEcb({}));
  let stored;
  const calls = [];
  const db = {
    async get() { return stored; },
    async run(sql, params) { if (sql.startsWith('INSERT')) stored = { fetched_at: params[0], payload: params[1] }; },
  };
  const get = async url => {
    calls.push(url);
    if (url.includes('frankfurter')) return { data: [{ base: 'USD', quote: 'EUR', rate: 0.9, date: '2026-10-25' }] };
    return { data: xml };
  };
  const service = createCurrencyService({ db, get, now: () => timestamp });
  const result = await service.convertCents(5485, 'EUR');
  assert.strictEqual(result.convertedCents, 6856);
  assert.strictEqual(result.source, 'ecb');
  assert.strictEqual(result.stale, false);
  assert.deepStrictEqual(result.rateDates, ['2026-11-06']);
  assert.strictEqual(calls.length, 2);
  await service.convertCents(1000, 'GBP');
  assert.strictEqual(calls.length, 2);
  const reloaded = createCurrencyService({ db, get: async () => { throw new Error('Must use persisted cache'); }, now: () => timestamp });
  assert.strictEqual((await reloaded.convertCents(1000, 'EUR')).convertedCents, 1250);
  console.log('currencyFallback.test.js: all assertions passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
