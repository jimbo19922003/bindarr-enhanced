'use strict';
const express = require('express');
const {LANGUAGES} = require('../utils/languages');
const {resolveLanguage} = require('./localPokemonSets');
function createLocalCatalogStatusRouter({connect, modeEnabled = () => process.env.POKEMON_LOCAL_CATALOG === '1'}) {
  const router = express.Router();
  router.use((req, res, next) => req.user?.role === 'admin' ? next() : res.status(req.user ? 403 : 401).json({error: 'Administrator access required'}));
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
      const installedLanguages = installed ? await db.all('SELECT language FROM pokemon_catalog_active ORDER BY language') : [];
      const rows = active ? await db.all("SELECT s.id,s.payload_json,COUNT(pc.id) AS metadataCards,SUM(CASE WHEN cc.id IS NOT NULL THEN 1 ELSE 0 END) AS cachedRows,SUM(CASE WHEN cc.id IS NOT NULL AND NULLIF(TRIM(cc.image_url),'') IS NOT NULL THEN 1 ELSE 0 END) AS artworkReferences,SUM(CASE WHEN cc.id IS NOT NULL AND NULLIF(TRIM(cc.image_url),'') IS NULL THEN 1 ELSE 0 END) AS missingReferences,SUM(CASE WHEN pc.id IS NOT NULL AND cc.id IS NULL THEN 1 ELSE 0 END) AS missingCacheRows FROM pokemon_catalog_set s LEFT JOIN pokemon_catalog_card pc ON pc.snapshot_id=s.snapshot_id AND pc.set_id=s.id LEFT JOIN card_cache cc ON cc.id=pc.id WHERE s.snapshot_id=? GROUP BY s.id,s.payload_json ORDER BY s.id", [active.id]) : [];
      const sets = rows.map(row => { const set = JSON.parse(row.payload_json); return {id: row.id, name: set.name, printedTotal: set.printed_total ?? null, metadataCards: row.metadataCards, cachedRows: row.cachedRows, artworkReferences: row.artworkReferences, missingReferences: row.missingReferences, missingCacheRows: row.missingCacheRows}; });
      const summary = active ? sets.reduce((sum, set) => { for (const key of ['metadataCards','cachedRows','artworkReferences','missingReferences','missingCacheRows']) sum[key] += set[key]; return sum; }, {metadataCards:0,cachedRows:0,artworkReferences:0,missingReferences:0,missingCacheRows:0}) : null;
      const availableLanguages = installedLanguages.flatMap(row => { const entry = LANGUAGES.find(l => l.code === row.language); return entry ? [{code:entry.code,name:entry.name}] : []; });
      await db.run('COMMIT'); began = false;
      return res.json({language,defaultLanguage:'en',localModeEnabled:!!modeEnabled(),availableLanguages,snapshot:active?{commit:active.source_commit,importedAt:active.imported_at,cardCount:active.card_count,setCount:active.set_count,scanRefreshRequired:!!active.scan_refresh_required}:null,summary,sets,artwork:{downloadsVerified:false,bytesCached:null},scanner:{readiness:'not_verified'}});
    } catch (error) {
      if (began) await db.run('ROLLBACK').catch(() => {});
      console.error('Local catalog status failed:', error.message);
      return res.status(503).json({error:'Local catalog status is unavailable'});
    } finally { if (db) await db.close().catch(() => {}); }
  });
  return router;
}
module.exports = {createLocalCatalogStatusRouter};
