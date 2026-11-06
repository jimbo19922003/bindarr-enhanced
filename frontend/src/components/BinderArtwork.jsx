import { useEffect, useMemo, useRef, useState } from 'react';
import { pageGrid } from '../utils/binderLayout';
import { binderSpread } from '../utils/cardOptions';
import {
  PAPERS, pocketPresetFor, pageGeometry, compositionOf, coverWidthMm,
  artworkSlices, remapMask, packInserts,
} from '../utils/michiGeometry';

function slotIndex(card) {
  return Math.floor((Number(card.position) || 0) / 1000) - 1;
}

function sameMask(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function BinderArtwork({ location, compartments, pageIndex, cardsByCompartment, onClose, showToast, t }) {
  const preset = pocketPresetFor(location.type);
  const spreadInfo = binderSpread(pageIndex);
  const left = spreadInfo.leftIdx >= 0 ? compartments[spreadInfo.leftIdx] : null;
  const right = compartments[spreadInfo.rightIdx] || null;
  const anchor = left || right;
  const facing = left && right ? right : null;
  const anchorPage = useMemo(
    () => (anchor ? pageGeometry({ ...pageGrid(anchor.capacity, location.page_columns), pocket: preset }) : null),
    [anchor, location.page_columns, preset]
  );
  const facingPage = useMemo(
    () => (facing ? pageGeometry({ ...pageGrid(facing.capacity, location.page_columns), pocket: preset }) : null),
    [facing, location.page_columns, preset]
  );

  const [artwork, setArtwork] = useState(null);
  const [transform, setTransform] = useState(null);
  const [mask, setMask] = useState([]);
  const [spread, setSpread] = useState(false);
  const [saved, setSaved] = useState(null);
  const [history, setHistory] = useState([]);
  const [mode, setMode] = useState('place');
  const [paper, setPaper] = useState('a4');
  const [busy, setBusy] = useState(false);
  const [src, setSrc] = useState('');
  const press = useRef(null);
  const keys = useRef({});

  const composition = useMemo(
    () => (anchorPage ? compositionOf(anchorPage, facingPage, spread && !!facingPage) : null),
    [anchorPage, facingPage, spread]
  );
  const image = artwork ? { aspect: artwork.width / artwork.height } : null;

  useEffect(() => {
    document.body.classList.toggle('michi-printing', mode === 'print');
    return () => document.body.classList.remove('michi-printing');
  }, [mode]);

  useEffect(() => {
    if (!artwork) {
      setSrc('');
      return undefined;
    }
    let stop = false;
    let url = '';
    (async () => {
      const response = await fetch(`/api/binder-art/${artwork.id}/image`);
      if (!response.ok || stop) return;
      url = URL.createObjectURL(await response.blob());
      if (stop) {
        URL.revokeObjectURL(url);
        return;
      }
      setSrc(url);
    })();
    return () => {
      stop = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [artwork]);

  useEffect(() => {
    if (!anchor || !anchorPage) return undefined;
    let stop = false;
    (async () => {
      const response = await fetch(`/api/locations/${location.id}/binder-art`);
      const data = await response.json().catch(() => ({}));
      if (stop || !response.ok) return;
      const layer = (data.layers || []).find(item => item.compartment_id === anchor.id);
      if (!layer) return;
      const next = compositionOf(anchorPage, facingPage, layer.spread && !!facingPage);
      const kept = remapMask(layer.mask, next);
      const placed = { xMm: layer.x_mm, yMm: layer.y_mm, widthMm: layer.width_mm, rotationDeg: layer.rotation_deg };
      setArtwork({ id: layer.artwork_id, width: layer.width, height: layer.height });
      setTransform(placed);
      setMask(kept);
      setSpread(!!layer.spread && !!facingPage);
      setSaved({ transform: placed, mask: kept, spread: !!layer.spread && !!facingPage });
      if (kept.length !== layer.mask.length) showToast(t('binderArt.layoutChanged'));
    })();
    return () => { stop = true; };
  }, [anchor, anchorPage, facingPage, location.id, showToast, t]);

  const remember = (snapshot) => {
    setHistory(current => [...current.slice(-19), snapshot]);
  };

  const undo = () => {
    setHistory(current => {
      const previous = current[current.length - 1];
      if (!previous) return current;
      setTransform(previous.transform);
      setMask(previous.mask);
      setSpread(previous.spread);
      return current.slice(0, -1);
    });
  };

  const upload = async (file) => {
    if (!file || !composition) return;
    setBusy(true);
    try {
      const response = await fetch('/api/binder-art', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('binderArt.errUpload'));
      const aspect = data.artwork.width / data.artwork.height;
      const next = {
        xMm: composition.widthMm / 2,
        yMm: composition.heightMm / 2,
        widthMm: coverWidthMm(composition, aspect),
        rotationDeg: 0,
      };
      const nextMask = [];
      for (const placed of composition.pages) {
        for (let row = 0; row < placed.page.rows; row += 1) {
          for (let col = 0; col < placed.page.columns; col += 1) nextMask.push({ side: placed.side, row, col });
        }
      }
      if (transform) remember({ transform, mask, spread });
      setArtwork(data.artwork);
      setTransform(next);
      setMask(nextMask);
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const togglePocket = (side, row, col) => {
    if (transform) remember({ transform, mask, spread });
    setMask(current => {
      const exists = current.some(entry => entry.side === side && entry.row === row && entry.col === col);
      return exists
        ? current.filter(entry => !(entry.side === side && entry.row === row && entry.col === col))
        : [...current, { side, row, col }];
    });
  };

  const onPointerDown = (event) => {
    if (!transform || !composition || mode !== 'place') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    press.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: transform,
      mm: composition.widthMm / bounds.width,
      moved: false,
      pocket: event.target.closest('[data-pocket]'),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    const session = press.current;
    if (!session || session.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - session.x, event.clientY - session.y) < 4) return;
    if (!session.moved) {
      session.moved = true;
      remember({ transform: session.origin, mask, spread });
    }
    setTransform({
      ...session.origin,
      xMm: session.origin.xMm + (event.clientX - session.x) * session.mm,
      yMm: session.origin.yMm + (event.clientY - session.y) * session.mm,
    });
  };

  const onPointerUp = (event) => {
    const session = press.current;
    if (!session || session.id !== event.pointerId) return;
    press.current = null;
    if (session.moved || !session.pocket) return;
    togglePocket(session.pocket.dataset.side, Number(session.pocket.dataset.row), Number(session.pocket.dataset.col));
  };

  const changeTransform = (patch) => {
    remember({ transform, mask, spread });
    setTransform({ ...transform, ...patch });
  };

  keys.current = { mode, transform, undo, changeTransform };
  useEffect(() => {
    const onKey = (event) => {
      const current = keys.current;
      if (current.mode !== 'place' || !current.transform) return;
      if (event.target instanceof Element && event.target.closest('input, textarea')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        current.undo();
        return;
      }
      const step = event.shiftKey ? 5 : 1;
      const patch = {
        ArrowLeft: { xMm: current.transform.xMm - step },
        ArrowRight: { xMm: current.transform.xMm + step },
        ArrowUp: { yMm: current.transform.yMm - step },
        ArrowDown: { yMm: current.transform.yMm + step },
      }[event.key];
      if (!patch) return;
      event.preventDefault();
      current.changeTransform(patch);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const save = async () => {
    if (!artwork || !transform || !anchor) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/locations/${location.id}/compartments/${anchor.id}/binder-art`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artwork_id: artwork.id,
          x_mm: transform.xMm,
          y_mm: transform.yMm,
          width_mm: transform.widthMm,
          rotation_deg: transform.rotationDeg,
          spread,
          mask,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('binderArt.errSave'));
      setSaved({ transform, mask, spread });
      showToast(t('binderArt.saved'));
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    const dirty = artwork && (
      !saved
      || transform.xMm !== saved.transform.xMm
      || transform.yMm !== saved.transform.yMm
      || transform.widthMm !== saved.transform.widthMm
      || transform.rotationDeg !== saved.transform.rotationDeg
      || spread !== saved.spread
      || !sameMask(mask, saved.mask)
    );
    if (dirty && !window.confirm(t('binderArt.confirmCancel'))) return;
    onClose();
  };

  const slices = composition && image && transform ? artworkSlices({ composition, image, transform, mask }) : [];
  const packed = packInserts({ slices, paper: PAPERS[paper] });

  const renderPage = (placed) => {
    const pageId = placed.side === 'left' ? anchor.id : facing.id;
    const cards = cardsByCompartment.get(pageId) || [];
    return (
      <div key={placed.side} style={{ position: 'relative', width: `${(placed.page.widthMm / composition.widthMm) * 100}%`, aspectRatio: `${placed.page.widthMm} / ${placed.page.heightMm}` }}>
        {src && transform && (
          <img
            src={src}
            alt=""
            draggable="false"
            style={{
              position: 'absolute',
              left: `${((transform.xMm - placed.originX) / placed.page.widthMm) * 100}%`,
              top: `${((transform.yMm - placed.originY) / placed.page.heightMm) * 100}%`,
              width: `${(transform.widthMm / placed.page.widthMm) * 100}%`,
              height: 'auto',
              transform: `translate(-50%, -50%) rotate(${transform.rotationDeg}deg)`,
              pointerEvents: 'none',
            }}
          />
        )}
        <div style={{
          position: 'absolute', inset: 0, display: 'grid',
          gridTemplateColumns: `repeat(${placed.page.columns}, 1fr)`,
          gridTemplateRows: `repeat(${placed.page.rows}, 1fr)`,
        }}>
          {Array.from({ length: placed.page.columns * placed.page.rows }, (_, index) => {
            const row = Math.floor(index / placed.page.columns);
            const col = index % placed.page.columns;
            const art = mask.some(entry => entry.side === placed.side && entry.row === row && entry.col === col);
            const card = cards.find(item => slotIndex(item) === index);
            return (
              <div
                key={`${placed.side}-${index}`}
                data-pocket
                data-side={placed.side}
                data-row={row}
                data-col={col}
                title={art ? t('binderArt.pocketArt') : t('binderArt.pocketCard')}
                style={{
                  border: '1px solid rgba(255,255,255,0.35)',
                  background: art ? 'transparent' : 'var(--bg-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-secondary)', fontSize: '0.65rem',
                }}
              >
                {!art && card && card.image_url && <img src={card.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
                {!art && !card && t('binderArt.card')}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="glass-panel" style={{ width: 'min(1100px, 100%)', maxHeight: '100%', overflow: 'auto', padding: '1rem', display: 'grid', gap: '0.8rem' }}>
        <div className="michi-chrome" style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>{t('binderArt.title')}</h2>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t('binderArt.hint')}</p>
          </div>
          <div className="sub-nav-tabs" style={{ margin: 0, width: 'auto' }}>
            {['place', 'preview', 'print'].map(id => (
              <button key={id} type="button" className={`sub-nav-tab ${mode === id ? 'active' : ''}`} style={{ flex: '0 0 auto', padding: '0.4rem 0.8rem' }} onClick={() => setMode(id)}>{t(`binderArt.mode.${id}`)}</button>
            ))}
          </div>
        </div>

        {mode !== 'print' && composition && (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{ display: 'flex', background: '#111', borderRadius: '8px', overflow: 'hidden', touchAction: 'none', cursor: mode === 'place' && artwork ? 'grab' : 'default' }}
          >
            {composition.pages.map(renderPage)}
          </div>
        )}

        {mode === 'place' && (
          <div className="michi-chrome" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
              {t('binderArt.upload')}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(event) => { const file = event.target.files && event.target.files[0]; event.target.value = ''; upload(file); }} />
            </label>
            {facing && (
              <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={spread} onChange={(event) => {
                  if (transform) remember({ transform, mask, spread });
                  const on = event.target.checked;
                  setSpread(on);
                  if (!on) setMask(current => current.filter(entry => entry.side !== 'right'));
                }} />
                {t('binderArt.spread')}
              </label>
            )}
            {transform && (
              <>
                <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{t('binderArt.scale')}
                  <input className="input-control" type="number" min="10" step="1" value={Math.round(transform.widthMm)} onChange={(event) => changeTransform({ widthMm: Math.max(10, Number(event.target.value) || 10) })} style={{ width: '6rem' }} />
                </label>
                <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{t('binderArt.rotation')}
                  <input className="input-control" type="number" step="1" value={Math.round(transform.rotationDeg)} onChange={(event) => changeTransform({ rotationDeg: Number(event.target.value) || 0 })} style={{ width: '5rem' }} />
                </label>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => changeTransform({ xMm: transform.xMm - 1 })}>←</button>
                  <button type="button" className="btn btn-secondary" onClick={() => changeTransform({ xMm: transform.xMm + 1 })}>→</button>
                  <button type="button" className="btn btn-secondary" onClick={() => changeTransform({ yMm: transform.yMm - 1 })}>↑</button>
                  <button type="button" className="btn btn-secondary" onClick={() => changeTransform({ yMm: transform.yMm + 1 })}>↓</button>
                </div>
              </>
            )}
            <button type="button" className="btn btn-secondary" disabled={!history.length} onClick={undo}>{t('binderArt.undo')}</button>
          </div>
        )}

        {mode === 'print' && (
          <div>
            <p className="michi-chrome" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t('binderArt.printInstructions')}</p>
            <div className="michi-chrome" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              {Object.values(PAPERS).map(item => (
                <button key={item.id} type="button" className={`btn ${paper === item.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPaper(item.id)}>{item.name}</button>
              ))}
              <button type="button" className="btn btn-primary" disabled={!slices.length} onClick={() => window.print()}>{t('binderArt.print')}</button>
            </div>
            {packed.rejected.length > 0 && <p className="michi-chrome">{t('binderArt.tooBig', { count: packed.rejected.length })}</p>}
            <style>{`@media print { @page { size: ${paper === 'letter' ? 'letter' : 'A4'}; margin: 0; } }`}</style>
            <div className="michi-print-root">
              {packed.sheets.map((sheet, index) => (
                <section key={index} className="michi-sheet" style={{ width: `${sheet.widthMm}mm`, height: `${sheet.heightMm}mm`, position: 'relative', background: 'white', color: 'black', margin: '0 auto 12px' }}>
                  {sheet.tiles.map(tile => {
                    const placed = composition.pages.find(page => page.side === tile.side);
                    const pocketX = placed.originX + tile.col * tile.widthMm;
                    const pocketY = placed.originY + tile.row * tile.heightMm;
                    return (
                      <div key={`${tile.side}-${tile.row}-${tile.col}`} style={{ position: 'absolute', left: `${tile.x}mm`, top: `${tile.y}mm`, width: `${tile.widthMm}mm`, height: `${tile.heightMm}mm`, overflow: 'hidden' }}>
                        {src && (
                          <img
                            src={src}
                            alt=""
                            style={{
                              position: 'absolute',
                              left: `${transform.xMm - pocketX}mm`,
                              top: `${transform.yMm - pocketY}mm`,
                              width: `${transform.widthMm}mm`,
                              height: 'auto',
                              transform: `translate(-50%, -50%) rotate(${transform.rotationDeg}deg)`,
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                  {sheet.tiles.flatMap(tile => tile.guides.map((guide, guideIndex) => (
                    <i key={`${tile.side}-${tile.row}-${tile.col}-${guideIndex}`} style={{ position: 'absolute', left: `${guide.x1}mm`, top: `${guide.y1}mm`, width: `${Math.max(guide.x2 - guide.x1, 0.25)}mm`, height: `${Math.max(guide.y2 - guide.y1, 0.25)}mm`, background: '#111' }} />
                  )))}
                  <div style={{ position: 'absolute', left: `${sheet.markerX}mm`, top: `${sheet.markerY}mm`, width: `${sheet.markerMm}mm`, borderTop: '0.4mm solid black', fontSize: '8pt', lineHeight: 1 }}>
                    {sheet.markerMm} mm
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        <div className="michi-chrome" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" onClick={cancel}>{t('binderArt.cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={!artwork || busy} onClick={save}>{t('binderArt.save')}</button>
        </div>
      </div>
    </div>
  );
}

export default BinderArtwork;
