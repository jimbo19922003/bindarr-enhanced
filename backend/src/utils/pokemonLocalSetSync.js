'use strict';
const {randomUUID} = require('node:crypto');
const {LANGUAGES} = require('./languages');

function createPokemonLocalSetSync({store, source}) {
  let task = null;
  let job = null;
  const status = () => ({running: !!task, job: job ? JSON.parse(JSON.stringify(job)) : null});
  const isLanguage = value => LANGUAGES.some(item => item.code === value);
  const progress = (phase, details) => {
    job.phase = phase;
    job.done = details.done;
    job.total = details.total;
    job.setId = details.setId;
    job.setIndex = details.setIndex;
    job.setCount = details.setCount;
    job.message = `${phase === 'fetching' ? 'Fetching card details' : 'Saving this set to the local catalogue'} for ${details.setId} (${details.done.toLocaleString()} of ${details.total.toLocaleString()}; set ${details.setIndex} of ${details.setCount}).`;
  };

  return {
    status,
    async listSets(language) {
      if (!isLanguage(language)) throw Object.assign(new Error('Unsupported catalog language'), {status: 400});
      return source.listSets(language);
    },
    start(body) {
      const validSetId = typeof body?.setId === 'string' && !!body.setId.trim() && body.setId.length <= 200;
      const wantsAll = body?.allSets === true;
      if (!body || Array.isArray(body) || Object.keys(body).some(key => !['language', 'setId', 'allSets', 'confirmed'].includes(key)) ||
          body.confirmed !== true || !isLanguage(body.language) || wantsAll === validSetId ||
          (body.setId !== undefined && !validSetId) || (body.allSets !== undefined && typeof body.allSets !== 'boolean')) {
        throw Object.assign(new Error('Confirm one supported language and either all sets or one valid set ID.'), {status: 400});
      }
      if (task) throw Object.assign(new Error('A Pokémon set sync is already running.'), {status: 409});

      const {language} = body;
      job = {id: randomUUID(), phase: 'checking', language, setId: null, done: 0, total: 0, setIndex: 0, setCount: 0, completedSets: 0, message: 'Checking sets published for the selected language.'};
      task = Promise.resolve().then(async () => {
        const publishedSets = await source.listSets(language);
        const selectedSets = wantsAll
          ? publishedSets
          : publishedSets.filter(set => set.id === body.setId);
        if (!selectedSets.length) {
          throw new Error(wantsAll
            ? 'No physical sets are published for this language.'
            : 'The selected set is not published for this language.');
        }

        job.setCount = selectedSets.length;
        let syncedCardCount = 0;
        let latestResult = null;
        const syncedSetIds = [];
        const skippedEmptySetIds = [];
        for (let index = 0; index < selectedSets.length; index++) {
          const setId = selectedSets[index].id;
          job.phase = 'fetching';
          job.setId = setId;
          job.setIndex = index + 1;
          job.done = 0;
          job.total = 0;
          job.message = `Fetching set ${setId} (${index + 1} of ${selectedSets.length}).`;

          let snapshot;
          try {
            snapshot = await source.fetchSetSnapshot(language, setId, update => {
              progress('fetching', {...update, setId, setIndex: index + 1, setCount: selectedSets.length});
            });
          } catch (error) {
            if (!wantsAll || error.code !== 'TCGDEX_EMPTY_SET') throw error;
            skippedEmptySetIds.push(setId);
            job.completedSets = index + 1;
            job.skippedEmptySets = skippedEmptySetIds.length;
            job.message = `Skipped ${setId}: TCGdex reports no cards for this set (${index + 1} of ${selectedSets.length}). Continuing with the next set.`;
            continue;
          }
          if (snapshot.language !== language || snapshot.sets?.length !== 1 || snapshot.sets[0].id !== setId) {
            throw new Error(`TCGdex returned a different language or set than requested (${setId}).`);
          }
          syncedCardCount += snapshot.cards.length;
          const result = await store.mergeSet(snapshot, update => {
            progress('saving', {...update, setId, setIndex: index + 1, setCount: selectedSets.length});
          });
          latestResult = result;
          syncedSetIds.push(setId);
          job.completedSets = index + 1;
        }

        job.phase = 'done';
        job.done = selectedSets.length;
        job.total = selectedSets.length;
        job.skippedEmptySets = skippedEmptySetIds.length;
        job.result = {
          synced_card_count: syncedCardCount,
          synced_set_count: syncedSetIds.length,
          synced_set_ids: syncedSetIds,
          skipped_empty_set_count: skippedEmptySetIds.length,
          skipped_empty_set_ids: skippedEmptySetIds,
          card_count: latestResult?.card_count ?? 0,
          set_count: latestResult?.set_count ?? 0,
        };
        if (latestResult) {
          const setLabel = syncedSetIds.length === 1 ? 'set' : 'sets';
          const skippedMessage = skippedEmptySetIds.length
            ? ` Skipped ${skippedEmptySetIds.length.toLocaleString()} set(s) with no cards in TCGdex.`
            : '';
          job.message = `Updated ${syncedSetIds.length.toLocaleString()} ${setLabel} with ${syncedCardCount.toLocaleString()} cards. ${latestResult.card_count.toLocaleString()} cards across ${latestResult.set_count.toLocaleString()} synced sets are now in the local catalogue.${skippedMessage}`;
        } else {
          job.message = `TCGdex reported no cards for any of the ${skippedEmptySetIds.length.toLocaleString()} published sets. No changes were made to the local catalogue.`;
        }
      }).catch(error => {
        console.error(`Pokémon local set sync failed (${language}):`, error.message);
        job.phase = 'failed';
        job.message = job.completedSets
          ? `${error.message} ${job.completedSets} set(s) were synced before the failure; retry to continue.`
          : error.message || 'The selected sets could not be added.';
      }).finally(() => { task = null; });
      return status();
    },
    async waitForIdle() {
      if (task) await task;
      return status();
    },
  };
}

module.exports = {createPokemonLocalSetSync};
