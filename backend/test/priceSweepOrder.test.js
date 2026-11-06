'use strict';
const assert = require('assert');
const { PRICE_SWEEP_ORDER, runSequential, safeErrorMessage } = require('../src/utils/priceSweep');

async function main() {
  assert.strictEqual(PRICE_SWEEP_ORDER[PRICE_SWEEP_ORDER.length - 1], 'pokewallet');
  assert.ok(PRICE_SWEEP_ORDER.indexOf('tcgcsv') < PRICE_SWEEP_ORDER.indexOf('pokewallet'),
    'TCGCSV writes before PokéWallet so a quote it stored is not raced');

  const order = [];
  const result = await runSequential([
    { name: 'first', run: async () => { order.push('first'); } },
    { name: 'boom', run: async () => { order.push('boom'); throw new Error('nope'); } },
    { name: 'last', run: async () => { order.push('last'); } },
  ]);
  assert.deepStrictEqual(order, ['first', 'boom', 'last']);
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(result.errors[0].name, 'boom');

  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let started;
  const gate = new Promise(resolve => { started = resolve; });
  const first = runSequential([{ name: 'busy', run: async () => { started(); await hold; } }]);
  await gate;
  const second = await runSequential([{ name: 'other', run: async () => { throw new Error('should not run'); } }]);
  assert.strictEqual(second.skipped, true);
  release();
  const finished = await first;
  assert.strictEqual(finished.skipped, false);

  process.env.POKEWALLET_API_KEY = 'pk_test_SHOULD_NOT_LEAK_9f3a';
  const hidden = safeErrorMessage(new Error('failed for pk_test_SHOULD_NOT_LEAK_9f3a'));
  assert.ok(!hidden.includes('SHOULD_NOT_LEAK'));
  assert.ok(hidden.includes('[redacted]'));
  delete process.env.POKEWALLET_API_KEY;

  console.log('priceSweepOrder.test.js: all assertions passed');
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
