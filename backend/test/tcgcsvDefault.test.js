'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const env = { ...process.env, DB_PATH: ':memory:' };
delete env.TCGCSV_BASE_URL;
const script = "console.log('BASE=' + require('./src/tcgcsvApi').client.defaults.baseURL); process.exit(0);";
const result = spawnSync(process.execPath, ['-e', script], { cwd: require('node:path').join(__dirname, '..'), env, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /BASE=https:\/\/raw\.githubusercontent\.com\/thenotoriousJeremy\/bindarr\/tcgcsv-mirror/);
