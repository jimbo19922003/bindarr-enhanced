'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const dbPath = path.join(os.tmpdir(), `bindarr-art-index-${process.pid}.db`);
process.env.DB_PATH = dbPath;
const db = require('../src/db');
const art = require('../src/cardArt');
const router = require('../src/routes/cardArt');

async function main() {
  const app = express();
  app.use('/api/card-art', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const original = fs.readdirSync;
  try {
    fs.readdirSync = dir => {
      if (dir === art.USER_DIR) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return original(dir);
    };
    art.invalidate();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/card-art/index`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Could not list card artwork' });
  } finally {
    fs.readdirSync = original;
    art.invalidate();
    await new Promise(resolve => server.close(resolve));
    await new Promise((resolve, reject) => db.dbConnection.close(error => error ? reject(error) : resolve()));
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
