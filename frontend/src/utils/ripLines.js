// Rip draft lines. Every card added to a rip gets its own line so each copy can
// carry its own printing and value — two copies of one card are often different
// finishes. A line typed up to a larger quantity can be split back into single
// lines; recorded, bulk and line-total entries are never split.
export const MAX_RIP_LINES = 100;
export function canSplitRipLine(pull) {
  const count = Number(pull?.quantity);
  return !!pull && !pull.id && !pull.bulk && !pull.lineMode && !!pull.card_id && Number.isSafeInteger(count) && count > 1;
}
export function splitRipLine(pulls, key, nextKey) {
  const index = pulls.findIndex(pull => pull.key === key);
  if (index < 0 || !canSplitRipLine(pulls[index])) return pulls;
  const line = pulls[index], count = Number(line.quantity);
  if (pulls.length - 1 + count > MAX_RIP_LINES) return pulls;
  const singles = Array.from({ length: count }, (_, position) => {
    const sequence = position === 0 ? null : nextKey();
    return position === 0 ? { ...line, quantity: '1' } : { ...line, key: `new-${sequence}`, added_order: sequence, quantity: '1' };
  });
  return [...pulls.slice(0, index), ...singles, ...pulls.slice(index + 1)];
}
