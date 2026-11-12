export const TRADE_SORTS = ['name', 'value_desc', 'value_asc', 'set', 'quantity_desc'];

const text = value => String(value ?? '');
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byName = (a, b) => collator.compare(text(a.printed_name || a.name), text(b.printed_name || b.name));
const bySet = (a, b) => collator.compare(text(a.set_name), text(b.set_name)) || collator.compare(text(a.number), text(b.number));

// Unpriced cards sort after priced ones in both value directions.
function byValue(direction) {
  return (a, b) => {
    if (a.unit_cents == null || b.unit_cents == null) return (a.unit_cents == null) - (b.unit_cents == null);
    return direction * (a.unit_cents - b.unit_cents);
  };
}

const comparators = {
  name: (a, b) => byName(a, b) || bySet(a, b),
  value_desc: (a, b) => byValue(-1)(a, b) || byName(a, b),
  value_asc: (a, b) => byValue(1)(a, b) || byName(a, b),
  set: (a, b) => bySet(a, b) || byName(a, b),
  quantity_desc: (a, b) => b.quantity - a.quantity || byName(a, b),
};

// Exact-match card fields an owner can narrow a trade list by; '' means any value.
export const TRADE_FACETS = ['kind', 'set_name', 'condition', 'printing', 'rarity'];

export function filterTradeCards(cards, { search = '', game = '', sort = 'name', facets = {} } = {}) {
  const needle = search.trim().toLowerCase();
  const active = TRADE_FACETS.filter(field => facets[field]);
  return cards
    .filter(card => !game || card.game === game)
    .filter(card => active.every(field => card[field] === facets[field]))
    .filter(card => !needle || `${card.name} ${card.printed_name} ${card.set_name} ${card.number} ${card.game}`.toLowerCase().includes(needle))
    .sort(comparators[sort] || comparators.name);
}

export function tradeGames(...lists) {
  return [...new Set(lists.flat().map(card => card.game).filter(game => game && game !== 'sealed'))].sort();
}

export function tradeFacetValues(field, ...lists) {
  return [...new Set(lists.flat().map(card => card[field]).filter(Boolean))].sort(collator.compare);
}
