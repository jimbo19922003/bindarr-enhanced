// Mirrors the server's "owned" test for the set view (same game and set, card
// number compared trimmed, case-insensitive, without leading zeros), so a
// tile marked owned always resolves to the collection rows behind it. Custom
// sets also match a card with no number by its exact card id, and a
// per-printing slot only counts copies of that printing.
const normalizeNumber = value => String(value ?? '').trim().replace(/^0+/, '').toLowerCase();

export function standardSetCompletion(set, collection, fullSet = false) {
  if (!set) return null;
  const total = fullSet ? set.total : set.printed_total;
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  const numbers = new Set(collection
    .filter(card => card.game === set.game && card.set_id === set.id)
    .map(card => {
      const key = String(card.number ?? '').trim().toLowerCase();
      return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, '') : key;
    })
    .filter(key => key && (fullSet || set.game === 'mtg' || (/^\d+$/.test(key) && Number(key) >= 1 && Number(key) <= total))));
  return { owned: numbers.size, total, percent: Math.min(Math.round(numbers.size / total * 100), 100) };
}

export function ownedEntriesForSetCard(card, collection) {
  if (!card || !Array.isArray(collection)) return [];
  const number = normalizeNumber(card.number);
  const entries = String(card.number ?? '').trim()
    ? collection.filter(entry =>
      entry.game === card.game &&
      entry.set_id === card.set_id &&
      String(entry.number ?? '').trim() !== '' &&
      normalizeNumber(entry.number) === number)
    : collection.filter(entry => card.id && entry.card_id === card.id);
  return card.slot_printing
    ? entries.filter(entry => (entry.printing || 'Normal') === card.slot_printing)
    : entries;
}

// One entry opens directly; several open as a stack so the inspector's print
// picker can target a specific copy.
export function inspectorCardForSetCard(card, collection) {
  const entries = ownedEntriesForSetCard(card, collection);
  if (!entries.length) return null;
  if (entries.length === 1) return entries[0];
  return {
    ...entries[0],
    quantity: entries.reduce((sum, entry) => sum + (entry.quantity || 0), 0),
    stack_entries: entries,
  };
}
