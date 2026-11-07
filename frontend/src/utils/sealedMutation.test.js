import test from 'node:test';
import assert from 'node:assert/strict';
import { isSealedMutation } from './sealedMutation.js';

const origin = 'https://bindarr.example';
test('sealed purchase, rip and zero-dollar pull updates invalidate valuation', () => {
  const writes = [
    ['/api/sealed/products/batch', 'POST', { items: [{ total_cost: '49.99' }] }],
    ['/api/sealed/lots/1/openings', 'POST', { pulls: [] }],
    ['/api/sealed/openings/1/pulls', 'POST', { current_value: '0.00' }],
    ['/api/sealed/openings/1/pulls/1', 'PUT', { current_value: '0.00' }],
    ['/api/sealed/openings/1/pulls/1', 'DELETE', {}],
    ['/api/sealed/openings/1', 'DELETE', {}],
    ['/api/sealed/products/1/quote', 'POST', {}],
    ['/api/sealed/lots/1/archive', 'POST', {}],
    ['/api/sealed/import', 'POST', {}],
  ];
  for (const [url, method, body] of writes) {
    assert.equal(isSealedMutation(url, { method, body: JSON.stringify(body) }, origin), true, url);
  }
});
test('reads, unrelated endpoints and foreign origins do not invalidate', () => {
  assert.equal(isSealedMutation('/api/sealed/products', {}, origin), false);
  assert.equal(isSealedMutation('/api/sealed/export', { method: 'GET' }, origin), false);
  assert.equal(isSealedMutation('/api/auth/login', { method: 'POST' }, origin), false);
  assert.equal(isSealedMutation('https://other.example/api/sealed/import', { method: 'POST' }, origin), false);
});
test('Request and URL inputs and method overrides are supported', () => {
  const request = new Request(`${origin}/api/sealed/import`, { method: 'POST' });
  assert.equal(isSealedMutation(request, {}, origin), true);
  assert.equal(isSealedMutation(request, { method: 'GET' }, origin), false);
  assert.equal(isSealedMutation(new URL(`${origin}/api/sealed/import`), { method: 'post' }, origin), true);
});
