'use strict';

const express = require('express');
const db = require('../db');
const store = require('../utils/binderArtStore');

const router = express.Router();

function fail(res, status, error) {
  return res.status(status).json({ error });
}

function parseMask(value) {
  if (!Array.isArray(value) || value.length > 288) throw new TypeError('Choose the pockets that show the artwork.');
  return value.map(entry => {
    const row = Number(entry && entry.row);
    const col = Number(entry && entry.col);
    const side = entry && entry.side === 'right' ? 'right' : 'left';
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row > 23 || col > 23) {
      throw new TypeError('A pocket on the artwork is out of range.');
    }
    return { side, row, col };
  });
}

function presentLayer(row) {
  let mask = [];
  try { mask = JSON.parse(row.mask || '[]'); } catch { mask = []; }
  return {
    id: row.id,
    location_id: row.location_id,
    compartment_id: row.compartment_id,
    artwork_id: row.artwork_id,
    x_mm: row.x_mm,
    y_mm: row.y_mm,
    width_mm: row.width_mm,
    rotation_deg: row.rotation_deg,
    spread: row.spread === 1,
    mask,
    width: row.width,
    height: row.height,
  };
}

router.get('/binder-art', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, mime, width, height, bytes, created_at FROM binder_artwork WHERE user_id = ? ORDER BY id DESC`,
      [req.user.id]
    );
    res.json({ artworks: rows });
  } catch (err) {
    console.error('Failed to list binder artwork', err);
    fail(res, 500, 'Could not list artwork.');
  }
});

router.post('/binder-art', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '12mb' }), async (req, res) => {
  try {
    const info = await store.inspect(req.body);
    const inserted = await db.run(
      `INSERT INTO binder_artwork (user_id, mime, width, height, bytes) VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, info.mime, info.width, info.height, info.bytes]
    );
    try {
      store.writeFile(req.user.id, inserted.lastID, req.body);
    } catch (err) {
      await db.run(`DELETE FROM binder_artwork WHERE id = ? AND user_id = ?`, [inserted.lastID, req.user.id]);
      throw err;
    }
    res.status(201).json({ artwork: { id: inserted.lastID, ...info } });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('Failed to store binder artwork', err);
    fail(res, status, status >= 500 ? 'Could not store that image.' : err.message);
  }
});

router.get('/binder-art/:id/image', async (req, res) => {
  try {
    const row = await db.get(
      `SELECT id, mime FROM binder_artwork WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!row) return fail(res, 404, 'Artwork not found');
    const bytes = store.readFile(req.user.id, row.id);
    if (!bytes) return fail(res, 404, 'Artwork not found');
    res.set('Content-Type', row.mime);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(bytes);
  } catch (err) {
    console.error('Failed to read binder artwork', err);
    fail(res, 500, 'Could not read that image.');
  }
});

router.delete('/binder-art/:id', async (req, res) => {
  try {
    const row = await db.get(
      `SELECT id FROM binder_artwork WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!row) return fail(res, 404, 'Artwork not found');
    await db.run(`DELETE FROM binder_artwork WHERE id = ? AND user_id = ?`, [row.id, req.user.id]);
    store.removeFile(req.user.id, row.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete binder artwork', err);
    fail(res, 500, 'Could not delete that image.');
  }
});

router.get('/locations/:id/binder-art', async (req, res) => {
  try {
    const location = await db.get(`SELECT id FROM locations WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    if (!location) return fail(res, 404, 'Container not found');
    const rows = await db.all(
      `SELECT layer.*, art.width, art.height
         FROM binder_art_layer layer
         JOIN binder_artwork art ON art.id = layer.artwork_id AND art.user_id = layer.user_id
        WHERE layer.location_id = ? AND layer.user_id = ?`,
      [location.id, req.user.id]
    );
    res.json({ layers: rows.map(presentLayer) });
  } catch (err) {
    console.error('Failed to read binder artwork layers', err);
    fail(res, 500, 'Could not read the artwork on this binder.');
  }
});

router.put('/locations/:id/compartments/:compartmentId/binder-art', async (req, res) => {
  try {
    const location = await db.get(`SELECT id FROM locations WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    if (!location) return fail(res, 404, 'Container not found');
    const compartment = await db.get(
      `SELECT id FROM compartments WHERE id = ? AND location_id = ?`,
      [req.params.compartmentId, location.id]
    );
    if (!compartment) return fail(res, 404, 'Page not found');
    const body = req.body || {};
    const artwork = await db.get(
      `SELECT id, width, height FROM binder_artwork WHERE id = ? AND user_id = ?`,
      [body.artwork_id, req.user.id]
    );
    if (!artwork) return fail(res, 400, 'Artwork not found');
    const x = Number(body.x_mm);
    const y = Number(body.y_mm);
    const width = Number(body.width_mm);
    const rotation = Number(body.rotation_deg || 0);
    if (![x, y, width, rotation].every(Number.isFinite) || !(width > 0) || width > 2000) {
      return fail(res, 400, 'Place the artwork with a position, one scale, and a rotation.');
    }
    const mask = parseMask(body.mask);
    const spread = body.spread ? 1 : 0;
    await db.run(
      `INSERT INTO binder_art_layer (
         user_id, location_id, compartment_id, artwork_id, x_mm, y_mm, width_mm, rotation_deg, mask, spread
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, compartment_id) DO UPDATE SET
         artwork_id = excluded.artwork_id,
         x_mm = excluded.x_mm,
         y_mm = excluded.y_mm,
         width_mm = excluded.width_mm,
         rotation_deg = excluded.rotation_deg,
         mask = excluded.mask,
         spread = excluded.spread,
         updated_at = datetime('now')`,
      [req.user.id, location.id, compartment.id, artwork.id, x, y, width, rotation, JSON.stringify(mask), spread]
    );
    const row = await db.all(
      `SELECT layer.*, art.width, art.height
         FROM binder_art_layer layer
         JOIN binder_artwork art ON art.id = layer.artwork_id
        WHERE layer.user_id = ? AND layer.compartment_id = ?`,
      [req.user.id, compartment.id]
    );
    res.json({ layer: presentLayer(row[0]) });
  } catch (err) {
    const status = err instanceof TypeError ? 400 : 500;
    if (status >= 500) console.error('Failed to save binder artwork', err);
    fail(res, status, status >= 500 ? 'Could not save that artwork.' : err.message);
  }
});

router.delete('/locations/:id/compartments/:compartmentId/binder-art', async (req, res) => {
  try {
    const result = await db.run(
      `DELETE FROM binder_art_layer
        WHERE user_id = ? AND location_id = ? AND compartment_id = ?`,
      [req.user.id, req.params.id, req.params.compartmentId]
    );
    if (!result.changes) return fail(res, 404, 'Artwork not found');
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to clear binder artwork', err);
    fail(res, 500, 'Could not clear that artwork.');
  }
});

module.exports = router;
