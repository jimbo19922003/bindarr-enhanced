'use strict';
// Set-sync source that reads the published catalogue release first and calls the
// TCGdex API only for what the release cannot answer. A full "all sets" sync
// through the API is one request per card (~20k for English), which TCGdex
// answers with 503s part-way through; the release is a handful of downloads.
//
// Release snapshots are raw TCGdex records, the same shape fetchSetSnapshot
// returns, so one set is just a slice of it. Sets newer than the release (or a
// language the release does not carry) still come from the API.
const IDLE_MS = 5 * 60 * 1000;
const DIGITAL_SERIES = 'tcgp';

function createReleaseFirstSetSource({release, api, idleMs = IDLE_MS, log = console}) {
  const loaded = new Map(); // language -> {promise, timer}

  const forget = language => {
    const entry = loaded.get(language);
    if (entry) clearTimeout(entry.timer);
    loaded.delete(language);
  };

  // The parsed release is large, so it is held only while a sync is using it.
  function snapshotFor(language) {
    let entry = loaded.get(language);
    if (!entry) {
      entry = {promise: (async () => {
        const info = await release.discover();
        if (!info.languages.includes(language)) return null;
        const snapshot = await release.load(info, language);
        const cardsBySet = new Map();
        for (const card of snapshot.cards) {
          const setId = card.set?.id;
          if (!cardsBySet.has(setId)) cardsBySet.set(setId, []);
          cardsBySet.get(setId).push(card);
        }
        return {commit: snapshot.commit, sets: new Map(snapshot.sets.map(set => [set.id, set])), cardsBySet};
      })().catch(error => {
        log.warn?.(`Pokémon catalogue release unavailable for ${language}; using the TCGdex API: ${error.code || error.message}`);
        forget(language);
        return null;
      })};
      loaded.set(language, entry);
    }
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => forget(language), idleMs);
    entry.timer.unref?.();
    return entry.promise;
  }

  return {
    async listSets(language) {
      try {
        return await api.listSets(language);
      } catch (error) {
        const snapshot = await snapshotFor(language);
        if (!snapshot) throw error;
        return [...snapshot.sets.values()].filter(set => set.serie?.id !== DIGITAL_SERIES);
      }
    },
    async fetchSetSnapshot(language, setId, onProgress = () => {}) {
      const snapshot = await snapshotFor(language);
      const set = snapshot?.sets.get(setId);
      const cards = snapshot?.cardsBySet.get(setId);
      if (set && !cards?.length) {
        throw Object.assign(new Error('The selected TCGdex set contains no cards'), {code: 'TCGDEX_EMPTY_SET'});
      }
      if (!set) return api.fetchSetSnapshot(language, setId, onProgress);
      onProgress({phase: 'fetching', done: cards.length, total: cards.length});
      return {language, commit: snapshot.commit, sets: [set], cards};
    },
  };
}

module.exports = {createReleaseFirstSetSource};
