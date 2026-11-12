'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createReleaseFirstSetSource} = require('./pokemonReleaseSetSource');

const commit = 'b'.repeat(40);
function fixture({languages = ['en'], fail = false} = {}) {
  const calls = {discover: 0, load: 0, api: []};
  const release = {
    async discover() { calls.discover++; if (fail) throw Object.assign(new Error('down'), {code: 'CATALOG_SOURCE_UNAVAILABLE'}); return {commit, languages}; },
    async load(_info, language) {
      calls.load++;
      return {commit, language, sets: [{id: 'sv1', name: 'One'}, {id: 'empty', name: 'Empty'}, {id: 'A1', name: 'Pocket', serie: {id: 'tcgp'}}],
        cards: [{id: 'sv1-1', set: {id: 'sv1'}}, {id: 'sv1-2', set: {id: 'sv1'}}, {id: 'A1-1', set: {id: 'A1'}}]};
    },
  };
  const api = {
    listSets: async () => { calls.api.push('list'); return [{id: 'sv1'}, {id: 'sv9'}]; },
    fetchSetSnapshot: async (language, setId) => { calls.api.push(setId); return {language, commit: 'c'.repeat(40), sets: [{id: setId}], cards: [{id: `${setId}-1`}]}; },
  };
  return {calls, api, source: createReleaseFirstSetSource({release, api, idleMs: 1000, log: {warn() {}}})};
}

test('sets in the release are sliced from it without calling the API, and the release loads once', async () => {
  const f = fixture();
  const progress = [];
  const first = await f.source.fetchSetSnapshot('en', 'sv1', update => progress.push(update));
  assert.equal(first.commit, commit);
  assert.deepEqual(first.sets.map(set => set.id), ['sv1']);
  assert.deepEqual(first.cards.map(card => card.id), ['sv1-1', 'sv1-2']);
  assert.deepEqual(progress.at(-1), {phase: 'fetching', done: 2, total: 2});
  await f.source.fetchSetSnapshot('en', 'sv1');
  assert.equal(f.calls.load, 1);
  assert.deepEqual(f.calls.api, []);
});

test('sets newer than the release, unreleased languages and an unavailable release fall back to the API', async () => {
  const f = fixture();
  await assert.rejects(f.source.fetchSetSnapshot('en', 'empty'), error => error.code === 'TCGDEX_EMPTY_SET');
  assert.equal((await f.source.fetchSetSnapshot('en', 'sv9')).cards[0].id, 'sv9-1');
  assert.equal((await f.source.fetchSetSnapshot('ja', 'sv1')).cards[0].id, 'sv1-1');
  assert.deepEqual(f.calls.api, ['sv9', 'sv1']);
  const down = fixture({fail: true});
  assert.equal((await down.source.fetchSetSnapshot('en', 'sv1')).commit, 'c'.repeat(40));
});

test('the set list comes from the API, and from the release (without digital sets) when the API fails', async () => {
  const f = fixture();
  assert.deepEqual((await f.source.listSets('en')).map(set => set.id), ['sv1', 'sv9']);
  f.api.listSets = async () => { throw new Error('Request failed with status code 503'); };
  assert.deepEqual((await f.source.listSets('en')).map(set => set.id), ['sv1', 'empty']);
  await assert.rejects(f.source.listSets('ja'), /503/);
});
