const assert = require('node:assert/strict');
const { tcgdexPrintings, parsePrintings, validatePrinting } = require('../src/utils/cardPrintings');

const flags = { normal: false, holo: true, reverse: false, firstEdition: false, wPromo: false };
assert.deepEqual(tcgdexPrintings(flags), ['Holofoil']);
assert.deepEqual(tcgdexPrintings({ ...flags, reverse: true }), ['Holofoil', 'Reverse Holofoil']);
assert.equal(tcgdexPrintings({ ...flags, holo: false }), null);
assert.equal(tcgdexPrintings({ holo: true }), null);
assert.equal(parsePrintings('not json'), null);
assert.throws(() => validatePrinting({ available_printings: '["Holofoil"]' }, 'Normal'), /not available/);
assert.doesNotThrow(() => validatePrinting({ available_printings: null }, 'Normal'));
assert.throws(() => validatePrinting({}, 'Invalid'), /Invalid/);
