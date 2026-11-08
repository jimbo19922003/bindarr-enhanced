import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assertCameraAllowed, cameraFailureMessage } from './cameraAccess.js';

const source = readFileSync(new URL('../components/CameraScanner.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  const startCamera =');
const end = source.indexOf('\n  // Lens picker / quick-switch.', start);
assert.ok(start >= 0 && end > start, 'locate the actual component activation handler');
const expression = source.slice(start, end).trim().replace(/^const startCamera\s*=\s*/, '').replace(/;$/, '');
function fixture({ audio = () => {}, open, doc = {} } = {}) {
  let requests = 0;
  const values = {}, saved = new Map();
  const stream = { getVideoTracks: () => [{ getSettings: () => ({}), label: 'Webcam' }] };
  const context = {
    assertCameraAllowed, cameraFailureMessage, document: doc,
    cameraStarting: { current: false },
    window: { isSecureContext: true, location: { origin: 'https://codespace.example', port: '' } },
    navigator: { mediaDevices: { getUserMedia() {} } },
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    CAMERA_KEY: 'scan_camera_id', beepCtx: audio, stopTracks: () => {},
    openCamera: async id => { requests++; return open ? open(id, stream) : stream; },
    listVideoInputs: async () => [], pickPreferredCamera: () => null,
    showToast: () => {}, t: key => key, console: { warn() {}, error() {} },
  };
  for (const name of ['lastAddedIdRef', 'resolvedDupIdRef', 'autoArmed', 'capturedQuad', 'streamRef']) context[name] = { current: null };
  context.unmounted = { current: false };
  for (const name of ['CameraOpening', 'CameraErrorKey', 'CameraErrorMessage', 'ScanMatches', 'ScanStatus', 'DebugHashImg', 'DebugCandidates', 'DebugScoped', 'VideoInputs', 'IsTorchOn', 'Stream', 'CameraActive']) context['set' + name] = value => { values[name] = value; };
  return { context, values, run: vm.runInNewContext('(' + expression + ')', context), requests: () => requests };
}
test('optional audio failure does not prevent camera activation', async () => {
  const f = fixture({ audio: () => { throw new Error('Audio unavailable'); } });
  await f.run();
  assert.equal(f.requests(), 1);
  assert.equal(f.values.CameraActive, true);
  assert.equal(f.values.CameraOpening, false);
  assert.equal(f.context.cameraStarting.current, false);
});
test('concurrent activation is single-flight and click bubbling is stopped', async () => {
  let release, stopped = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ open: async (_id, stream) => { await pending; return stream; } });
  const event = { stopPropagation: () => { stopped++; }, preventDefault() {} };
  const first = f.run(event);
  await f.run(event);
  assert.equal(f.requests(), 1);
  assert.equal(stopped, 2);
  assert.equal(f.values.CameraOpening, true);
  release();
  await first;
  assert.equal(f.values.CameraActive, true);
  assert.equal(f.context.cameraStarting.current, false);
});
test('policy blocks are reported before a camera request', async () => {
  const f = fixture({ doc: { permissionsPolicy: { allowsFeature: () => false } } });
  await f.run();
  assert.equal(f.requests(), 0);
  assert.match(f.values.CameraErrorMessage, /permissions policy/);
  assert.equal(f.values.CameraOpening, false);
});
test('permission denial releases the start lock and reports actionable feedback', async () => {
  let denied = true;
  const f = fixture({ open: async (_id, stream) => { if (denied) throw Object.assign(new Error('Denied'), { name: 'NotAllowedError' }); return stream; } });
  await f.run();
  assert.match(f.values.CameraErrorMessage, /denied/);
  assert.equal(f.context.cameraStarting.current, false);
  denied = false;
  await f.run();
  assert.equal(f.values.CameraActive, true);
  assert.equal(f.values.CameraErrorMessage, '');
});
test('camera feedback distinguishes missing hardware and unavailable devices', () => {
  assert.match(cameraFailureMessage({ name: 'NotFoundError' }), /No camera/);
  assert.match(cameraFailureMessage({ name: 'NotReadableError' }), /other apps/);
  assert.match(cameraFailureMessage({ name: 'OverconstrainedError' }), /settings/);
  assert.doesNotThrow(() => assertCameraAllowed({}));
});
