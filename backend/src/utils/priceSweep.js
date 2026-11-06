'use strict';

// Pokémon price writers share card_cache columns. Running them without waiting
// made "TCGCSV goes last" a comment rather than an order: a later writer could
// finish first. PokéWallet is last on purpose. It only fills a card that still
// has no positive quote, so a TCGCSV price written earlier in the same pass
// keeps the final say. Overlapping ticks do not start a second pass.

const PRICE_SWEEP_ORDER = [
  'pokemon',
  'mtg',
  'lorcana',
  'tcgdex',
  'pokemontcgapi',
  'tcgcsv',
  'pokewallet',
];

const SECRET_ENV = ['POKEWALLET_API_KEY', 'POKEMONTCGAPI_KEY', 'POKEMON_TCG_API_KEY'];

function safeErrorMessage(err) {
  let message = err && err.message ? String(err.message) : 'price sweep failed';
  for (const name of SECRET_ENV) {
    const secret = String(process.env[name] || '').trim();
    if (secret && message.includes(secret)) message = message.split(secret).join('[redacted]');
  }
  return message.slice(0, 300);
}

let running = false;

async function runSequential(steps) {
  if (running) return { skipped: true, errors: [] };
  running = true;
  const errors = [];
  try {
    for (const step of steps) {
      try {
        await step.run();
      } catch (err) {
        const message = safeErrorMessage(err);
        errors.push({ name: step.name, message });
        console.error(`Price sweep ${step.name} failed: ${message}`);
      }
    }
    return { skipped: false, errors };
  } finally {
    running = false;
  }
}

module.exports = { PRICE_SWEEP_ORDER, runSequential, safeErrorMessage };
