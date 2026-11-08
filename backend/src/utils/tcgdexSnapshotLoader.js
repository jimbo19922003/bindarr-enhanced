'use strict';

const axios = require('axios');
const { LANGUAGES } = require('./languages');

const API_BASE = 'https://api.tcgdex.net/v2';
const GITHUB_API = 'https://api.github.com/repos/tcgdex/cards-database';
const CONCURRENCY = 4;
const DIGITAL_SERIES = 'tcgp';

const client = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'User-Agent': 'Bindarr-catalog-sync', Accept: 'application/json' },
});

async function mapLimited(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      items.slice(i, i + CONCURRENCY).map((it) => fn(it).catch(() => null))
    );
    out.push(...batch.filter(Boolean));
  }
  return out;
}

async function fetchLatestCommit(token) {
  const headers = {
    'User-Agent': 'Bindarr-catalog-sync',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await axios.get(`${GITHUB_API}/commits/master`, {
    headers,
    timeout: 15000,
    validateStatus: (s) => s === 200,
  });

  if (!/^[a-f0-9]{40}$/.test(response.data?.sha)) {
    throw new Error('Invalid commit SHA from GitHub');
  }
  return response.data.sha;
}

async function fetchSeries(lang) {
  const { data } = await client.get(`/${lang}/series`);
  const bySet = new Map();
  const digitalSets = new Set();

  const details = await mapLimited(data || [], async (s) => {
    const r = await client.get(`/${lang}/series/${encodeURIComponent(s.id)}`);
    return { id: s.id, name: s.name || s.id, sets: r.data?.sets || [] };
  });

  for (const serie of details) {
    for (const s of serie.sets) {
      if (s?.id) {
        bySet.set(s.id, { id: serie.id, name: serie.name });
        if (serie.id === DIGITAL_SERIES) digitalSets.add(s.id);
      }
    }
  }
  return { bySet, digitalSets };
}

async function fetchSets(lang) {
  const { data } = await client.get(`/${lang}/sets`);
  if (!Array.isArray(data) || !data.length) {
    throw new Error(`No sets returned for language ${lang}`);
  }

  const { bySet, digitalSets } = await fetchSeries(lang);

  const sets = [];
  for (const s of data) {
    if (!s?.id || digitalSets.has(s.id)) continue;

    let detail = null;
    try {
      const r = await client.get(`/${lang}/sets/${encodeURIComponent(s.id)}`);
      detail = r.data;
    } catch { /* use brief data */ }

    sets.push({
      id: s.id,
      name: s.name || s.id,
      serie: bySet.get(s.id) || null,
      releaseDate: detail?.releaseDate || '',
      cardCount: {
        official: s.cardCount?.official || detail?.cardCount?.official || 0,
        total: s.cardCount?.total || detail?.cardCount?.total || 0,
      },
    });
  }

  return sets;
}

async function fetchCards(lang, sets) {
  const cards = [];

  await mapLimited(sets, async (set) => {
    const { data } = await client.get(`/${lang}/sets/${encodeURIComponent(set.id)}`);
    const setCards = data?.cards || [];

    for (const brief of setCards) {
      if (!brief?.id) continue;

      let full = null;
      try {
        const r = await client.get(`/${lang}/cards/${encodeURIComponent(brief.id)}`);
        full = r.data;
      } catch { /* use brief */ }

      const card = full || brief;
      cards.push({
        id: card.id || brief.id,
        localId: card.localId ?? brief.localId,
        name: card.name || brief.name,
        category: card.category,
        stage: card.stage,
        types: card.types,
        rarity: card.rarity,
        image: card.image || brief.image,
        set: { id: set.id, name: set.name },
        pricing: card.pricing,
      });
    }
  });

  return cards;
}

function createTcgdexSnapshotLoader({ githubToken = process.env.TCGDEX_GITHUB_TOKEN } = {}) {
  return async function loadSnapshot({ commit, language }) {
    const lang = LANGUAGES.find((l) => l.code === language);
    if (!lang) throw new Error(`Unsupported language: ${language}`);

    console.log(`[tcgdex-sync] Loading snapshot for ${language} at commit ${commit.slice(0, 8)}...`);

    const sets = await fetchSets(language);
    console.log(`[tcgdex-sync] Fetched ${sets.length} sets for ${language}`);

    const cards = await fetchCards(language, sets);
    console.log(`[tcgdex-sync] Fetched ${cards.length} cards for ${language}`);

    return { commit, language, sets, cards };
  };
}

function createCommitReader({ token = process.env.TCGDEX_GITHUB_TOKEN } = {}) {
  let cached = null;
  let etag = null;

  return {
    async read() {
      try {
        const headers = {
          'User-Agent': 'Bindarr-catalog-sync',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        };
        if (etag) headers['If-None-Match'] = etag;
        if (token) headers.Authorization = `Bearer ${token}`;

        const response = await axios.get(`${GITHUB_API}/commits/master`, {
          headers,
          timeout: 15000,
          validateStatus: (s) => s === 200 || s === 304,
        });

        if (response.status === 304) {
          if (!cached) throw new Error('Commit cache missing');
          return cached;
        }

        if (!/^[a-f0-9]{40}$/.test(response.data?.sha)) {
          throw new Error('Invalid commit SHA');
        }

        cached = response.data.sha;
        etag = response.headers?.etag || null;
        return cached;
      } catch (err) {
        if (cached) {
          console.warn('[tcgdex-sync] GitHub check failed, using cached commit:', err.message);
          return cached;
        }
        throw err;
      }
    },
  };
}

module.exports = {
  createTcgdexSnapshotLoader,
  createCommitReader,
  fetchLatestCommit,
  fetchSets,
  fetchCards,
};
