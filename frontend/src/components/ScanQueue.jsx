import { useEffect, useRef, useState } from 'react';
import { getServerUrl, isNative } from '../apiBase';
import { langCode, langName } from '../utils/languages';
import { acceptCaptures, changeCapture, enqueueCapture, likelyRepeatedScan, listCaptures, reviewMatch, saveCapture, topMatchId } from '../utils/scanQueue';
import { useT } from '../utils/i18n';

function currentSession() {
  const user = JSON.parse(localStorage.getItem('bindarr_user') || 'null');
  const token = localStorage.getItem('bindarr_token');
  if (!user?.username || !token) throw new Error('No signed-in user');
  const server = isNative ? getServerUrl() : window.location.origin;
  if (!server) throw new Error('No server configured');
  return { server, username: user.username, token };
}

function sessionMatches(context) {
  const session = currentSession();
  return session.server === context.server && session.username === context.username && session.token === context.token;
}

function addBody(card, item) {
  const language = card.language && langCode(card.language) !== 'en' ? card.language : langName(item.lang);
  return {
    card_id: card.id, quantity: 1, condition: 'Near Mint',
    printing: (card.rarity || '').toLowerCase().includes('holo') ? 'Holofoil' : 'Normal',
    language, purchase_price: null, location_id: null, game: item.game,
  };
}

