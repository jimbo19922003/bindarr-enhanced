from pathlib import Path
import hashlib

p = Path('frontend/src/components/CameraScanner.jsx')
original = p.read_bytes()
digest = hashlib.sha1(b'blob ' + str(len(original)).encode() + b'\0' + original).hexdigest()
if digest != 'd1376cb7e9de0c75befe6530f4e6be4111d07e61':
    raise SystemExit('CameraScanner.jsx changed; refusing to overwrite it')
text = original.decode('utf-8')
def replace_once(value, old, new):
    if value.count(old) != 1:
        raise SystemExit('Expected exactly one camera edit: ' + old[:70])
    return value.replace(old, new, 1)
text = replace_once(text, "import { pickPreferredCamera, nextCamera } from '../utils/cameraPick';", "import { pickPreferredCamera, nextCamera } from '../utils/cameraPick';\nimport { assertCameraAllowed, cameraFailureMessage } from '../utils/cameraAccess';")
text = replace_once(text, "  const [cameraErrorKey, setCameraErrorKey] = useState('');", "  const [cameraErrorKey, setCameraErrorKey] = useState('');\n  const [cameraErrorMessage, setCameraErrorMessage] = useState('');\n  const [cameraOpening, setCameraOpening] = useState(false);\n  const cameraStarting = useRef(false);")
start = text.index('  const startCamera = async () => {')
end = text.index('\n  // Lens picker / quick-switch.', start)
block = text[start:end]
block = replace_once(block, '  const startCamera = async () => {', "  const startCamera = async (event) => {\n    event?.stopPropagation();\n    event?.preventDefault();\n    if (cameraStarting.current) return;\n    cameraStarting.current = true;\n    setCameraOpening(true);\n    try {")
block = replace_once(block, '    beepCtx();', "    try { beepCtx(); } catch (error) { console.warn('Camera audio cue unavailable:', error); }")
block = replace_once(block, "    setCameraErrorKey('');", "    setCameraErrorKey('');\n    setCameraErrorMessage('');")
block = replace_once(block, "      setCameraErrorKey('scan.errCameraInsecure');", "      setCameraErrorMessage(cameraFailureMessage({ name: window.isSecureContext ? 'UnsupportedCameraError' : 'InsecureContextError' }));")
block = replace_once(block, "      const saved = localStorage.getItem(CAMERA_KEY);", "      assertCameraAllowed(document);\n      const saved = localStorage.getItem(CAMERA_KEY);")
block = replace_once(block, "      setCameraErrorKey('scan.errCameraPermissions');", "      setCameraErrorKey('scan.errCameraPermissions');\n      setCameraErrorMessage(cameraFailureMessage(err));")
ending = '  };'
trimmed = block.rstrip()
if not trimmed.endswith(ending):
    raise SystemExit('Unexpected camera handler boundary')
block = trimmed[:-len(ending)] + "    } catch (error) {\n      console.error('Camera activation failed:', error);\n      setCameraErrorMessage(cameraFailureMessage(error));\n    } finally {\n      cameraStarting.current = false;\n      setCameraOpening(false);\n    }\n  };\n"
text = text[:start] + block + text[end:]
text = replace_once(text, '{cameraErrorKey ? (', '{(cameraErrorKey || cameraErrorMessage) ? (')
text = replace_once(text, "{t(cameraErrorKey, { origin: window.location.origin, port: window.location.port || '80' })}", "{cameraErrorMessage || t(cameraErrorKey, { origin: window.location.origin, port: window.location.port || '80' })}")
text = replace_once(text, '<button className="btn btn-primary" onClick={startCamera}>\n                <RefreshCw size={14} /> Retry Camera', '<button type="button" className="btn btn-primary" onClick={startCamera} disabled={cameraOpening}>\n                <RefreshCw size={14} /> {cameraOpening ? \'Requesting camera…\' : \'Retry Camera\'}')
text = replace_once(text, '<button className="btn btn-primary">\n                {t(\'scan.activateCamera\')}', '<button type="button" className="btn btn-primary" onClick={startCamera} disabled={cameraOpening}>\n                {cameraOpening ? \'Requesting camera…\' : t(\'scan.activateCamera\')}')
p.write_bytes(text.encode('utf-8'))
