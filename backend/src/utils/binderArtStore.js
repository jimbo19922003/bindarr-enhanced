'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_EDGE = 12000;
const FORMATS = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function artRoot() {
  if (process.env.BINDER_ART_DIR) return process.env.BINDER_ART_DIR;
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../database/bindarr.db');
  return path.join(path.dirname(dbPath), 'binder-art');
}

function fileFor(userId, artworkId) {
  const user = String(Number(userId));
  const id = String(Number(artworkId));
  if (!/^\d+$/.test(user) || !/^\d+$/.test(id)) throw new TypeError('Artwork not found');
  return path.join(artRoot(), user, id);
}

async function inspect(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) {
    const err = new TypeError('Upload a JPEG, PNG or WebP image.');
    err.status = 400;
    throw err;
  }
  if (buffer.length > MAX_BYTES) {
    const err = new TypeError('That image is over 12 MB.');
    err.status = 400;
    throw err;
  }
  let meta;
  try {
    meta = await sharp(buffer, { failOn: 'error', limitInputPixels: MAX_EDGE * MAX_EDGE }).metadata();
  } catch {
    const err = new TypeError('That file is not a readable image.');
    err.status = 400;
    throw err;
  }
  const mime = FORMATS[meta.format];
  if (!mime || !meta.width || !meta.height || meta.width > MAX_EDGE || meta.height > MAX_EDGE) {
    const err = new TypeError('Upload a JPEG, PNG or WebP image.');
    err.status = 400;
    throw err;
  }
  return { mime, width: meta.width, height: meta.height, bytes: buffer.length };
}

function writeFile(userId, artworkId, buffer) {
  const file = fileFor(userId, artworkId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
}

function readFile(userId, artworkId) {
  const file = fileFor(userId, artworkId);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

function removeFile(userId, artworkId) {
  const file = fileFor(userId, artworkId);
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

module.exports = { inspect, writeFile, readFile, removeFile, artRoot };
