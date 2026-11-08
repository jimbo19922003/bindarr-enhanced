import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraRequestWithDeadline } from './cameraWait.js';

test('camera requests start synchronously and successful streams stay open', async () => {
  let started = false, stopped = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }] };
  const request = cameraRequestWithDeadline(() => { started = true; return Promise.resolve(stream); });
  assert.equal(started, true);
  assert.equal(await request, stream);
  assert.equal(stopped, 0);
});
test('an unresolved camera request times out without claiming browser cancellation', async () => {
  const request = cameraRequestWithDeadline(() => new Promise(() => {}), { timeoutMs: 5 });
  await assert.rejects(request, error => error.name === 'CameraTimeoutError' && /may still be pending/.test(error.message));
});
test('a stream delivered after timeout is stopped instead of being adopted', async () => {
  let deliver, stopped = 0;
  const pending = new Promise(resolve => { deliver = resolve; });
  await assert.rejects(cameraRequestWithDeadline(() => pending, { timeoutMs: 5 }), { name: 'CameraTimeoutError' });
  deliver({ getTracks: () => [{ stop: () => { stopped++; } }] });
  await Promise.resolve();
  assert.equal(stopped, 1);
});
test('enumeration can time out independently of camera acquisition', async () => {
  await assert.rejects(cameraRequestWithDeadline(() => new Promise(() => {}), { timeoutMs: 5, stage: 'device enumeration' }), /device enumeration/);
});
test('browser rejections and synchronous failures retain their original identity', async () => {
  const error = Object.assign(new Error('Denied'), { name: 'NotAllowedError' });
  await assert.rejects(cameraRequestWithDeadline(() => Promise.reject(error)), actual => actual === error);
  await assert.rejects(cameraRequestWithDeadline(() => { throw error; }), actual => actual === error);
});