async function withDeadline(work, parentSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (parentSignal.aborted) abort();
  else parentSignal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 120000);
  try {
    const result = await work(controller.signal);
    if (timedOut) throw new Error('Request timed out. Retry this item.');
    return result;
  } catch (error) {
    if (timedOut) throw new Error('Request timed out. Retry this item.');
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener('abort', abort);
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function useScanQueue({ enabled, resolveCandidates, onAddSuccess, onDuplicate }) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [context, setContext] = useState(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const callbacks = useRef({ resolveCandidates, onAddSuccess, onDuplicate });
  callbacks.current = { resolveCandidates, onAddSuccess, onDuplicate };

  useEffect(() => {
    const controller = new AbortController();
    const initialize = async () => {
      try {
        const session = currentSession();
        const response = await fetch('/api/scan-queue/identity', { signal: controller.signal });
        if (!response.ok) throw new Error(`Scan queue server is unavailable (${response.status})`);
        const identity = await response.json();
        if (!identity.instance_id || !identity.user_id || identity.username !== session.username) throw new Error('Scan queue account could not be verified.');
        if (!controller.signal.aborted && sessionMatches(session)) {
          setContext({ ...session, instance: identity.instance_id, scope: JSON.stringify([session.server, identity.instance_id, identity.user_id]) });
        }
      } catch (err) {
        if (!controller.signal.aborted) { console.error('Cannot open scan queue:', err); setError(err.message); }
      }
    };
    initialize();
    return () => controller.abort();
  }, [connectionAttempt]);

  useEffect(() => {
    if (!context) return;
    const { scope } = context;
    let active = true;
    let timer;
    const controller = new AbortController();
    const refresh = async () => {
      const entries = await listCaptures(scope);
      entries.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      if (active) { setItems(entries); setReady(true); }
      return entries;
    };
    const processOne = async () => {
      if (!sessionMatches(context)) throw new Error('Signed-in user or server changed');
      const entries = await refresh();
      if (entries.some(entry => entry.status === 'duplicate')) return;
      const item = entries.find(entry => entry.status === 'pending' || entry.status === 'saving');
      if (!item || !active) return;
      try {
        if (item.status === 'pending') {
          const { result, candidates, cards } = await withDeadline(async signal => {
            const response = await fetch('/api/scan-match', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ game: item.game, image: item.image, cropped: item.cropped, set: item.set, lang: item.lang, recallK: item.recallK, orb: item.orb }),
              signal,
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Matching failed (${response.status})`);
            const candidates = result.candidates || [];
            const cards = (await callbacks.current.resolveCandidates(candidates.slice(0, 8), result.game, item.lang, signal)).filter(Boolean);
            return { result, candidates, cards };
          }, controller.signal);
          if (!active || !sessionMatches(context)) return;
          item.cards = cards;
          item.cardId = reviewMatch({ ...result, candidates }, cards);
          item.matchId = topMatchId({ ...result, candidates }, cards);
          const previous = entries[entries.indexOf(item) - 1];
          const duplicate = likelyRepeatedScan(previous, item, result, cards);
          item.status = duplicate ? 'duplicate' : 'review';
          item.message = result.notInCatalog ? 'notInCatalog' : result.unresolvedPublished && !cards.length ? 'unresolved' : '';
          await saveCapture(item);
          if (duplicate && active) {
            callbacks.current.onDuplicate();
            setItems(current => current.map(entry => entry.id === item.id ? item : entry));
          }
        }
        if (item.status === 'saving' && active && sessionMatches(context)) {
          const result = await withDeadline(async signal => {
            const response = await fetch('/api/scan-queue/add', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Idempotency-Key': item.id, 'X-Scan-Instance': context.instance },
              body: JSON.stringify(item.body), signal,
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Saving failed (${response.status})`);
            return result;
          }, controller.signal);
          if (!active) return;
          const completed = { ...item, status: result.needs_attention ? 'attention' : 'done', entryId: result.id };
          delete completed.image;
          await saveCapture(completed);
          callbacks.current.onAddSuccess();
        }
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        console.error('Scan queue item failed:', err);
        item.retryStatus = item.status;
        item.status = 'failed';
        item.error = err.message;
        await enqueueCapture(item);
      }
    };
    const tick = async () => {
      try {
        if (!navigator.locks?.request) throw new Error('Web Locks are unavailable in this browser.');
        await navigator.locks.request(`bindarr-scan-queue:${scope}`, { ifAvailable: true }, async lock => {
          if (lock && active) await processOne();
        });
        if (active) { await refresh(); setError(''); }
      } catch (err) {
        console.error('Scan queue unavailable:', err);
        if (active) setError(err.message);
      } finally {
        if (active) timer = setTimeout(tick, 1000);
      }
    };
    tick();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [context]);

  const enqueue = async (capture) => {
    if (!enabled || !context || !sessionMatches(context) || !navigator.locks?.request || !crypto.randomUUID) {
      throw new Error('Scan queue is unavailable for this account or browser.');
    }
    const { scope } = context;
    const item = { ...capture, id: crypto.randomUUID(), scope, createdAt: Date.now(), status: 'pending' };
    await saveCapture(item);
    setItems(previous => previous.some(entry => entry.id === item.id) ? previous : [...previous, item]);
  };
  const update = async (item, changes) => {
    if (!context || !sessionMatches(context)) throw new Error('Signed-in user or server changed');
    await changeCapture(item, changes);
    setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, ...changes } : entry));
  };
  const remove = async (item) => {
    if (!context || !sessionMatches(context)) throw new Error('Signed-in user or server changed');
    await changeCapture(item, null);
    setItems(previous => previous.filter(entry => entry.id !== item.id));
  };
  const accept = async (selected) => {
    if (!context || !sessionMatches(context)) throw new Error('Signed-in user or server changed');
    const selections = selected.map(item => {
      const card = item.cards?.find(candidate => candidate.id === item.cardId);
      if (!card) throw new Error('A selected card is no longer available.');
      return { id: item.id, cardId: card.id, body: addBody(card, item) };
    });
    await acceptCaptures(context.scope, selections);
    setItems(previous => previous.map(item => {
      const selectedItem = selections.find(selection => selection.id === item.id);
      return selectedItem ? { ...item, status: 'saving', body: selectedItem.body } : item;
    }));
  };
  const reconnect = () => { setError(''); setConnectionAttempt(previous => previous + 1); };
  return { items, error, ready, enqueue, update, remove, accept, reconnect };
}

