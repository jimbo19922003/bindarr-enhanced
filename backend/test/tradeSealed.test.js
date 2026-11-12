'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openConnection } = require('../src/utils/salesRepository');
const { prepare, rows, setListing, unlist } = require('../src/utils/tradeSealed');

async function fixture(t) {
  const sql = await openConnection(':memory:');
  t.after(() => sql.close());
  await sql.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES (1),(2);
    CREATE TABLE sealed_product(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id),
      name TEXT, product_type TEXT, language TEXT, set_id TEXT, set_name TEXT, image_url TEXT,
      provider TEXT, provider_product_id TEXT, market_price_cents INTEGER, market_currency TEXT, archived_at TEXT);
    INSERT INTO sealed_product VALUES
      (1,1,'Box','booster_box','English','set1','Set One','','manual','',12000,'USD',NULL),
      (2,1,'Wanted Tin','tin','Japanese','','Set Two','','manual','',NULL,NULL,NULL),
      (3,2,'Private Box','booster_box','English','','Private','','manual','',999,'EUR',NULL);
    CREATE TABLE sealed_lot(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id),
      product_id INTEGER REFERENCES sealed_product(id), remaining_quantity INTEGER, currency TEXT, archived_at TEXT);
    INSERT INTO sealed_lot VALUES (10,1,1,4,'USD',NULL),(11,1,1,2,'EUR',NULL),(20,2,3,7,'EUR',NULL);
    CREATE TABLE trade_binder(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));
    INSERT INTO trade_binder VALUES (1,1),(2,2);
    CREATE TABLE trade_binder_item(binder_id INTEGER REFERENCES trade_binder(id), entry_id INTEGER,
      PRIMARY KEY(binder_id, entry_id));`);
  await prepare(sql);
  await prepare(sql);
  return sql;
}

test('owned sealed listings retain distinct lot sources and accept mixed entry id filters', async t => {
  const sql = await fixture(t);
  const first = await setListing(sql, 1, { product_id: 1, lot_id: 10 });
  const second = await setListing(sql, 1, { product_id: 1, lot_id: 11 });
  assert.equal(first.listed, true);
  assert.equal(first.listing.kind, 'sealed');
  assert.equal(first.listing.game, 'sealed');
  assert.equal(first.listing.market_price_cents, 12000);
  assert.equal(first.listing.set_id, 'set1');
  assert.equal(first.listing.currency, 'USD');
  assert.equal(second.listing.currency, 'EUR');
  assert.deepEqual((await rows(sql, 1)).map(row => row.quantity), [4, 2]);
  assert.deepEqual((await rows(sql, 1, { ids: [10, first.entry_id, 'sealed:999', '10'] }))
    .map(row => row.entry_id), [first.entry_id]);
  assert.deepEqual(await rows(sql, 1, { ids: [10, '10', 'sealed:01', null] }), []);
  assert.deepEqual(await rows(sql, 1, { ids: [] }), []);
  assert.equal((await setListing(sql, 1, { product_id: 1, lot_id: 10 })).entry_id, first.entry_id);
  await sql.run('INSERT INTO trade_binder_item VALUES (?,?)', [1, first.entry_id]);
  await sql.run('INSERT INTO trade_binder_item VALUES (?,?)', [2, second.entry_id]);
  assert.deepEqual((await rows(sql, 1, { binderId: 1 })).map(row => row.entry_id), [first.entry_id]);
  assert.deepEqual(await rows(sql, 1, { binderId: 2 }), [], 'foreign binder never exposes an owned listing');
});

test('wishlist quantities are configurable without stock and keep a stable listing id', async t => {
  const sql = await fixture(t);
  const wanted = await setListing(sql, 1, { product_id: 2, quantity: 3 });
  assert.equal(wanted.listing.list_type, 'wishlist');
  assert.equal(wanted.listing.lot_id, null);
  assert.equal(wanted.listing.quantity, 3);
  assert.equal(wanted.listing.market_price_cents, null);
  assert.equal(wanted.listing.currency, null);
  const updated = await setListing(sql, 1, { product_id: 2, quantity: 5 });
  assert.equal(updated.entry_id, wanted.entry_id);
  assert.equal(updated.listing.quantity, 5);
  assert.equal((await setListing(sql, 1, { product_id: 2 })).listing.quantity, 5);
  for (const quantity of [0, -1, 1.5, 'abc', null, true, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(setListing(sql, 1, { product_id: 2, quantity }), { status: 400 });
  }
  for (const listed of [1, 0, 'true', 'false', null]) {
    await assert.rejects(setListing(sql, 1, { product_id: 2, listed }), { status: 400 });
  }
  for (const product_id of [true, '', 0, '1 OR 1=1']) {
    await assert.rejects(setListing(sql, 1, { product_id }), { status: 400 });
  }
  assert.equal((await rows(sql, 1))[0].quantity, 5);
});

test('listing writes and joined rows strictly isolate owners and product lots', async t => {
  const sql = await fixture(t);
  const foreign = await setListing(sql, 2, { product_id: 3, lot_id: 20 });
  await assert.rejects(setListing(sql, 1, { product_id: 3, lot_id: 20 }), { status: 404 });
  await assert.rejects(setListing(sql, 1, { product_id: 1, lot_id: 20 }), { status: 404 });
  await assert.rejects(setListing(sql, 1, { product_id: 2, lot_id: 10 }), { status: 404 });
  await assert.rejects(setListing(sql, 1, { product_id: 3, listed: false }), { status: 404 });
  await sql.exec(`INSERT INTO sealed_lot VALUES (21,2,3,1,'EUR',NULL);
    INSERT INTO trade_sealed_listing(user_id, product_id, lot_id, list_type)
    VALUES (1,1,20,'collection'), (1,3,21,'collection'), (2,1,10,'collection');`);
  assert.deepEqual(await rows(sql, 1), []);
  assert.deepEqual((await rows(sql, 2)).map(row => row.entry_id), [foreign.entry_id]);
});

test('remaining quantities and archive visibility are dynamic without deleting partial listings', async t => {
  const sql = await fixture(t);
  const owned = await setListing(sql, 1, { product_id: 1, lot_id: 10 });
  const wanted = await setListing(sql, 1, { product_id: 2, quantity: 2 });
  await sql.run('UPDATE sealed_lot SET remaining_quantity = 2 WHERE id = 10');
  assert.equal((await rows(sql, 1, { ids: [owned.entry_id] }))[0].quantity, 2);
  await sql.run('UPDATE sealed_lot SET remaining_quantity = 0 WHERE id = 10');
  assert.deepEqual((await rows(sql, 1)).map(row => row.entry_id), [wanted.entry_id]);
  await assert.rejects(setListing(sql, 1, { product_id: 1, lot_id: 10 }), { status: 409 });
  await sql.run('UPDATE sealed_lot SET remaining_quantity = 4, archived_at = CURRENT_TIMESTAMP WHERE id = 10');
  assert.deepEqual(await rows(sql, 1, { ids: [owned.entry_id] }), []);
  await assert.rejects(setListing(sql, 1, { product_id: 1, lot_id: 10 }), { status: 409 });
  await sql.run('UPDATE sealed_lot SET archived_at = NULL WHERE id = 10');
  await sql.run('UPDATE sealed_product SET archived_at = CURRENT_TIMESTAMP');
  assert.deepEqual(await rows(sql, 1), []);
  await assert.rejects(setListing(sql, 1, { product_id: 2, quantity: 1 }), { status: 409 });
  const removed = await setListing(sql, 1, { product_id: 2, listed: false });
  assert.equal(removed.listed, false, 'archived listings may still be removed');
  assert.equal(await sql.get('SELECT id FROM trade_sealed_listing WHERE id = ?', [owned.listing.listing_id]) != null, true);
});

test('unlisting cleans only owner sealed memberships and never numeric card entries', async t => {
  const sql = await fixture(t);
  const owned = await setListing(sql, 1, { product_id: 1, lot_id: 10 });
  const wanted = await setListing(sql, 1, { product_id: 2, quantity: 2 });
  const foreign = await setListing(sql, 2, { product_id: 3, lot_id: 20 });
  for (const [binder, entry] of [[1, owned.entry_id], [1, wanted.entry_id], [1, 10], [2, foreign.entry_id], [2, owned.entry_id]]) {
    await sql.run('INSERT INTO trade_binder_item VALUES (?,?)', [binder, entry]);
  }
  assert.equal((await unlist(sql, 1, [10, String(owned.listing.listing_id), foreign.entry_id])).removed, 0);
  assert.equal((await unlist(sql, 1, [owned.entry_id, foreign.entry_id, owned.entry_id])).removed, 1);
  assert.equal((await sql.all('SELECT * FROM trade_binder_item WHERE binder_id = 1')).length, 2);
  assert.equal((await sql.all('SELECT * FROM trade_binder_item WHERE binder_id = 2')).length, 2);
  const result = await setListing(sql, 1, { product_id: 2, listed: false });
  assert.equal(result.entry_id, wanted.entry_id);
  assert.equal(result.listing, null);
  assert.deepEqual(await sql.all('SELECT entry_id FROM trade_binder_item WHERE binder_id = 1'), [{ entry_id: 10 }]);
  assert.deepEqual((await rows(sql, 2)).map(row => row.entry_id), [foreign.entry_id]);
  assert.equal((await setListing(sql, 1, { product_id: 2, listed: false })).entry_id, null);
});
