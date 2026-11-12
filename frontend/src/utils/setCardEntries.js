// Mirrors the server's "owned" test for the set view (same game and set, card
// number compared trimmed, case-insensitive, without leading zeros), so a
// tile marked owned always resolves to the collection rows behind it. Custom
// sets also match a card with no number by its exact card id, and a
// per-printing slot only counts copies of that printing.
const normalizeNumber = value => String(value ?? '').trim().replace(/^0+/, '').toLowerCase();
const isBaseSetNumber = (number, total) => /^\d+$/.test(String(number ?? '').trim()) && Number(number) >= 1 && Number(number) <= total;

export function standardSetCards(cards, set, fullSet = false) {
  if (fullSet || !set || set.game === 'mtg' || !Number.isSafeInteger(set.printed_total) || set.printed_total <= 0) return cards;
  return cards.filter(card => isBaseSetNumber(card.number, set.printed_total));
}

const positiveTotal = value => (Number.isSafeInteger(value) && value > 0 ? value : null);
const completionKey = number => {
  const key = String(number ?? '').trim().toLowerCase();
  return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, '') : key;
};

// Promo sets print no "/N" total, so their full total is also their base total.
// With no catalogue totals at all (Lorcana before its cards are cached), the
// set's loaded card list stands in, counting only owned numbers in that list.
export function standardSetCompletion(set, collection, fullSet = false, setCards = []) {
  if (!set) return null;
  const total = fullSet ? positiveTotal(set.total) : positiveTotal(set.printed_total) || positiveTotal(set.total);
  const owned = new Set(collection
    .filter(card => card.game === set.game && card.set_id === set.id)
    .map(card => completionKey(card.number))
    .filter(Boolean));
  if (total) {
    const counted = [...owned].filter(key => fullSet || set.game === 'mtg' || isBaseSetNumber(key, total)).length;
    return { owned: counted, total, percent: Math.min(Math.round(counted / total * 100), 100) };
  }
  const listed = new Set((setCards || []).map(card => completionKey(card.number)).filter(Boolean));
  if (!listed.size) return null;
  const counted = [...owned].filter(key => listed.has(key)).length;
  return { owned: counted, total: listed.size, percent: Math.min(Math.round(counted / listed.size * 100), 100) };
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

// Printing quality ladder for the set view. Magic and Lorcana only use Normal
// (nonfoil) and Holofoil (foil), which sit on the same ladder.
export const PRINTING_RANK = { Normal: 0, Promo: 0, 'Reverse Holofoil': 1, Holofoil: 2, '1st Edition': 3 };
const printingRank = printing => PRINTING_RANK[printing || 'Normal'] ?? 0;

function verifiedPrintings(card) {
  let available = card?.available_printings;
  if (typeof available === 'string') {
    try { available = JSON.parse(available); } catch { return null; }
  }
  return Array.isArray(available) && available.length && available.every(value => value in PRINTING_RANK) ? available : null;
}

// For an owned card with known printings: its best owned printing, the better
// printings that exist, and whether one of them is an upgrade. Null when the
// card is not owned or its printings are unknown, so it is never guessed at.
export function printingUpgrade(card, collection) {
  const available = verifiedPrintings(card);
  if (!available) return null;
  const entries = ownedEntriesForSetCard(card, collection);
  if (!entries.length) return null;
  const best = Math.max(...entries.map(entry => printingRank(entry.printing)));
  const better = available.filter(printing => printingRank(printing) > best)
    .sort((a, b) => printingRank(b) - printingRank(a));
  return { upgradeAvailable: better.length > 0, better };
}

// Share of owned, judgeable cards already held in their top printing.
export function setPrintingQuality(cards, collection) {
  let judged = 0;
  let upgrades = 0;
  for (const card of cards) {
    const result = printingUpgrade(card, collection);
    if (!result) continue;
    judged++;
    if (result.upgradeAvailable) upgrades++;
  }
  if (!judged) return null;
  return { maxed: judged - upgrades, owned: judged, upgrades, percent: Math.floor((judged - upgrades) / judged * 100) };
}
