'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const sharp = require('sharp');

const dbPath = path.join(os.tmpdir(), `bindarr-binder-art-${process.pid}.db`);
const artDir = path.join(os.tmpdir(), `bindarr-binder-art-files-${process.pid}`);
process.env.DB_PATH = dbPath;
process.env.BINDER_ART_DIR = artDir;
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';

const db = require('../src/db');
const routes = require('../src/routes/binderArt');

function send(port, method, urlPath, userId, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : body;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers: { 'x-test-user': String(userId), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let parsed = buf;
        const type = String(res.headers['content-type'] || '');
        if (type.includes('json') || type.startsWith('text/')) {
          const text = buf.toString('utf8');
          try { parsed = JSON.parse(text); } catch { parsed = text; }
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  await db.initDb();
  const admin = await db.get(`SELECT id FROM users WHERE username = 'admin'`);
  const member = await db.run(
    `INSERT INTO users (username, password_hash, role, share_token, api_key) VALUES ('artist', 'x', 'member', 'artist-share', 'artist-key')`
  );
  const location = await db.run(`INSERT INTO locations (name, type, user_id) VALUES ('Art binder', 'Binder', ?)`, [admin.id]);
  const page = await db.run(`INSERT INTO compartments (location_id, idx, capacity) VALUES (?, 1, 9)`, [location.lastID]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: Number(req.headers['x-test-user']) };
    next();
  });
  app.use('/api', routes);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const png = await sharp({
    create: { width: 30, height: 40, channels: 3, background: { r: 12, g: 34, b: 56 } },
  }).png().toBuffer();
  const uploaded = await send(port, 'POST', '/api/binder-art', admin.id, png, { 'content-type': 'image/png' });
  assert.strictEqual(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.strictEqual(uploaded.body.artwork.width, 30);
  assert.strictEqual(uploaded.body.artwork.height, 40);
  const artworkId = uploaded.body.artwork.id;

  const junk = await send(port, 'POST', '/api/binder-art', admin.id, Buffer.from('not an image'), { 'content-type': 'image/png' });
  assert.strictEqual(junk.status, 400);

  const stolen = await send(port, 'GET', `/api/binder-art/${artworkId}/image`, member.lastID);
  assert.strictEqual(stolen.status, 404);
  const image = await send(port, 'GET', `/api/binder-art/${artworkId}/image`, admin.id);
  assert.strictEqual(image.status, 200);
  assert.strictEqual(image.headers['content-type'], 'image/png');
  assert.ok(Buffer.isBuffer(image.body));
  assert.strictEqual(image.body.length, png.length);

  const saved = await send(port, 'PUT', `/api/locations/${location.lastID}/compartments/${page.lastID}/binder-art`, admin.id, Buffer.from(JSON.stringify({
    artwork_id: artworkId,
    x_mm: 94.5,
    y_mm: 132,
    width_mm: 189,
    rotation_deg: 0,
    spread: false,
    mask: [
      { side: 'left', row: 0, col: 0 },
      { side: 'left', row: 1, col: 1 },
    ],
  })), { 'content-type': 'application/json' });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
  assert.strictEqual(saved.body.layer.mask.length, 2);
  assert.strictEqual(saved.body.layer.width, 30);

  const badMask = await send(port, 'PUT', `/api/locations/${location.lastID}/compartments/${page.lastID}/binder-art`, admin.id, Buffer.from(JSON.stringify({
    artwork_id: artworkId,
    x_mm: 1,
    y_mm: 1,
    width_mm: 63,
    rotation_deg: 0,
    mask: [{ side: 'left', row: -1, col: 0 }],
  })), { 'content-type': 'application/json' });
  assert.strictEqual(badMask.status, 400);

  const other = await send(port, 'GET', `/api/locations/${location.lastID}/binder-art`, member.lastID);
  assert.strictEqual(other.status, 404);
  const listed = await send(port, 'GET', `/api/locations/${location.lastID}/binder-art`, admin.id);
  assert.strictEqual(listed.body.layers.length, 1);

  const removed = await send(port, 'DELETE', `/api/binder-art/${artworkId}`, admin.id);
  assert.strictEqual(removed.status, 200);
  const gone = await send(port, 'GET', `/api/locations/${location.lastID}/binder-art`, admin.id);
  assert.strictEqual(gone.body.layers.length, 0);
  assert.strictEqual(fs.existsSync(path.join(artDir, String(admin.id), String(artworkId))), false);

  await new Promise(resolve => server.close(resolve));
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* already gone */ }
  }
  fs.rmSync(artDir, { recursive: true, force: true });
  console.log('binderArt.test.js: all assertions passed');
}

main().catch((err) => {
  console.error(err);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* already gone */ }
  }
  try { fs.rmSync(artDir, { recursive: true, force: true }); } catch { /* already gone */ }
  process.exit(1);
});
