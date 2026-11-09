'use strict';

async function isPokemonLocalModeEnabled() {
  const row = await require('../db').get(
    'SELECT pokemon_local_catalog_enabled FROM app_settings WHERE id = 1'
  );
  if (!row) throw new Error('Pokémon catalogue mode setting is unavailable');
  return row.pokemon_local_catalog_enabled === 1;
}

module.exports = {isPokemonLocalModeEnabled};
