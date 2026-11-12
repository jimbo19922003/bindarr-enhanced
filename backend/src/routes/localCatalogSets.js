'use strict';
const express = require('express');
const {createPokemonLocalCatalog} = require('../utils/pokemonLocalCatalog');
const {createPokemonLocalSetSync} = require('../utils/pokemonLocalSetSync');
const {createReleaseFirstSetSource} = require('../utils/pokemonReleaseSetSource');
const {createRepositoryCatalogueSource} = require('../utils/repositoryCatalogueSource');

function createLocalCatalogSetsRouter({connect, service, source = createReleaseFirstSetSource({
  release: createRepositoryCatalogueSource(),
  api: {
    listSets: language => require('../tcgdexApi').listPhysicalSets(language),
    fetchSetSnapshot: (...args) => require('../tcgdexApi').fetchSetSnapshot(...args),
  },
})}) {
  const store = createPokemonLocalCatalog({connect});
  const sync = service || createPokemonLocalSetSync({store, source});
  const router = express.Router();
  router.use(express.json({limit: '8kb'}));
  router.get('/', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      if (req.query.lang !== undefined && typeof req.query.lang !== 'string') {
        return res.status(400).json({error: 'Specify exactly one catalog language'});
      }
      const language = req.query.lang || 'en';
      return res.json({sets: await sync.listSets(language), ...sync.status()});
    } catch (error) {
      return res.status(error.status || 503).json({error: error.status ? error.message : 'TCGdex set list is unavailable'});
    }
  });
  router.get('/job', (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    return res.json(sync.status());
  });
  router.post('/', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      return res.status(202).json(sync.start(req.body));
    } catch (error) {
      return res.status(error.status || 503).json({error: error.status ? error.message : 'Pokémon set sync could not start'});
    }
  });
  return router;
}

module.exports = {createLocalCatalogSetsRouter};
