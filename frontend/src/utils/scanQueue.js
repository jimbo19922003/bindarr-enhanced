const DB_NAME = 'bindarr-scan-queue';
const STORE = 'captures';
export const SCAN_MATCH_MIN_SCORE = 0.55;
export const SCAN_MATCH_MIN_INLIERS = 12;
export const SCAN_MATCH_MIN_MARGIN = 0.02;

function openQueue() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('scope', 'scope');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Scan queue database is blocked by another tab.'));
  });
}

async function transaction(mode, action) {
  const db = await openQueue();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let request;
      try { request = action(tx.objectStore(STORE)); }
      catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve(request?.result);
      tx.onabort = () => reject(tx.error || new Error('Scan queue transaction aborted.'));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export const saveCapture = item => transaction('readwrite', store => store.put(item));
export const removeCapture = id => transaction('readwrite', store => store.delete(id));
export const listCaptures = scope => transaction('readonly', store => store.index('scope').getAll(scope));

export async function enqueueCapture(item) {
  const db = await openQueue();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let blocked = false;
      const request = store.index('scope').getAll(item.scope);
      request.onsuccess = () => {
        if (request.result.some(entry => entry.status === 'duplicate')) {
          blocked = true;
          tx.abort();
          return;
        }
        const latest = request.result.reduce((max, entry) => Math.max(max, entry.createdAt || 0), 0);
        item.createdAt = Math.max(item.createdAt, latest + 1);
        store.put(item);
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(blocked ? new Error('Resolve the repeated scan before capturing another card.') : tx.error || new Error('Capture transaction aborted.'));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function changeCapture(item, changes) {
  const db = await openQueue();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let stale = false;
      const request = store.get(item.id);
      request.onsuccess = () => {
        const current = request.result;
        if (!current || current.scope !== item.scope || current.status !== item.status || current.cardId !== item.cardId) {
          stale = true;
          tx.abort();
          return;
        }
        if (changes === null) store.delete(item.id);
        else store.put({ ...current, ...changes });
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(stale ? new Error('Queue item changed in another tab. Refresh and try again.') : tx.error || new Error('Queue update aborted.'));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function acceptCaptures(scope, selections) {
  if (!selections.length) throw new Error('No scans selected.');
  const db = await openQueue();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let stale = false;
      const request = store.index('scope').getAll(scope);
      request.onsuccess = () => {
        const byId = new Map(request.result.map(item => [item.id, item]));
        if (request.result.some(item => item.status === 'pending' || item.status === 'duplicate')
          || new Set(selections.map(item => item.id)).size !== selections.length || selections.some(selection => {
          const current = byId.get(selection.id);
          return !current || current.status !== 'review' || !selection.cardId
            || current.cardId !== selection.cardId || !current.cards?.some(card => card.id === selection.cardId);
        })) {
          stale = true;
          tx.abort();
          return;
        }
        for (const selection of selections) {
          store.put({ ...byId.get(selection.id), status: 'saving', body: selection.body });
        }
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(stale ? new Error('Queue selection changed. Refresh and review it again.') : tx.error || new Error('Queue acceptance aborted.'));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export function reviewMatch(result, cards) {
  return confidentScan(result) ? topMatchId(result, cards) : null;
}

export function topMatchId(result, cards) {
  return !result.notInCatalog && sameScanCard(cards[0], result.candidates?.[0]) ? cards[0].id : null;
}

export function likelyRepeatedScan(previous, item, result, cards) {
  if (!previous) return false;
  const previousId = previous.matchId || previous.cardId;
  return !!previousId && previous.game === item.game && previousId === topMatchId(result, cards);
}

// Both scanner modes reject close printing ties, low embedding margins and
// catalog misses rather than auto-adding a merely plausible nearest match.
export function confidentScan({ candidates, verified, notInCatalog }) {
  const [top, second] = candidates || [];
  if (!top || notInCatalog) return false;
  const confident = verified ? top.inliers >= SCAN_MATCH_MIN_INLIERS : top.score >= SCAN_MATCH_MIN_SCORE;
  const ambiguous = second && top.name === second.name
    && (top.set !== second.set || top.number !== second.number)
    && (verified ? second.inliers >= top.inliers * 0.7 : second.score >= top.score - 0.02);
  const lowMargin = !verified && second && top.score - second.score < SCAN_MATCH_MIN_MARGIN;
  return !!confident && !ambiguous && !lowMargin;
}

export function sameScanCard(card, candidate) {
  const number = value => String(value ?? '').trim().toLowerCase().replace(/^0+(?=\d)/, '');
  return !!card && !!candidate && !!number(card.number) && number(card.number) === number(candidate.number)
    && (String(card.set_id).toLowerCase() === String(candidate.set).toLowerCase()
      || String(card.set_name || '').toLowerCase() === String(candidate.set).toLowerCase());
}
