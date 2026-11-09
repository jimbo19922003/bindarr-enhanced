'use strict';

const { foldName } = require('./pokewalletMatch');

const aliases = {
  '30th': ['30th Celebration', '30c', '30th Celebration'],
  '30th-c': ['30th Classic Collection', '30ccc', '30th Classic Collection'],
  'swsh4.5sv': ['Shining Fates Shiny Vault', 'swsh4.5', 'Shining Fates'],
  swsh9tg: ['Brilliant Stars Trainer Gallery', 'swsh9', 'Brilliant Stars'],
  swsh10tg: ['Astral Radiance Trainer Gallery', 'swsh10', 'Astral Radiance'],
  swsh11tg: ['Lost Origin Trainer Gallery', 'swsh11', 'Lost Origin'],
  swsh12tg: ['Silver Tempest Trainer Gallery', 'swsh12', 'Silver Tempest'],
  'swsh12.5gg': ['Crown Zenith Galarian Gallery', 'swsh12.5', 'Crown Zenith'],
  sma: ['Hidden Fates Shiny Vault', 'sma', 'Yellow A Alternate'],
  '2011bw': ["McDonald's Collection 2011", '2011bw', "Macdonald's Collection 2011"],
  '2012bw': ["McDonald's Collection 2012", '2012bw', "Macdonald's Collection 2012"],
  '2014xy': ["McDonald's Collection 2014", '2014xy', "Macdonald's Collection 2014"],
  '2015xy': ["McDonald's Collection 2015", '2015xy', "Macdonald's Collection 2015"],
  '2016xy': ["McDonald's Collection 2016", '2016xy', "Macdonald's Collection 2016"],
  '2017sm': ["McDonald's Collection 2017", '2017sm', "Macdonald's Collection 2017"],
  '2018sm': ["McDonald's Collection 2018", '2018sm', "Macdonald's Collection 2018"],
  '2019sm': ["McDonald's Collection 2019", '2019sm', "Macdonald's Collection 2019"],
  '2021swsh': ["McDonald's Collection 2021", '2021swsh', "Macdonald's Collection 2021"],
};

function carddexSet(card) {
  const alias = card?.game === 'pokemon' && card.language === 'English'
    && Object.hasOwn(aliases, card.set_id) ? aliases[card.set_id] : null;
  if (alias && foldName(card.set_name) === foldName(alias[0])) {
    return { id: alias[1], name: alias[2] };
  }
  return { id: card?.set_id, name: card?.set_name };
}

function carddexSetId(card) {
  return carddexSet(card).id;
}

function matchesCarddexSet(card, row) {
  const expected = carddexSet(card);
  return !!foldName(expected.name) && row?.set_id === expected.id
    && foldName(row.set_name) === foldName(expected.name);
}

module.exports = { carddexSetId, matchesCarddexSet };
