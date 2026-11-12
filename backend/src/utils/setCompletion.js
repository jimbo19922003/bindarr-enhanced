'use strict';

const { numberKey } = require('./pokemonLocalCatalog');
const totalOf = value => Number.isSafeInteger(value) && value > 0 ? value : null;
const progress = (ownedUnique, totalCards) => totalCards == null ? null : ({
  ownedUnique, totalCards, percent: Math.min(Math.round(ownedUnique / totalCards * 100), 100),
});

function completionCounts(numbers, metadata, game) {
  const keys = [...new Set(numbers.filter(value => value != null).map(numberKey).filter(Boolean))];
  const baseTotal = totalOf(metadata.printed_total);
  const fullTotal = totalOf(metadata.total);
  const baseOwned = game === 'mtg' ? keys.length : keys.filter(key => /^\d+$/.test(key) && Number(key) >= 1 && Number(key) <= baseTotal).length;
  return {
    base: progress(baseOwned, baseTotal),
    full: progress(keys.length, fullTotal),
  };
}

async function readSetCompletion(db, userId, game) {
  const rows = await db.all(`SELECT DISTINCT cc.game, cc.set_id, cc.set_name, cc.number, s.printed_total, s.total
    FROM collection c JOIN card_cache cc ON cc.id = c.card_id
    LEFT JOIN sets s ON s.id = cc.set_id AND s.game = cc.game
    WHERE c.user_id = ? AND c.list_type = 'collection'${game ? ' AND cc.game = ?' : ''}
    ORDER BY cc.game, cc.set_id, cc.set_name`, game ? [userId, game] : [userId]);
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.game, row.set_id]);
    let group = groups.get(key);
    if (!group) {
      group = { game: row.game, id: row.set_id, name: row.set_name, metadata: row, numbers: [] };
      groups.set(key, group);
    }
    group.numbers.push(row.number);
  }
  // Local snapshots are language-specific and may contain sets absent from the
  // legacy English table. Prefer English when available, otherwise a local set
  // only fills a missing global record; never mix different language totals.
  if ((!game || game === 'pokemon') && await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pokemon_catalog_active'")) {
    const localSets = await db.all(`SELECT a.language, s.id, s.payload_json, COUNT(DISTINCT NULLIF(c.number_key, '')) AS total
      FROM pokemon_catalog_active a JOIN pokemon_catalog_set s ON s.snapshot_id = a.snapshot_id
      LEFT JOIN pokemon_catalog_card c ON c.snapshot_id = s.snapshot_id AND c.set_id = s.id
      WHERE EXISTS (SELECT 1 FROM collection owned JOIN card_cache cc ON cc.id = owned.card_id
        WHERE owned.user_id = ? AND owned.list_type = 'collection' AND cc.game = 'pokemon' AND cc.set_id = s.id)
      GROUP BY a.language, s.id, s.payload_json
      ORDER BY CASE WHEN a.language = 'en' THEN 0 ELSE 1 END, a.language`, [userId]);
    const applied = new Set();
    for (const row of localSets) {
      const key = JSON.stringify(['pokemon', row.id]), group = groups.get(key);
      if (!group || applied.has(key)) continue;
      if (row.language === 'en' || (!totalOf(group.metadata.printed_total) && !totalOf(group.metadata.total))) {
        const metadata = JSON.parse(row.payload_json);
        group.metadata = {
          printed_total: metadata.printed_total,
          total: totalOf(metadata.total) || (row.total >= metadata.printed_total ? row.total : null),
        };
        applied.add(key);
      }
    }
  }
  return [...groups.values()].map(group => {
    const counts = completionCounts(group.numbers, group.metadata, group.game);
    const selected = counts.base || counts.full;
    return {
      setId: group.id, setGame: group.game, setName: group.name || 'Unknown set',
      ...(selected || { ownedUnique: null, totalCards: null, percent: null }), ...counts,
    };
  });
}

module.exports = { completionCounts, readSetCompletion };
