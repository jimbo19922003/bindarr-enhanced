from pathlib import Path
import hashlib

p = Path('frontend/src/components/CameraScanner.jsx')
original = p.read_bytes()
actual = hashlib.sha1(b'blob ' + str(len(original)).encode() + b'\0' + original).hexdigest()
if actual != '74a5a482f4fc300a204d082c4c00384e23b96a0a':
    raise SystemExit('CameraScanner.jsx changed; refusing to overwrite it')
text = original.decode('utf-8')
old = "    // Chrome only reports caps.zoom (and honours zoom constraints) when the\n    // stream was requested with it. Browsers that don't know it ignore it.\n    zoom: true\n"
if text.count(old) != 1:
    raise SystemExit('Expected exactly one implicit zoom permission request')
text = text.replace(old, '    // Basic startup does not request optional pan/tilt/zoom permission.\n', 1)
text = text.replace('// resolution and zoom request as the default one.', '// resolution preference as the default one; optional PTZ is not requested.')
p.write_bytes(text.encode('utf-8'))
