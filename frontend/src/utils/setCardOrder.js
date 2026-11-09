const collectorNumberCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortCardsBySetNumber(cards) {
  return cards.slice().sort((a, b) =>
    collectorNumberCollator.compare(String(a.number || ''), String(b.number || '')) ||
    String(a.name || '').localeCompare(String(b.name || ''))
  );
}
