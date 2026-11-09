'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPokemonLocalSetSync} = require('./pokemonLocalSetSync');

function fixture() {
  const calls = [];
  const source = {
    listSets: async language => [{id: 'sv2a', name: `${language} set`}],
    fetchSetSnapshot: async (language, setId) => ({language, commit: 'a'.repeat(40), sets: [{id: setId}], cards: [{id: 'one'}]}),
  };
  const store = {mergeSet: async input => { calls.push(input); return {card_count: 12, set_count: 3}; }};
  return {sync: createPokemonLocalSetSync({store, source}), calls, source, store};
}

test('selected set sync validates, loads provider metadata and returns its completion status', async () => {
  const f = fixture();
  assert.throws(() => f.sync.start({language: 'ja', setId: 'sv2a'}), error => error.status === 400);
  f.sync.start({language: 'ja', setId: 'sv2a', confirmed: true});
  await f.sync.waitForIdle();
  assert.equal(f.calls[0].language, 'ja');
  assert.equal(f.calls[0].sets[0].id, 'sv2a');
  assert.equal(f.sync.status().job.phase, 'done');
  assert.match(f.sync.status().job.message, /12 cards/);
});

test('a set absent from the selected language fails without importing data', async () => {
  const f = fixture();
  f.source.listSets = async () => [];
  f.sync.start({language: 'ja', setId: 'sv2a', confirmed: true});
  await f.sync.waitForIdle();
  assert.equal(f.calls.length, 0);
  assert.equal(f.sync.status().job.phase, 'failed');
  assert.match(f.sync.status().job.message, /not published/);
});

test('single-set sync does not silently skip an explicitly selected empty set', async () => {
  const f = fixture();
  f.source.fetchSetSnapshot = async () => {
    const error = new Error('The selected TCGdex set contains no cards');
    error.code = 'TCGDEX_EMPTY_SET';
    throw error;
  };

  f.sync.start({language: 'ja', setId: 'sv2a', confirmed: true});
  await f.sync.waitForIdle();

  assert.equal(f.calls.length, 0);
  assert.equal(f.sync.status().job.phase, 'failed');
  assert.match(f.sync.status().job.message, /contains no cards/);
});

test('all-set sync imports every published set in sequence and reports set progress', async () => {
  const f = fixture();
  f.source.listSets = async language => [
    {id: 'sv2a', name: `${language} first`},
    {id: 'sv3', name: `${language} second`},
  ];

  assert.throws(() => f.sync.start({language: 'ja', confirmed: true}), error => error.status === 400);
  f.sync.start({language: 'ja', allSets: true, confirmed: true});
  await f.sync.waitForIdle();

  assert.deepEqual(f.calls.map(input => input.sets[0].id), ['sv2a', 'sv3']);
  assert.equal(f.sync.status().job.phase, 'done');
  assert.equal(f.sync.status().job.setCount, 2);
  assert.equal(f.sync.status().job.completedSets, 2);
  assert.equal(f.sync.status().job.result.synced_set_count, 2);
  assert.equal(f.sync.status().job.result.synced_card_count, 2);
  assert.match(f.sync.status().job.message, /Updated 2 sets/);
});

test('all-set sync reports partial completion when a later set fails', async () => {
  const f = fixture();
  f.source.listSets = async () => [{id: 'sv2a'}, {id: 'sv3'}];
  f.source.fetchSetSnapshot = async (language, setId) => {
    if (setId === 'sv3') throw new Error('Provider request failed');
    return {language, commit: 'a'.repeat(40), sets: [{id: setId}], cards: [{id: 'one'}]};
  };

  f.sync.start({language: 'ja', allSets: true, confirmed: true});
  await f.sync.waitForIdle();

  assert.equal(f.calls.length, 1);
  assert.equal(f.sync.status().job.phase, 'failed');
  assert.equal(f.sync.status().job.completedSets, 1);
  assert.match(f.sync.status().job.message, /1 set\(s\) were synced before the failure/);
});

test('all-set sync skips TCGdex sets with no cards and continues', async () => {
  const f = fixture();
  f.source.listSets = async () => [{id: 'sv2a'}, {id: 'empty'}, {id: 'sv3'}];
  f.source.fetchSetSnapshot = async (language, setId) => {
    if (setId === 'empty') {
      const error = new Error('The selected TCGdex set contains no cards');
      error.code = 'TCGDEX_EMPTY_SET';
      throw error;
    }
    return {language, commit: 'a'.repeat(40), sets: [{id: setId}], cards: [{id: setId}]};
  };

  f.sync.start({language: 'ja', allSets: true, confirmed: true});
  await f.sync.waitForIdle();

  const job = f.sync.status().job;
  assert.deepEqual(f.calls.map(input => input.sets[0].id), ['sv2a', 'sv3']);
  assert.equal(job.phase, 'done');
  assert.equal(job.completedSets, 3);
  assert.equal(job.skippedEmptySets, 1);
  assert.deepEqual(job.result.synced_set_ids, ['sv2a', 'sv3']);
  assert.deepEqual(job.result.skipped_empty_set_ids, ['empty']);
  assert.match(job.message, /Skipped 1 set\(s\) with no cards/);
});

test('all-set sync with only empty sets completes without changing the catalogue', async () => {
  const f = fixture();
  f.source.listSets = async () => [{id: 'empty1'}, {id: 'empty2'}];
  f.source.fetchSetSnapshot = async () => {
    const error = new Error('The selected TCGdex set contains no cards');
    error.code = 'TCGDEX_EMPTY_SET';
    throw error;
  };

  f.sync.start({language: 'ja', allSets: true, confirmed: true});
  await f.sync.waitForIdle();

  const job = f.sync.status().job;
  assert.equal(job.phase, 'done');
  assert.equal(job.completedSets, 2);
  assert.equal(job.result.synced_set_count, 0);
  assert.equal(job.result.skipped_empty_set_count, 2);
  assert.match(job.message, /No changes were made/);
  assert.equal(f.calls.length, 0);
});

test('selected set sync exposes provider fetch and local save progress', async () => {
  const f = fixture();
  let fetchStarted;
  let saveStarted;
  let releaseFetch;
  let releaseSave;
  const fetching = new Promise(resolve => { fetchStarted = resolve; });
  const saving = new Promise(resolve => { saveStarted = resolve; });
  const fetchGate = new Promise(resolve => { releaseFetch = resolve; });
  const saveGate = new Promise(resolve => { releaseSave = resolve; });

  f.source.fetchSetSnapshot = async (language, setId, onProgress) => {
    onProgress({phase: 'fetching', done: 2, total: 5});
    fetchStarted();
    await fetchGate;
    return {language, commit: 'a'.repeat(40), sets: [{id: setId}], cards: [{id: 'one'}]};
  };
  f.store.mergeSet = async (input, onProgress) => {
    f.calls.push(input);
    onProgress({phase: 'saving', done: 1, total: 3});
    saveStarted();
    await saveGate;
    return {card_count: 12, set_count: 3};
  };

  f.sync.start({language: 'ja', setId: 'sv2a', confirmed: true});
  await fetching;
  assert.equal(f.sync.status().job.phase, 'fetching');
  assert.equal(f.sync.status().job.done, 2);
  assert.match(f.sync.status().job.message, /Fetching card details/);

  releaseFetch();
  await saving;
  assert.equal(f.sync.status().job.phase, 'saving');
  assert.equal(f.sync.status().job.done, 1);
  assert.match(f.sync.status().job.message, /Saving this set/);

  releaseSave();
  await f.sync.waitForIdle();
  assert.equal(f.sync.status().job.phase, 'done');
});
