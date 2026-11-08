import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { cameraRequestWithDeadline } from './cameraWait.js';

const source = readFileSync(new URL('../components/CameraScanner.jsx', import.meta.url), 'utf8');
const start = source.indexOf('const openCamera =');
const end = source.indexOf('// Cameras for the lens picker.', start);
assert.ok(start >= 0 && end > start, 'locate actual camera constraints');
const expression = source.slice(start, end).trim().replace(/^const openCamera\s*=\s*/, '').replace(/;$/, '');
function fixture() {
  let constraints;
  const stream = {};
  const open = vm.runInNewContext('(' + expression + ')', { cameraRequestWithDeadline, navigator: { mediaDevices: { getUserMedia: options => { constraints = options; return Promise.resolve(stream); } } } });
  return { open, stream, constraints: () => constraints };
}
test('default camera startup requests video but not optional PTZ permission', async () => {
  const f = fixture();
  assert.equal(await f.open(null), f.stream);
  const constraints = f.constraints();
  assert.equal(constraints.audio, false);
  for (const feature of ['pan', 'tilt', 'zoom']) assert.equal(Object.hasOwn(constraints.video, feature), false);
  assert.equal(constraints.video.width.ideal, 1920);
  assert.equal(constraints.video.height.ideal, 1080);
  assert.equal(Object.hasOwn(constraints.video, 'deviceId'), false);
});
test('saved camera selection stays exact without requesting PTZ', async () => {
  const f = fixture();
  await f.open('saved-webcam');
  assert.equal(f.constraints().video.deviceId.exact, 'saved-webcam');
  assert.equal(Object.hasOwn(f.constraints().video, 'zoom'), false);
});
