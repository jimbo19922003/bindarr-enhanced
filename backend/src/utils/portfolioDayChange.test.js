'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { portfolioDayChange } = require('./portfolioDayChange');
const { openConnection } = require('./salesRepository');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

test('day change uses the latest earlier snapshot in the selected scope and timezone', async () => {
  const queries = [];
  const db = { get: async (sql, params) => {
    queries.push({sql, params});
    if (sql.includes('app_settings')) return {portfolio_time_zone:'America/Chicago'};
    if (sql.includes('sqlite_master')) return {name:'portfolio_daily_performance'};
    return {day:'2026-11-06',value_cents:10000,stale_rates:0,unpriced_cards:1,unpriced_sealed:0};
  } };
  const valuation = {cents:async (amount, currency) => {assert.equal(currency,'USD'); return amount * 2;}};
  const result = await portfolioDayChange(db, 42, 'pokemon', valuation, 190, Date.parse('2026-11-08T03:00:00Z'));
  assert.deepEqual(result, {amount:-10,since:'2026-11-06',timeZone:'America/Chicago',incomplete:true});
  assert.deepEqual(queries[2].params, [42,'pokemon','America/Chicago','2026-11-07']);
  assert.match(queries[2].sql, /day < \? ORDER BY day DESC LIMIT 1/);
});

test('day change is unavailable without an earlier snapshot', async () => {
  const db = {get:async sql => sql.includes('app_settings') ? {portfolio_time_zone:'UTC'} : sql.includes('sqlite_master') ? {name:'portfolio_daily_performance'} : undefined};
  assert.equal(await portfolioDayChange(db,1,'',{},100,Date.parse('2026-11-08T12:00:00Z')),null);
});

test('snapshot selection excludes other users, games, timezones and today', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'portfolio-day-change-'));
  const file = join(dir, 'test.db');
  await writeFile(file, '');
  const db = await openConnection(file);
  t.after(async () => { await db.close(); await rm(dir, {recursive:true,force:true}); });
  await db.exec(`CREATE TABLE app_settings(id INTEGER,portfolio_time_zone TEXT);
    INSERT INTO app_settings VALUES(1,'America/Chicago');
    CREATE TABLE portfolio_daily_performance(user_id INTEGER,game TEXT,currency TEXT,time_zone TEXT,day TEXT,value_cents INTEGER,stale_rates INTEGER,unpriced_cards INTEGER,unpriced_sealed INTEGER);
    INSERT INTO portfolio_daily_performance VALUES
    (1,'pokemon','USD','America/Chicago','2026-11-05',10000,0,0,0),
    (1,'pokemon','USD','America/Chicago','2026-11-06',15000,0,0,0),
    (1,'pokemon','USD','America/Chicago','2026-11-07',99900,0,0,0),
    (2,'pokemon','USD','America/Chicago','2026-11-06',88800,0,0,0),
    (1,'mtg','USD','America/Chicago','2026-11-06',77700,0,0,0),
    (1,'pokemon','USD','UTC','2026-11-06',66600,0,0,0);`);
  const change = await portfolioDayChange(db, 1, 'pokemon', {cents:async amount => amount}, 200, Date.parse('2026-11-07T18:00:00Z'));
  assert.deepEqual(change,{amount:50,since:'2026-11-06',timeZone:'America/Chicago',incomplete:false});
});
