'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/formatPrice.js'), 'utf8');
  const format = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const quotes = { USD: { rate: 1 }, EUR: { rate: 0.8 }, GBP: { rate: 0.5 } };
  assert.strictEqual(format.convertDisplayAmount(54.85, 'EUR', 'USD', quotes).toFixed(2), '68.56');
  assert.strictEqual(format.convertDisplayAmount(10, 'USD', 'EUR', quotes), 8);
  assert.strictEqual(format.convertDisplayAmount(10, 'EUR', 'GBP', quotes), 6.25);
  assert.strictEqual(format.convertDisplayAmount(10, 'USD', 'USD', null), 10);
  assert.strictEqual(format.convertDisplayAmount(0, 'EUR', 'USD', quotes), 0);
  assert.strictEqual(format.convertDisplayAmount(54.85, 'EUR', 'USD', null), null);
  assert.strictEqual(format.convertDisplayAmount(Infinity, 'USD', 'USD', quotes), null);
  assert.strictEqual(format.priceText(10, 'USD'), '$10.00');
  assert.strictEqual(format.priceText(null, 'USD'), '—');
  assert.strictEqual(format.priceText(54.85, 'EUR'), '— (FX unavailable)');
  console.log('displayCurrency.test.js: all assertions passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