export function ScanQueuePanel({ queue }) {
  const { t } = useT();
  const [actionError, setActionError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const action = async (work) => {
    try { await work(); setActionError(''); }
    catch (err) { console.error('Scan queue action failed:', err); setActionError(err.message); }
  };
  const search = async (event, item) => {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get('query')?.trim();
    if (!query) return;
    await action(async () => {
      const params = new URLSearchParams({ q: query, game: item.game, lang: item.lang, scope: 'internet' });
      const response = await fetch(`/api/search?${params}`);
      if (!response.ok) throw new Error(`Card search failed (${response.status})`);
      const cards = await response.json();
      if (!Array.isArray(cards)) throw new Error('Invalid card search response.');
      await queue.update(item, { cards, cardId: null });
    });
  };
  const counts = {
    waiting: queue.items.filter(item => ['pending', 'saving'].includes(item.status)).length,
    review: queue.items.filter(item => ['review', 'duplicate'].includes(item.status)).length,
    failed: queue.items.filter(item => ['failed', 'attention'].includes(item.status)).length,
    added: queue.items.filter(item => item.status === 'done').length,
  };
  const selected = queue.items.filter(item => item.status === 'review' && item.cardId && item.cards?.some(card => card.id === item.cardId));
  const matching = queue.items.some(item => item.status === 'pending' || item.status === 'duplicate');
  const acceptSelected = async () => {
    if (accepting || !selected.length || matching) return;
    if (!window.confirm(t('scan.queueAcceptConfirm', { count: selected.length }))) return;
    setAccepting(true);
    await action(() => queue.accept(selected));
    setAccepting(false);
  };
  return (
    <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {(queue.error || actionError) && <span role="alert">{t('scan.queueError', { error: queue.error || actionError })}</span>}
      {queue.error && <button type="button" className="btn btn-secondary" onClick={queue.reconnect}>{t('scan.queueRetry')}</button>}
      <details>
      <summary><strong>{t('scan.queueTitle', { count: queue.items.length })}</strong> · {t('scan.queueSummary', counts)}</summary>
      <p>{t('scan.queueHint')}</p>
      <button type="button" className="btn btn-primary" disabled={accepting || matching || !selected.length} onClick={acceptSelected}>
        {t('scan.queueAccept', { count: selected.length })}
      </button>
      {matching && <p>{t('scan.queueWaitMatching')}</p>}
      {queue.items.map(item => (
        <div key={item.id} style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.5rem' }}>
          <div>{t(`scan.queueStatus.${item.status}`)} {item.cards?.find(card => card.id === item.cardId)?.name || ''}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('scan.queueCardDetails', { game: item.game, language: langName(item.lang) })}</div>
          {item.error && <div role="alert">{item.error}</div>}
          {item.message === 'notInCatalog' && <div>{t('scan.notInCatalog')}</div>}
          {item.message === 'unresolved' && <div>{t('scan.readyMadeUnresolved')}</div>}
          {item.image && <img src={item.image} alt={t('scan.queueCapture')} style={{ width: '70px', maxHeight: '100px', objectFit: 'contain' }} />}
          {item.status === 'review' && (
            <div>
              <div>{t('scan.queueReviewHint')}</div>
              {(item.cards || []).map(card => (
                <button key={card.id} type="button" aria-pressed={item.cardId === card.id} className={`btn ${item.cardId === card.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => action(() => queue.update(item, { cardId: item.cardId === card.id ? null : card.id }))}>
                  {card.image_url && <img src={card.image_url} alt="" style={{ width: '45px', verticalAlign: 'middle' }} />}
                  {card.name} · {card.set_name} #{card.number}
                </button>
              ))}
              <div>{item.cardId ? t('scan.queueSelected') : t('scan.queueUnselected')}</div>
              <form onSubmit={event => search(event, item)} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <input name="query" className="input-control" aria-label={t('scan.queueSearchLabel')} placeholder={t('scan.queueSearchLabel')} />
                <button type="submit" className="btn btn-secondary">{t('scan.queueSearch')}</button>
              </form>
            </div>
          )}
          {(item.status === 'failed' || (item.status === 'review' && !item.cards?.length)) && (
            <button type="button" className="btn btn-secondary" onClick={() => action(() => queue.update(item, { status: item.retryStatus || 'pending', error: '' }))}>{t('scan.queueRetry')}</button>
          )}
          {['review', 'failed', 'done', 'attention'].includes(item.status) && (
            <button type="button" className="btn btn-secondary" onClick={() => {
              if (item.status === 'failed' && item.retryStatus === 'saving' && !window.confirm(t('scan.queueRemoveWarning'))) return;
              action(() => queue.remove(item));
            }}>{t('scan.queueRemove')}</button>
          )}
        </div>
      ))}
      </details>
    </div>
  );
}
