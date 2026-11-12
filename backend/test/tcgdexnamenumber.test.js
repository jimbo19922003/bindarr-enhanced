// A name + number search without a set must find the number past TCGdex's first
// page. The number is filtered locally, so paging the name query upstream hid
// every match beyond it: "Mewtwo" #151 is the 61st Mewtwo and was "no match".
const assert = require('assert');
const fs = require('fs');

process.env.DB_PATH = require('path').join(
  require('os').tmpdir(), `bindarr-tcgdexnamenumber-${process.pid}.db`
);

(async () => {
  const tcgdex = require('../src/tcgdexApi');
  const db = require('../src/db');
  await db.initDb();

  const briefs = Array.from({ length: 61 }, (_, i) => ({ id: `s${i}-${i + 1}`, localId: String(i + 1), name: 'Mewtwo' }));
  const listCalls = [];
  tcgdex.client.get = async (url, opts = {}) => {
    if (url === '/en/cards') {
      listCalls.push(opts.params);
      const p = opts.params || {};
      if (p['pagination:page']) {
        const size = p['pagination:itemsPerPage'];
        return { data: briefs.slice((p['pagination:page'] - 1) * size, p['pagination:page'] * size) };
      }
      return { data: briefs };
    }
    const m = url.match(/^\/en\/cards\/(.+)$/);
    if (!m) throw new Error(`unexpected url ${url}`);
    const b = briefs.find(x => x.id === decodeURIComponent(m[1]));
    return { data: { ...b, category: 'Pokemon', rarity: 'Rare', set: { id: b.id.split('-')[0], name: 'Set' }, pricing: {} } };
  };

  const { cards } = await tcgdex.searchCards({ name: 'Mewtwo', number: '61', scope: 'internet', lang: 'en', page: 1, limit: 60 });
  assert.strictEqual(cards.length, 1, 'the 61st Mewtwo is found by its number');
  assert.strictEqual(cards[0].number, '61');
  assert.ok(!listCalls[0]['pagination:page'], 'a numbered name search is not paged upstream');

  listCalls.length = 0;
  const plain = await tcgdex.searchCards({ name: 'Mewtwo', scope: 'internet', lang: 'en', page: 1, limit: 60 });
  assert.strictEqual(plain.cards.length, 60, 'a plain name search still hydrates one page');
  assert.strictEqual(listCalls[0]['pagination:page'], 1, 'and is still paged upstream');

  await db.close?.();
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + ext, { force: true });
  console.log('tcgdexnamenumber.test.js: all assertions passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
