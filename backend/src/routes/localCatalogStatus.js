// catalogue-setup-installed-v1
'use strict';
const express = require('express');
const {LANGUAGES} = require('../utils/languages');
const {resolveLanguage} = require('./localPokemonSets');
function createLocalCatalogStatusRouter({connect, modeEnabled = require('../utils/pokemonLocalMode').isPokemonLocalModeEnabled, art = require('../cardArt')}) {
  const router = express.Router();
  router.use((req, res, next) => req.user?.role === 'admin' ? next() : res.status(req.user ? 403 : 401).json({error: 'Administrator access required'}));
  router.use(express.json({limit: '8kb'}));
  router.use('/install', require('./localCatalogInstall').createLocalCatalogInstallRouter({connect}));
  router.use('/setup', require('./catalogueSetup').createRouter({connect}));
  router.use('/sets', require('./localCatalogSets').createLocalCatalogSetsRouter({connect}));
  router.get('/missing-artwork', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const language = resolveLanguage(req.query.lang);
    const setId = req.query.set;
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!language || typeof setId !== 'string' || !setId.trim() || setId.length > 200 ||
        !Number.isSafeInteger(page) || page < 1 || page > 10000) {
      return res.status(400).json({error: 'A valid language, set, and page are required'});
    }
    let db;
    try {
      db = await connect();
      const installed = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='pokemon_catalog_active'");
      if (!installed) return res.json({cards: [], total: 0, page});
      const rows = await db.all(`SELECT cc.id, cc.name, cc.printed_name, cc.set_id, cc.set_name, cc.number, cc.language, cc.game, cc.image_url
        FROM pokemon_catalog_active a JOIN pokemon_catalog_card pc ON pc.snapshot_id=a.snapshot_id
        JOIN card_cache cc ON cc.id=pc.id WHERE a.language=? AND pc.set_id=? AND NULLIF(TRIM(cc.image_url),'') IS NULL ORDER BY cc.id`, [language, setId]);
      const local = new Set(art.listIds());
      const missing = rows.filter(row => !local.has(row.id));
      return res.json({cards: missing.slice((page - 1) * 50, page * 50), total: missing.length, page});
    } catch (error) {
      console.error('Local catalogue missing artwork lookup failed:', error.message);
      return res.status(503).json({error: 'Missing artwork list is unavailable'});
    } finally { if (db) await db.close().catch(() => {}); }
  });
  router.put('/mode', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (typeof req.body?.enabled !== 'boolean' || Object.keys(req.body).some(key => key !== 'enabled')) {
      return res.status(400).json({error: 'enabled must be a boolean'});
    }
    let db;
    try {
      db = await connect();
      await db.run('UPDATE app_settings SET pokemon_local_catalog_enabled=? WHERE id=1', [req.body.enabled ? 1 : 0]);
      return res.json({localModeEnabled: req.body.enabled});
    } catch (error) {
      console.error('Pokémon catalogue mode update failed:', error.message);
      return res.status(503).json({error: 'Pokémon catalogue mode could not be updated'});
    } finally { if (db) await db.close().catch(() => {}); }
  });
  router.get('/', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const language = resolveLanguage(req.query.lang);
    if (!language) return res.status(400).json({error: 'Unsupported catalog language'});
    let db, began = false;
    try {
      db = await connect();
      await db.run('BEGIN'); began = true;
      const installed = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='pokemon_catalog_active'");
      const active = installed ? await db.get('SELECT s.*, a.scan_refresh_required FROM pokemon_catalog_active a JOIN pokemon_catalog_snapshot s ON s.id=a.snapshot_id WHERE a.language=?', [language]) : null;
      const rows = active ? await db.all("SELECT s.id,s.payload_json,COUNT(pc.id) AS metadataCards,SUM(CASE WHEN cc.id IS NOT NULL THEN 1 ELSE 0 END) AS cachedRows,SUM(CASE WHEN cc.id IS NOT NULL AND NULLIF(TRIM(cc.image_url),'') IS NOT NULL THEN 1 ELSE 0 END) AS artworkReferences,SUM(CASE WHEN cc.id IS NOT NULL AND NULLIF(TRIM(cc.image_url),'') IS NULL THEN 1 ELSE 0 END) AS missingReferences,SUM(CASE WHEN pc.id IS NOT NULL AND cc.id IS NULL THEN 1 ELSE 0 END) AS missingCacheRows FROM pokemon_catalog_set s LEFT JOIN pokemon_catalog_card pc ON pc.snapshot_id=s.snapshot_id AND pc.set_id=s.id LEFT JOIN card_cache cc ON cc.id=pc.id WHERE s.snapshot_id=? GROUP BY s.id,s.payload_json ORDER BY s.id", [active.id]) : [];
      const sets = rows.map(row => { const set = JSON.parse(row.payload_json); return {id: row.id, name: set.name, printedTotal: set.printed_total ?? null, metadataCards: row.metadataCards, cachedRows: row.cachedRows, artworkReferences: row.artworkReferences, missingReferences: row.missingReferences, missingCacheRows: row.missingCacheRows}; });
      if (active) {
        const artIds = new Set(art.listIds());
        const missing = await db.all("SELECT pc.set_id,cc.id FROM pokemon_catalog_card pc JOIN card_cache cc ON cc.id=pc.id WHERE pc.snapshot_id=? AND NULLIF(TRIM(cc.image_url),'') IS NULL", [active.id]);
        const localBySet = new Map();
        for (const card of missing) if (artIds.has(card.id)) localBySet.set(card.set_id, (localBySet.get(card.set_id) || 0) + 1);
        for (const set of sets) {
          set.localArtworkWithoutReference = localBySet.get(set.id) || 0;
          set.missingArtwork = set.missingReferences - set.localArtworkWithoutReference;
        }
      }
      const summary = active ? sets.reduce((sum, set) => { for (const key of ['metadataCards','cachedRows','artworkReferences','missingReferences','missingCacheRows','localArtworkWithoutReference','missingArtwork']) sum[key] += set[key]; return sum; }, {metadataCards:0,cachedRows:0,artworkReferences:0,missingReferences:0,missingCacheRows:0,localArtworkWithoutReference:0,missingArtwork:0}) : null;
      const availableLanguages = LANGUAGES.map(({code,name}) => ({code,name}));
      const localModeEnabled = await modeEnabled();
      await db.run('COMMIT'); began = false;
      return res.json({language,defaultLanguage:'en',localModeEnabled,availableLanguages,snapshot:active?{commit:active.source_commit,importedAt:active.imported_at,cardCount:active.card_count,setCount:active.set_count,scanRefreshRequired:!!active.scan_refresh_required}:null,summary,sets,artwork:{downloadsVerified:false,bytesCached:null},scanner:{readiness:'not_verified'}});
    } catch (error) {
      if (began) await db.run('ROLLBACK').catch(() => {});
      console.error('Local catalog status failed:', error.message);
      return res.status(503).json({error:'Local catalog status is unavailable'});
    } finally { if (db) await db.close().catch(() => {}); }
  });
  return router;
}
module.exports = {createLocalCatalogStatusRouter};
