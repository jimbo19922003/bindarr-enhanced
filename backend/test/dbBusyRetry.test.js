'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const tmpDb = path.join(os.tmpdir(), `bindarr-busy-retry-${process.pid}.db`);
process.env.DB_PATH = tmpDb;
const db = require('../src/db');
const busy = () => Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' });
const delays = [1, 1, 1];

test.after(async () => {
  await new Promise(resolve => db.dbConnection.close(() => resolve()));
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(tmpDb + suffix, { force: true });
});

test('an immediate SQLITE_BUSY snapshot conflict is retried until the statement succeeds', async () => {
  let calls = 0;
  const result = await db.retryBusy(async () => { if (++calls < 3) throw busy(); return 'ok'; }, delays);
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('other errors and persistent busy failures are not swallowed', async () => {
  let calls = 0;
  await assert.rejects(db.retryBusy(async () => { calls++; throw Object.assign(new Error('nope'), { code: 'SQLITE_CONSTRAINT' }); }, delays), { code: 'SQLITE_CONSTRAINT' });
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(db.retryBusy(async () => { calls++; throw busy(); }, delays), { code: 'SQLITE_BUSY' });
  assert.equal(calls, delays.length + 1);
});

test('a busy error after busy_timeout already waited is not retried again', async (t) => {
  let now = 0, calls = 0;
  t.mock.method(Date, 'now', () => now);
  await assert.rejects(db.retryBusy(async () => { calls++; now += 5000; throw busy(); }, delays), { code: 'SQLITE_BUSY' });
  assert.equal(calls, 1);
});
