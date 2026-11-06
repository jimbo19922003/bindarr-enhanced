import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAPERS, POCKET_PRESETS, CALIBRATION_MM, pageGeometry, compositionOf,
  coverWidthMm, artworkSlices, remapMask, packInserts, pagePointToImageUv,
} from './michiGeometry.js';

function ninePocket() {
  return pageGeometry({ columns: 3, rows: 3, pocket: POCKET_PRESETS.card });
}

function covered(page) {
  const composition = compositionOf(page, null, false);
  const aspect = page.widthMm / page.heightMm;
  const transform = {
    xMm: composition.widthMm / 2,
    yMm: composition.heightMm / 2,
    widthMm: coverWidthMm(composition, aspect),
    rotationDeg: 0,
  };
  return { composition, aspect, transform, image: { aspect } };
}

test('one picture across a nine-pocket page prints only the artwork pockets', () => {
  const page = ninePocket();
  const { composition, image, transform } = covered(page);
  const mask = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (row === 1 && col === 1) continue;
      mask.push({ side: 'left', row, col });
    }
  }
  const slices = artworkSlices({ composition, image, transform, mask });
  assert.equal(slices.length, 8);
  assert.equal(slices.some(slice => slice.row === 1 && slice.col === 1), false);
  for (const slice of slices) {
    assert.equal(slice.widthMm, 63);
    assert.equal(slice.heightMm, 88);
  }

  const corner = slices.find(slice => slice.row === 0 && slice.col === 0);
  const [topLeft, topRight, bottomRight] = corner.corners;
  assert.ok(Math.abs(topLeft.u) < 1e-9);
  assert.ok(Math.abs(topLeft.v) < 1e-9);
  const sourceW = (topRight.u - topLeft.u) * transform.widthMm;
  const sourceH = (bottomRight.v - topRight.v) * (transform.widthMm / image.aspect);
  assert.ok(Math.abs(sourceW - 63) < 1e-9);
  assert.ok(Math.abs(sourceH - 88) < 1e-9);
  assert.ok(Math.abs((sourceW / sourceH) - (63 / 88)) < 1e-9);

  const packed = packInserts({ slices, paper: PAPERS.a4 });
  assert.equal(packed.rejected.length, 0);
  const tiles = packed.sheets.flatMap(sheet => sheet.tiles);
  assert.equal(tiles.length, 8);
  assert.ok(packed.sheets.length >= 2);
  for (const tile of tiles) {
    assert.equal(tile.widthMm, 63);
    assert.equal(tile.heightMm, 88);
    assert.equal(tile.guides.length, 8);
  }
  for (const sheet of packed.sheets) {
    assert.equal(sheet.markerMm, CALIBRATION_MM);
    assert.ok(sheet.markerX + sheet.markerMm <= sheet.widthMm);
  }
});

test('letter sheets keep the same actual pocket size', () => {
  const page = ninePocket();
  const { composition, image, transform } = covered(page);
  const mask = [{ side: 'left', row: 0, col: 0 }];
  const slices = artworkSlices({ composition, image, transform, mask });
  const packed = packInserts({ slices, paper: PAPERS.letter });
  assert.equal(packed.sheets[0].tiles[0].widthMm, POCKET_PRESETS.card.widthMm);
  assert.equal(packed.sheets[0].tiles[0].heightMm, POCKET_PRESETS.card.heightMm);
  assert.equal(packed.sheets[0].paper, 'letter');
});

test('a pocket larger than the sheet is left off rather than scaled', () => {
  const packed = packInserts({
    slices: [{ widthMm: 400, heightMm: 400, row: 0, col: 0 }],
    paper: PAPERS.a4,
  });
  assert.equal(packed.sheets.length, 0);
  assert.equal(packed.rejected.length, 1);
});

test('rotation moves a point around the picture without a second scale', () => {
  const image = { aspect: 2 };
  const transform = { xMm: 0, yMm: 0, widthMm: 100, rotationDeg: 90 };
  const uv = pagePointToImageUv({ x: 10, y: 0 }, image, transform);
  const flat = pagePointToImageUv({ x: 10, y: 0 }, image, { ...transform, rotationDeg: 0 });
  assert.ok(Math.abs(flat.u - 0.6) < 1e-9);
  assert.ok(Math.abs(uv.u - flat.u) > 0.05);
  assert.equal(transform.widthMm / image.aspect, 50);
});

test('a smaller page drops pockets that no longer exist and leaves the scale alone', () => {
  const before = pageGeometry({ columns: 3, rows: 3, pocket: POCKET_PRESETS.card });
  const after = pageGeometry({ columns: 2, rows: 2, pocket: POCKET_PRESETS.card });
  const mask = [
    { side: 'left', row: 0, col: 0 },
    { side: 'left', row: 2, col: 2 },
  ];
  const kept = remapMask(mask, compositionOf(after, null, false));
  assert.deepEqual(kept, [{ side: 'left', row: 0, col: 0 }]);
  assert.equal(before.pocketWidthMm, after.pocketWidthMm);
  assert.notEqual(before.widthMm, after.widthMm);
});

test('a spread is two pages side by side and a card pocket on either page stays out of the print', () => {
  const left = pageGeometry({ columns: 3, rows: 3, pocket: POCKET_PRESETS.card });
  const right = pageGeometry({ columns: 3, rows: 3, pocket: POCKET_PRESETS.card });
  const composition = compositionOf(left, right, true);
  assert.equal(composition.widthMm, left.widthMm * 2);
  const image = { aspect: composition.widthMm / composition.heightMm };
  const transform = {
    xMm: composition.widthMm / 2,
    yMm: composition.heightMm / 2,
    widthMm: coverWidthMm(composition, image.aspect),
    rotationDeg: 0,
  };
  const mask = [
    { side: 'left', row: 0, col: 0 },
    { side: 'right', row: 0, col: 2 },
  ];
  const slices = artworkSlices({ composition, image, transform, mask });
  assert.equal(slices.length, 2);
  assert.ok(slices[1].x > left.widthMm);
});
