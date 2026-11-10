// Pocket geometry for binder artwork, in millimetres.
//
// A pocket is always one pocket. Artwork that covers several of them is one
// picture, placed by position, a single scale and an optional rotation, then
// cut into the pockets that were selected to show it. The other pockets stay
// card pockets and are not printed. Nothing here stretches an image: scale is
// one number, and the picture's own aspect supplies the height.
//
// Pocket size is an argument. A standard card and a toploader are presets the
// caller picks; the math does not assume either one.

export const PAPERS = {
  a4: { id: 'a4', name: 'A4', widthMm: 210, heightMm: 297 },
  letter: { id: 'letter', name: 'Letter', widthMm: 215.9, heightMm: 279.4 },
};

export const POCKET_PRESETS = {
  card: { id: 'card', widthMm: 63, heightMm: 88 },
  toploader: { id: 'toploader', widthMm: 76, heightMm: 102 },
};

export const CALIBRATION_MM = 50;

export function pocketPresetFor(locationType) {
  return locationType === 'Toploader Binder' ? POCKET_PRESETS.toploader : POCKET_PRESETS.card;
}

export function pageGeometry({ columns, rows, pocket }) {
  const cols = Math.max(1, columns | 0);
  const rowCount = Math.max(1, rows | 0);
  const pocketWidthMm = Number(pocket.widthMm);
  const pocketHeightMm = Number(pocket.heightMm);
  if (!(pocketWidthMm > 0) || !(pocketHeightMm > 0)) {
    throw new TypeError('A pocket needs a positive width and height in millimetres.');
  }
  return {
    columns: cols,
    rows: rowCount,
    pocketWidthMm,
    pocketHeightMm,
    widthMm: cols * pocketWidthMm,
    heightMm: rowCount * pocketHeightMm,
  };
}

export function compositionOf(anchor, facing, spread) {
  const useFacing = spread && facing;
  const pages = [{ side: 'left', page: anchor, originX: 0, originY: 0 }];
  if (useFacing) {
    pages.push({ side: 'right', page: facing, originX: anchor.widthMm, originY: 0 });
  }
  return {
    spread: !!useFacing,
    widthMm: useFacing ? anchor.widthMm + facing.widthMm : anchor.widthMm,
    heightMm: useFacing ? Math.max(anchor.heightMm, facing.heightMm) : anchor.heightMm,
    pages,
  };
}

export function pocketRect(composition, side, row, col) {
  const placed = composition.pages.find(page => page.side === side);
  if (!placed) return null;
  const { page, originX, originY } = placed;
  if (row < 0 || col < 0 || row >= page.rows || col >= page.columns) return null;
  return {
    side,
    row,
    col,
    x: originX + col * page.pocketWidthMm,
    y: originY + row * page.pocketHeightMm,
    widthMm: page.pocketWidthMm,
    heightMm: page.pocketHeightMm,
  };
}

function rotate(x, y, deg) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: x * c - y * s, y: x * s + y * c };
}

export function imageHeightMm(image, transform) {
  if (!(image.aspect > 0) || !(transform.widthMm > 0)) {
    throw new TypeError('Artwork scale keeps the picture\'s own aspect.');
  }
  return transform.widthMm / image.aspect;
}

export function pagePointToImageUv(point, image, transform) {
  const heightMm = imageHeightMm(image, transform);
  const local = rotate(point.x - transform.xMm, point.y - transform.yMm, -(transform.rotationDeg || 0));
  return {
    u: local.x / transform.widthMm + 0.5,
    v: local.y / heightMm + 0.5,
  };
}

export function coverWidthMm(composition, aspect) {
  if (!(aspect > 0)) throw new TypeError('Artwork needs its own aspect ratio.');
  return Math.max(composition.widthMm, composition.heightMm * aspect);
}

// Pockets listed in the mask show artwork. Everything else stays a card pocket.
export function artworkSlices({ composition, image, transform, mask }) {
  const slices = [];
  for (const entry of mask || []) {
    const pocket = pocketRect(composition, entry.side || 'left', entry.row, entry.col);
    if (!pocket) continue;
    const corners = [
      { x: pocket.x, y: pocket.y },
      { x: pocket.x + pocket.widthMm, y: pocket.y },
      { x: pocket.x + pocket.widthMm, y: pocket.y + pocket.heightMm },
      { x: pocket.x, y: pocket.y + pocket.heightMm },
    ].map(point => pagePointToImageUv(point, image, transform));
    slices.push({ ...pocket, corners });
  }
  return slices;
}

// A layout change keeps millimetre placement and drops pockets that no longer exist.
export function remapMask(mask, composition) {
  return (mask || []).filter(entry => pocketRect(composition, entry.side || 'left', entry.row, entry.col));
}

function cutGuides(tile, markMm) {
  const { x, y, widthMm: w, heightMm: h } = tile;
  const m = markMm;
  return [
    { x1: x - m, y1: y, x2: x, y2: y },
    { x1: x, y1: y - m, x2: x, y2: y },
    { x1: x + w, y1: y, x2: x + w + m, y2: y },
    { x1: x + w, y1: y - m, x2: x + w, y2: y },
    { x1: x - m, y1: y + h, x2: x, y2: y + h },
    { x1: x, y1: y + h, x2: x, y2: y + h + m },
    { x1: x + w, y1: y + h, x2: x + w + m, y2: y + h },
    { x1: x + w, y1: y + h, x2: x + w, y2: y + h + m },
  ];
}

// Inserts stay at pocket size. A pocket that cannot sit on the sheet at 100%
// is reported and left off the page, rather than scaled down.
export function packInserts({ slices, paper, marginMm = 10, gapMm = 6, markerMm = CALIBRATION_MM, markerBandMm = 14, guideMm = 3 }) {
  const innerW = paper.widthMm - marginMm * 2;
  const usableH = paper.heightMm - marginMm * 2 - markerBandMm;
  const sheets = [];
  const rejected = [];
  let sheet = null;
  let x = 0;
  let y = 0;
  let rowH = 0;

  const open = () => {
    sheet = {
      paper: paper.id,
      widthMm: paper.widthMm,
      heightMm: paper.heightMm,
      marginMm,
      markerMm: Math.min(markerMm, innerW),
      markerX: marginMm,
      markerY: paper.heightMm - marginMm - 2,
      tiles: [],
    };
    sheets.push(sheet);
    x = 0;
    y = 0;
    rowH = 0;
  };

  for (const slice of slices) {
    if (slice.widthMm > innerW || slice.heightMm > usableH) {
      rejected.push(slice);
      continue;
    }
    if (!sheet) open();
    if (x > 0 && x + slice.widthMm > innerW) {
      y += rowH + gapMm;
      x = 0;
      rowH = 0;
    }
    if (y + slice.heightMm > usableH) {
      open();
    }
    const tile = { ...slice, x: marginMm + x, y: marginMm + y };
    tile.guides = cutGuides(tile, guideMm);
    sheet.tiles.push(tile);
    x += slice.widthMm + gapMm;
    rowH = Math.max(rowH, slice.heightMm);
  }

  return { sheets, rejected };
}
