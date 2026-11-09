'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carddexSetId } = require('../src/utils/carddexSets');
const { chooseCarddexArtwork } = require('../src/utils/carddexArtwork');
const { providerId, extractCarddexQuote } = require('../src/utils/carddexPrices');

const cases = [
  ['30th', '30th Celebration', '30c', '30th Celebration', '037', 'Pikachu'],
  ['30th-c', '30th Classic Collection', '30ccc', '30th Classic Collection', '012', 'Raikou'],
  ['swsh4.5sv', 'Shining Fates Shiny Vault', 'swsh4.5', 'Shining Fates', 'SV001', 'Rowlet'],
  ['swsh9tg', 'Brilliant Stars Trainer Gallery', 'swsh9', 'Brilliant Stars', 'TG01', 'Flareon'],
  ['swsh10tg', 'Astral Radiance Trainer Gallery', 'swsh10', 'Astral Radiance', 'TG01', 'Abomasnow'],
  ['swsh11tg', 'Lost Origin Trainer Gallery', 'swsh11', 'Lost Origin', 'TG01', 'Parasect'],
  ['swsh12tg', 'Silver Tempest Trainer Gallery', 'swsh12', 'Silver Tempest', 'TG01', 'Braixen'],
  ['swsh12.5gg', 'Crown Zenith Galarian Gallery', 'swsh12.5', 'Crown Zenith', 'GG01', 'Hisuian Voltorb'],
  ['sma', 'Hidden Fates Shiny Vault', 'sma', 'Yellow A Alternate', 'SV1', 'Scyther'],
  ...[
    ['2011bw', 2011, 'Snivy'], ['2012bw', 2012, 'Servine'],
    ['2014xy', 2014, 'Weedle'], ['2015xy', 2015, 'Treecko'],
    ['2016xy', 2016, 'Vulpix'], ['2017sm', 2017, 'Rowlet'],
    ['2018sm', 2018, 'Growlithe'], ['2019sm', 2019, 'Caterpie'],
  ].map(([id, year, name]) =>
    [id, `McDonald's Collection ${year}`, id, `Macdonald's Collection ${year}`, '1', name]),
  ['2021swsh', "McDonald's Collection 2021", '2021swsh', "Macdonald's Collection 2021", '25', 'Pikachu'],
];

const now = Date.parse('2026-11-09T12:00:00Z');

for (const [localId, localName, remoteId, remoteName, number, name] of cases) {
  test(`matches verified CardDex set mapping for ${localId}`, () => {
    const card = { id: `tcgdex-en-${localId}-${number}`, game: 'pokemon', language: 'English',
      set_id: localId, set_name: localName, number, name };
    const id = `${remoteId}-${number}`;
    const row = { id, set_id: remoteId, set_name: remoteName, number, name, base_finish: 'holo',
      image_url: 'https://images.carddex.dev/test.png',
      prices: [{ card_id: id, variant_id: null, source: 'cardmarket', currency: 'EUR',
        trend_price: 5, recorded_at: '2026-11-09T07:00:00Z' }] };
    const artwork = candidate => chooseCarddexArtwork(card, { data: [candidate], meta: { total: 1 } });
    assert.equal(carddexSetId(card), remoteId);
    assert.equal(providerId(card), id);
    assert.equal(extractCarddexQuote(card, { data: row }, now).amount, 5);
    assert.equal(artwork(row).providerId, id);
    for (const change of [{ set_id: 'other' }, { set_name: 'Other' }, { number: '999' }, { name: 'Other' }]) {
      assert.equal(extractCarddexQuote(card, { data: { ...row, ...change } }, now), null);
      assert.equal(artwork({ ...row, ...change }), null);
    }
    assert.equal(extractCarddexQuote({ ...card, set_name: 'Other' }, { data: row }, now), null);
    assert.equal(chooseCarddexArtwork({ ...card, set_name: 'Other' }, { data: [row], meta: { total: 1 } }), null);
    assert.equal(providerId({ ...card, language: 'Japanese' }), null);
    if (localId !== remoteId) {
      assert.equal(carddexSetId({ ...card, set_name: 'Other' }), localId);
      assert.equal(providerId({ ...card, id: `tcgdex-en-other-${number}` }), null);
    }
  });
}

test('does not confuse Yellow A Alternate with the mislabeled Shiny Vault', () => {
  const card = { id: 'tcgdex-en-xya-24a', game: 'pokemon', language: 'English',
    set_id: 'xya', set_name: 'Yellow A Alternate', number: '24a', name: 'M Manectric-EX' };
  assert.equal(carddexSetId(card), 'xya');
  assert.equal(providerId(card), 'xya-24a');
  assert.equal(extractCarddexQuote(card, { data: { id: 'sma-24a', set_id: 'sma',
    set_name: 'Yellow A Alternate', name: card.name, number: card.number } }, now), null);
});
