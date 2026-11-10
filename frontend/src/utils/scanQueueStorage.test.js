import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptCaptures, changeCapture, enqueueCapture, listCaptures, saveCapture } from './scanQueue.js';

// Minimal IndexedDB test double: requests finish asynchronously and committed
// records survive reopening the database.
function fakeIndexedDB() {
  const rows = new Map();
  let created = false;
  let failWrites = false;
  const db = {
    createObjectStore() { return { createIndex() {} }; },
    close() {},
    transaction() {
      let pending = 0;
      let stopped = false;
      const tx = {
        error: null,
        abort() { stopped = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore() {
          const request = (work, writing = false) => {
            const result = {};
            pending++;
            queueMicrotask(() => {
              if (stopped) return;
              if (writing && failWrites) {
                tx.error = new Error('Quota exceeded');
                stopped = true;
                tx.onabort?.();
                return;
              }
              result.result = work();
              result.onsuccess?.();
              pending--;
              if (!pending) setTimeout(() => { if (!stopped && !pending) tx.oncomplete?.(); }, 0);
            });

            return result;
          };
          return {
            put: item => request(() => rows.set(item.id, structuredClone(item)), true),
            get: id => request(() => structuredClone(rows.get(id))),
            delete: id => request(() => rows.delete(id), true),
            index: () => ({ getAll: scope => request(() => [...rows.values()].filter(item => item.scope === scope).map(item => structuredClone(item))) }),
          };
        },
      };
      return tx;
    },
  };
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = db;
        if (!created) { created = true; request.onupgradeneeded?.(); }
        request.onsuccess?.();
      });
      return request;
    },
    failWrites(value) { failWrites = value; },
  };
}

test('captures survive database reopen, stay scoped, and reject stale edits and quota failures', async () => {
  const fake = fakeIndexedDB();
  globalThis.indexedDB = fake;
  try {
    const first = { id: 'one', scope: 'server-a-user-1', status: 'pending', image: 'image-data' };
    const other = { id: 'two', scope: 'server-a-user-2', status: 'pending', image: 'other-image' };
    await saveCapture(first);
    await saveCapture(other);
    assert.deepEqual(await listCaptures(first.scope), [first]);
    assert.deepEqual(await listCaptures(other.scope), [other]);
    await changeCapture(first, { status: 'review', cards: [{ id: 'card' }] });
    await assert.rejects(changeCapture(first, { status: 'saving' }), /changed in another tab/);
    const [review] = await listCaptures(first.scope);
    assert.equal(review.status, 'review');
    assert.equal(review.image, 'image-data');
    await changeCapture(review, { status: 'saving', body: { card_id: 'card' } });
    const [saving] = await listCaptures(first.scope);
    assert.equal(saving.body.card_id, 'card');
    fake.failWrites(true);
    await assert.rejects(saveCapture({ id: 'three', scope: first.scope, status: 'pending' }), /Quota exceeded/);
    fake.failWrites(false);
    assert.deepEqual(await listCaptures(first.scope), [saving]);
    await changeCapture(saving, null);
    assert.deepEqual(await listCaptures(first.scope), []);
    assert.deepEqual(await listCaptures(other.scope), [other]);
  } finally {
    delete globalThis.indexedDB;
  }
});

test('accepting reviewed scans is atomic, scoped, and never accepts pending or unselected scans', async () => {
  const fake = fakeIndexedDB();
  globalThis.indexedDB = fake;
  try {
    const scope = 'server-a-user-1';
    const a = { id: 'a', scope, status: 'review', cardId: 'card-a', cards: [{ id: 'card-a' }] };
    const b = { id: 'b', scope, status: 'review', cardId: 'card-b', cards: [{ id: 'card-b' }] };
    const unresolved = { id: 'c', scope, status: 'review', cardId: null, cards: [] };
    const other = { ...a, id: 'other', scope: 'server-b-user-1' };
    for (const item of [a, b, unresolved, other]) await saveCapture(item);
    const selections = [
      { id: 'a', cardId: 'card-a', body: { card_id: 'card-a' } },
      { id: 'b', cardId: 'card-b', body: { card_id: 'card-b' } },
    ];
    await assert.rejects(acceptCaptures(scope, [selections[0], { ...selections[1], cardId: 'wrong' }]), /changed/);
    assert.equal((await listCaptures(scope)).find(item => item.id === 'a').status, 'review');
    await saveCapture({ id: 'pending', scope, status: 'pending' });
    await assert.rejects(acceptCaptures(scope, selections), /changed/);
    const pending = (await listCaptures(scope)).find(item => item.id === 'pending');
    await changeCapture(pending, null);
    await acceptCaptures(scope, selections);
    const entries = await listCaptures(scope);
    assert.equal(entries.find(item => item.id === 'a').status, 'saving');
    assert.deepEqual(entries.find(item => item.id === 'b').body, { card_id: 'card-b' });
    assert.equal(entries.find(item => item.id === 'c').status, 'review');
    assert.equal((await listCaptures(other.scope))[0].status, 'review');
    await assert.rejects(acceptCaptures(scope, selections), /changed/);
  } finally { delete globalThis.indexedDB; }
});

test('unresolved repeat blocks captures and acceptance until confirmed or discarded', async () => {
  const fake = fakeIndexedDB();
  globalThis.indexedDB = fake;
  try {
    const scope = 'scope';
    const first = { id: 'first', scope, createdAt: 20, status: 'review', cardId: 'a', cards: [{ id: 'a' }] };
    const repeat = { id: 'repeat', scope, createdAt: 20, status: 'duplicate', cardId: 'a', cards: [{ id: 'a' }] };
    await enqueueCapture(first);
    await enqueueCapture(repeat);
    assert.equal(repeat.createdAt, 21);
    const next = { id: 'next', scope, createdAt: 20, status: 'pending' };
    await assert.rejects(enqueueCapture(next), /repeated scan/);
    await assert.rejects(acceptCaptures(scope, [{ id: 'first', cardId: 'a', body: { card_id: 'a' } }]), /changed/);
    assert.equal((await listCaptures(scope)).length, 2);
    await changeCapture(repeat, { status: 'review' });
    await enqueueCapture(next);
    assert.equal(next.createdAt, 22);
    assert.equal((await listCaptures(scope)).length, 3);
    await changeCapture(next, { status: 'duplicate', cardId: 'a', cards: [{ id: 'a' }] });
    const duplicate = (await listCaptures(scope)).find(item => item.id === 'next');
    await changeCapture(duplicate, null);
    const remaining = await listCaptures(scope);
    assert.deepEqual(remaining.map(item => item.id).sort(), ['first', 'repeat']);
    await acceptCaptures(scope, [
      { id: 'first', cardId: 'a', body: { card_id: 'a' } },
      { id: 'repeat', cardId: 'a', body: { card_id: 'a' } },
    ]);
    assert.equal((await listCaptures(scope)).filter(item => item.status === 'saving').length, 2);
  } finally { delete globalThis.indexedDB; }
});
