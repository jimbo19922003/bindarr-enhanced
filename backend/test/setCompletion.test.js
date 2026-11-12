'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { openConnection } = require('../src/utils/salesRepository');
const { completionCounts, readSetCompletion } = require('../src/utils/setCompletion');

test('Pitch Black secrets cannot substitute for missing cards in the 84-card base set', () => {
  const numbers = [
    ...Array.from({ length: 70 }, (_, index) => String(index + 1)),
    ...Array.from({ length: 35 }, (_, index) => String(index + 85)),
  ];
  assert.deepEqual(completionCounts(numbers, { printed_total: 84, total: 120 }, 'pokemon'), {
    base: { ownedUnique: 70, totalCards: 84, percent: 83 },
    full: { ownedUnique: 105, totalCards: 120, percent: 88 },
  });
  assert.deepEqual(completionCounts([...numbers, ...Array.from({ length: 14 }, (_, index) => String(index + 71))], { printed_total: 84, total: 120 }, 'pokemon').base,
    { ownedUnique: 84, totalCards: 84, percent: 100 });
});

test('number normalization deduplicates copies and finishes; base range rejects zero, prefixes and suffixes', () => {
  const counts = completionCounts(['001', '1', ' 01 ', '084', '85', '0', 'TG01', '1a', '', ' ', null], { printed_total: 84, total: 120 }, 'pokemon');
  assert.equal(counts.base.ownedUnique, 2);
  assert.equal(counts.full.ownedUnique, 6);
});

test('unknown totals are explicit and Magic retains non-contiguous collector-number completion', () => {
  assert.deepEqual(completionCounts(['1', '85'], { printed_total: 84 }, 'pokemon'), {
    base: { ownedUnique: 1, totalCards: 84, percent: 1 }, full: null,
  });
  // Promo sets (MEP) have no printed total; their full total is the base total.
  assert.deepEqual(completionCounts(['001', '113'], { printed_total: 0, total: 112 }, 'pokemon').base, { ownedUnique: 1, totalCards: 112, percent: 1 });
  assert.deepEqual(completionCounts(['1', '500', '123a'], { printed_total: 3, total: 3 }, 'mtg').base, {
    ownedUnique: 3, totalCards: 3, percent: 100,
  });
});

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'set-completion-'));
  const path = join(root, 'test.db');
  await fs.writeFile(path, '');
  const db = await openConnection(path);
  t.after(async () => { await db.close(); await fs.rm(root, { recursive: true, force: true }); });
  await db.exec(`CREATE TABLE sets (id TEXT PRIMARY KEY, game TEXT, printed_total INTEGER, total INTEGER);
    CREATE TABLE card_cache (id TEXT PRIMARY KEY, game TEXT, set_id TEXT, set_name TEXT, number TEXT);
    CREATE TABLE collection (id INTEGER PRIMARY KEY, user_id INTEGER, card_id TEXT, list_type TEXT);
    INSERT INTO sets VALUES ('me05', 'pokemon', 84, 120), ('magic', 'mtg', 2, 2);
    INSERT INTO card_cache VALUES ('base', 'pokemon', 'me05', 'Pitch Black', '001'),
      ('base-other-language', 'pokemon', 'me05', 'Pitch Black', '1'),
      ('secret', 'pokemon', 'me05', 'Pitch Black', '085'),
      ('wish', 'pokemon', 'me05', 'Pitch Black', '002'),
      ('sold', 'pokemon', 'me05', 'Pitch Black', '003'),
      ('other', 'pokemon', 'me05', 'Pitch Black', '004'),
      ('magic-card', 'mtg', 'magic', 'Magic set', '500');
    INSERT INTO collection VALUES (1, 1, 'base', 'collection'), (2, 1, 'base', 'collection'),
      (3, 1, 'base-other-language', 'collection'), (4, 1, 'secret', 'collection'),
      (5, 1, 'wish', 'wishlist'), (6, 1, 'sold', 'sold'), (7, 2, 'other', 'collection'),
      (8, 1, 'magic-card', 'collection');`);
  return db;
}

test('stored progress scopes ownership and game, deduplicating languages and excluding wishlist/sold cards', async t => {
  const db = await fixture(t);
  const rows = await readSetCompletion(db, 1, 'pokemon');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].setId, 'me05');
  assert.deepEqual(rows[0].base, { ownedUnique: 1, totalCards: 84, percent: 1 });
  assert.deepEqual(rows[0].full, { ownedUnique: 2, totalCards: 120, percent: 2 });
  assert.equal(rows[0].ownedUnique, rows[0].base.ownedUnique, 'Default API fields use corrected base completion');
  assert.equal((await readSetCompletion(db, 2, 'pokemon'))[0].base.ownedUnique, 1);
  assert.equal((await readSetCompletion(db, 1, '')).length, 2);
  await db.run("UPDATE sets SET printed_total = NULL, total = NULL WHERE id = 'me05'");
  const unknown = (await readSetCompletion(db, 1, 'pokemon'))[0];
  assert.equal(unknown.base, null);
  assert.equal(unknown.full, null);
  assert.equal(unknown.totalCards, null, 'Unknown catalogue totals stay visible without inventing a denominator');
});

test('active local catalogue supplies base metadata and the full checklist without counting duplicate catalogue numbers', async t => {
  const db = await fixture(t);
  await db.exec(`CREATE TABLE pokemon_catalog_active (language TEXT, snapshot_id INTEGER);
    CREATE TABLE pokemon_catalog_set (snapshot_id INTEGER, id TEXT, payload_json TEXT);
    CREATE TABLE pokemon_catalog_card (snapshot_id INTEGER, id TEXT, set_id TEXT, number_key TEXT);
    INSERT INTO pokemon_catalog_active VALUES ('en', 1), ('ja', 2);
    INSERT INTO pokemon_catalog_set VALUES (1, 'me05', '{"printed_total":84}'), (2, 'me05', '{"printed_total":80}');
    UPDATE sets SET printed_total = 1, total = 2 WHERE id = 'me05';`);
  for (let index = 1; index <= 120; index++) {
    await db.run("INSERT INTO pokemon_catalog_card VALUES (1, ?, 'me05', ?)", [`catalog-${index}`, String(index)]);
  }
  await db.run("INSERT INTO pokemon_catalog_card VALUES (1, 'alternate-1', 'me05', '1')");
  let rows = await readSetCompletion(db, 1, 'pokemon');
  assert.equal(rows[0].base.totalCards, 84);
  assert.equal(rows[0].full.totalCards, 120);
  await db.run("DELETE FROM sets WHERE id = 'me05'");
  rows = await readSetCompletion(db, 1, 'pokemon');
  assert.equal(rows[0].full.totalCards, 120, 'Locally synced sets work without legacy set rows');
  assert.equal(rows[0].base.ownedUnique, 1);
  await db.run("DELETE FROM pokemon_catalog_card WHERE number_key != '1'");
  rows = await readSetCompletion(db, 1, 'pokemon');
  assert.equal(rows[0].full, null, 'A partial legacy snapshot cannot invent a full-set total');
  await db.run(`UPDATE pokemon_catalog_set SET payload_json = '{"printed_total":84,"total":120}' WHERE snapshot_id = 1`);
  rows = await readSetCompletion(db, 1, 'pokemon');
  assert.equal(rows[0].full.totalCards, 120, 'Explicit provider totals work even with a partial checklist');
});
