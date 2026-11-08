const express = require('express');
const db = require('../db');
const languages = require('../utils/languages');
const router = express.Router();

// Mounted behind server.js's authentication gate. Public FX data only.
router.get('/exchange-rates', async (_req, res) => {
  try {
    const fx = require('../utils/currencyConversion');
    const codes = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];
    const entries = await Promise.all(codes.map(async code => {
      const result = await fx.convertCents(100, 'USD', code);
      return [code, result.rate == null ? null : {
        rate: result.rate, rateDates: result.rateDates, fetchedAt: result.fetchedAt || null,
        stale: result.stale, source: result.source,
      }];
    }));
    res.set('Cache-Control', 'private, no-store');
    res.json({ base: 'USD', quotes: Object.fromEntries(entries.filter(([, quote]) => quote)),
      unavailable: entries.filter(([, quote]) => !quote).map(([code]) => code) });
  } catch { res.status(503).json({ error: 'Exchange rates are unavailable' }); }
});

router.get('/', async (req, res) => {
  try {
    const { game, lang } = req.query;
    if (game === 'pokemon' && await require('../utils/pokemonProvider').providerFor(lang) === 'pokemontcgapi') {
      return res.json(await require('../pokemontcgapi').listSets(lang));
    }
    if (game === 'pokemon' && !languages.isEnglish(lang)) {
      try { return res.json(await require('../tcgdexApi').listSets(lang)); }
      catch (err) {
        console.error(`Failed to fetch ${lang} Pokémon sets from TCGdex:`, err.message);
        return res.json([]);
      }
    }
    const where = game ? `WHERE game = ?` : '';
    const params = game ? [game] : [];
    const sets = await db.all(`
      SELECT id, name, series, printed_total, total, release_date, ptcgo_code, symbol_url, logo_url, game
      FROM sets ${where} ORDER BY release_date ASC
    `, params);
    if (req.query.tree === '1' && game === 'mtg') {
      const { getMtgChildSetMap } = require('../cardSets');
      const childMap = await getMtgChildSetMap();
      const childCodes = new Set([...childMap.values()].flatMap(cs => cs.map(c => c.code)));
      const code = s => s.ptcgo_code || String(s.id || '').replace(/^mtg-/, '');
      return res.json(sets.filter(s => !childCodes.has(code(s))).map(s => ({
        ...s, children: childMap.get(code(s).toLowerCase().replace(/[^a-z0-9]/g, '')) || [],
      })));
    }
    res.json(sets);
  } catch (error) {
    console.error('Error fetching sets:', error);
    res.status(500).json({ error: 'Failed to retrieve sets' });
  }
});

module.exports = router;
