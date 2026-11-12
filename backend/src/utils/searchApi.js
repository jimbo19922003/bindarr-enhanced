// The provider a card search goes to for a game and language. Shared by the
// search route and custom-set syncing so both follow the same Pokémon decision
// (local catalogue mode first, then pokemonProvider).
const scryfallApi = require('../scryfallApi');
const lorcastApi = require('../lorcastApi');
const pokemonProvider = require('./pokemonProvider');

async function pokemonApiFor(lang) {
  if (await require('./pokemonLocalMode').isPokemonLocalModeEnabled()) return require('./localPokemonSearch').getLocalPokemonSearch();
  return pokemonProvider.apiFor(lang);
}

async function searchApiFor(game, lang) {
  if (game === 'mtg') return scryfallApi;
  if (game === 'lorcana') return lorcastApi;
  return pokemonApiFor(lang);
}

module.exports = { pokemonApiFor, searchApiFor };
