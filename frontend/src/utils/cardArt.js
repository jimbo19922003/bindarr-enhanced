import { useSyncExternalStore } from 'react';

// Client half of the contributed-art system. The backend holds art for cards the
// upstream APIs have no image for, in two layers (this instance's uploads, then
// whatever has been contributed back and committed to the repo); see
// backend/src/cardArt.js.

export const artUrl = (cardId) => `/api/card-art/${encodeURIComponent(cardId)}.png`;

// Which cards have art, fetched once per page load. Without this, the only way to
// find out would be to request the art and see if it 404s — which for a grid of a
// few hundred artless cards means a few hundred pointless requests, every scroll.
let ids = new Set();
let started = false;
let status = 'idle';
let inflight = null;
let changesDuringLoad = new Map();
let state = { ids, status };
const listeners = new Set();

// useSyncExternalStore compares snapshots by identity, so the Set object must be
// swapped wholesale on load and stay frozen otherwise — mutating it in place
// would leave every subscriber convinced nothing changed.
const emit = (next, nextStatus = status) => {
  ids = next;
  status = nextStatus;
  state = { ids, status };
  listeners.forEach(fn => fn());
};

export function refreshCardArtIndex() {
  if (inflight) return inflight;
  started = true;
  changesDuringLoad = new Map();
  emit(ids, 'loading');
  inflight = fetch('/api/card-art/index')
    .then(r => {
      if (!r.ok) throw new Error(`Artwork index request failed: ${r.status}`);
      return r.json();
    })
    .then(data => {
      if (!Array.isArray(data?.ids)) throw new Error('Invalid artwork index response');
      const next = new Set(data.ids);
      for (const [id, present] of changesDuringLoad) {
        if (present) next.add(id); else next.delete(id);
      }
      emit(next, 'ready');
    })
    .catch(error => {
      console.error('Could not load artwork index:', error);
      emit(ids, 'error');
    })
    .finally(() => { inflight = null; });
  return inflight;
}

const subscribe = (fn) => { listeners.add(fn); if (!started) void refreshCardArtIndex(); return () => listeners.delete(fn); };
const snapshot = () => ids;
const stateSnapshot = () => state;

// Subscribe to the index. Returns a Set, so callers ask `index.has(cardId)`.
export function useCardArtIndex() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function useCardArtIndexState() {
  return useSyncExternalStore(subscribe, stateSnapshot, stateSnapshot);
}

// Fold a just-uploaded (or just-deleted) card into the index so the change shows
// up everywhere immediately instead of after a reload.
export function noteArtChanged(cardId, present) {
  if (status === 'loading') changesDuringLoad.set(cardId, present);
  if (ids.has(cardId) === present) return;
  const next = new Set(ids);
  if (present) next.add(cardId); else next.delete(cardId);
  emit(next);
}

// Cache-buster appended after an upload: the art URL for a card never changes, so
// without it the browser keeps showing the copy it already has.
export const artVersionParam = () => `?v=${Date.now()}`;
