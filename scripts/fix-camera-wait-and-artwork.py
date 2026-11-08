from pathlib import Path
import hashlib

def read_guarded(name, expected):
    original = Path(name).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(original)).encode() + b'\0' + original).hexdigest()
    if actual != expected:
        raise SystemExit(name + ': source changed; refusing to overwrite it')
    return original.decode('utf-8')
def replace_once(text, old, new):
    if text.count(old) != 1:
        raise SystemExit('Expected exactly one match: ' + old[:70])
    return text.replace(old, new, 1)

name = 'backend/src/utils/cardCache.js'
cache = read_guarded(name, '049c9bf6d4854d89eee3aec5e45342a2955463f3')
cache = replace_once(cache, '  .map(c => {\n    if (!PRESERVE_WHEN_POKEWALLET.has(c))', "  .map(c => {\n    if (c === 'image_url') return \"image_url = CASE WHEN NULLIF(TRIM(excluded.image_url), '') IS NULL THEN card_cache.image_url ELSE excluded.image_url END\";\n    if (!PRESERVE_WHEN_POKEWALLET.has(c))")
cam_name = 'frontend/src/components/CameraScanner.jsx'
cam = read_guarded(cam_name, '801d72e5bb05687b0dd1a5ac583000a84f9fa219')
cam = replace_once(cam, "import { assertCameraAllowed, cameraFailureMessage } from '../utils/cameraAccess';", "import { assertCameraAllowed, cameraFailureMessage } from '../utils/cameraAccess';\nimport { cameraRequestWithDeadline } from '../utils/cameraWait';")
start = cam.index('const openCamera = (deviceId) => navigator.mediaDevices.getUserMedia({')
end = cam.index('// Cameras for the lens picker.', start)
block = cam[start:end]
block = replace_once(block, 'const openCamera = (deviceId) => navigator.mediaDevices.getUserMedia({', 'const openCamera = (deviceId) => cameraRequestWithDeadline(() => navigator.mediaDevices.getUserMedia({')
block = replace_once(block, '  audio: false\n});', '  audio: false\n}));')
cam = cam[:start] + block + cam[end:]
cam = replace_once(cam, '    const devices = await navigator.mediaDevices.enumerateDevices?.();', "    const devices = await cameraRequestWithDeadline(() => navigator.mediaDevices.enumerateDevices?.(), { timeoutMs: 2000, stage: 'device enumeration' });")
access_name = 'frontend/src/utils/cameraAccess.js'
access = Path(access_name).read_text()
access = replace_once(access, "    case 'NotAllowedError':", "    case 'CameraTimeoutError':\n      return error.message || 'The browser camera request timed out. Check site and operating-system camera permissions.';\n    case 'NotAllowedError':")
for name, text in [(name,cache),(cam_name,cam),(access_name,access)]:
    Path(name).write_bytes(text.encode('utf-8'))
