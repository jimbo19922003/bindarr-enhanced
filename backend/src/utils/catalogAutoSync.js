'use strict';

const { createPokemonCatalogSync } = require('./pokemonCatalogSync');
const { createPokemonLocalCatalog } = require('./pokemonLocalCatalog');
const { createTcgdexSnapshotLoader, createCommitReader } = require('./tcgdexSnapshotLoader');
const { LANGUAGES } = require('./languages');

const DEFAULT_LANGUAGES = ['en'];
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;

let syncService = null;
let languageQueue = new Set();
let onDemandInProgress = false;

function isEnabled() {
  return process.env.POKEMON_CATALOG_AUTOSYNC !== '0';
}

function getConfiguredLanguages() {
  const env = process.env.POKEMON_CATALOG_LANGUAGES;
  if (!env) return DEFAULT_LANGUAGES;

  const codes = env.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const valid = codes.filter((code) => LANGUAGES.some((l) => l.code === code));
  return valid.length ? valid : DEFAULT_LANGUAGES;
}

function createService(connect) {
  const store = createPokemonLocalCatalog({ connect });
  const loader = createTcgdexSnapshotLoader();
  const reader = createCommitReader();

  return createPokemonCatalogSync({
    store,
    loadSnapshot: loader,
    reader,
    languages: getConfiguredLanguages(),
    intervalMs: SYNC_INTERVAL_MS,
  });
}

async function runInitialSync(connect) {
  if (!isEnabled()) {
    console.log('[catalog-auto-sync] Disabled (POKEMON_CATALOG_AUTOSYNC=0)');
    return { skipped: true, reason: 'not_enabled' };
  }

  console.log('[catalog-auto-sync] Starting initial catalog sync...');

  try {
    if (!syncService) {
      syncService = createService(connect);
    }

    const result = await syncService.sync();
    console.log('[catalog-auto-sync] Initial sync complete:', JSON.stringify(result.languages || {}));
    return result;
  } catch (err) {
    console.error('[catalog-auto-sync] Initial sync failed:', err.message);
    return { error: err.message };
  }
}

function startPeriodicSync(connect) {
  if (!isEnabled()) return null;

  if (!syncService) {
    syncService = createService(connect);
  }

  syncService.start();
  console.log(`[catalog-auto-sync] Periodic sync started (every ${SYNC_INTERVAL_MS / 1000 / 60 / 60}h)`);
  return syncService;
}

function stopPeriodicSync() {
  if (syncService) {
    syncService.stop();
    console.log('[catalog-auto-sync] Periodic sync stopped');
  }
}

function status() {
  if (!isEnabled()) {
    return { enabled: false, reason: 'POKEMON_CATALOG_AUTOSYNC=0' };
  }

  if (!syncService) {
    return { enabled: true, initialized: false };
  }

  return {
    enabled: true,
    initialized: true,
    configuredLanguages: getConfiguredLanguages(),
    pendingLanguages: [...languageQueue],
    onDemandInProgress,
    ...syncService.status(),
  };
}

async function addLanguage(connect, languageCode) {
  const lang = LANGUAGES.find((l) => l.code === languageCode || l.name === languageCode);
  if (!lang) {
    throw new Error(`Unsupported language: ${languageCode}`);
  }

  if (!isEnabled()) {
    throw new Error('Catalog auto-sync is disabled');
  }

  const code = lang.code;
  languageQueue.add(code);

  if (onDemandInProgress) {
    console.log(`[catalog-auto-sync] Language ${code} queued for sync`);
    return { queued: true, language: code };
  }

  onDemandInProgress = true;

  try {
    const store = createPokemonLocalCatalog({ connect });
    const loader = createTcgdexSnapshotLoader();
    const reader = createCommitReader();

    const commit = await reader.read();
    console.log(`[catalog-auto-sync] Syncing language ${code} at commit ${commit.slice(0, 8)}...`);

    const existing = await store.status(code);
    if (existing?.source_commit === commit) {
      console.log(`[catalog-auto-sync] Language ${code} already at latest commit`);
      languageQueue.delete(code);
      return { unchanged: true, language: code, commit };
    }

    const snapshot = await loader({ commit, language: code });
    const result = await store.importSnapshot(snapshot);

    console.log(`[catalog-auto-sync] Language ${code} synced: ${result.card_count} cards, ${result.set_count} sets`);
    languageQueue.delete(code);

    while (languageQueue.size > 0) {
      const next = [...languageQueue][0];
      languageQueue.delete(next);

      try {
        const nextExisting = await store.status(next);
        if (nextExisting?.source_commit === commit) continue;

        const nextSnapshot = await loader({ commit, language: next });
        await store.importSnapshot(nextSnapshot);
        console.log(`[catalog-auto-sync] Queued language ${next} synced`);
      } catch (err) {
        console.error(`[catalog-auto-sync] Failed to sync queued language ${next}:`, err.message);
      }
    }

    return { success: true, language: code, ...result };
  } finally {
    onDemandInProgress = false;
  }
}

function startSync(connect) {
  if (!isEnabled()) return { started: false, reason: 'disabled' };
  if (!syncService) syncService = createService(connect);
  const current = syncService.status();
  if (current.running) return { started: false, alreadyRunning: true, ...current };
  const pending = syncService.sync();
  const snapshot = syncService.status();
  if (!snapshot.running) return { started: false, deferred: true, ...snapshot };
  pending.catch((err) => {
    console.error('[catalog-auto-sync] Sync failed:', err.message);
  });
  return { started: true, ...snapshot };
}

async function initialize(connect) {
  if (!isEnabled()) {
    console.log('[catalog-auto-sync] Disabled (POKEMON_CATALOG_AUTOSYNC=0)');
    return;
  }

  console.log('[catalog-auto-sync] Initializing English catalogue sync...');

  setTimeout(async () => {
    try {
      await runInitialSync(connect);
      startPeriodicSync(connect);
    } catch (err) {
      console.error('[catalog-auto-sync] Initialization failed:', err.message);
      setTimeout(() => initialize(connect), 60000);
    }
  }, INITIAL_DELAY_MS);
}

module.exports = {
  initialize,
  runInitialSync,
  startSync,
  startPeriodicSync,
  stopPeriodicSync,
  addLanguage,
  status,
  isEnabled,
  getConfiguredLanguages,
};
