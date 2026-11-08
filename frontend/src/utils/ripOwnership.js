const quantity = pull => Number.isSafeInteger(Number(pull.quantity)) && Number(pull.quantity) > 0 ? Number(pull.quantity) : 0;
const ownedCount = (counts, id) => Number.isSafeInteger(counts[id]) && counts[id] >= 0 ? counts[id] : null;
const order = pull => pull.id ? Number(pull.id) : Number(pull.added_order ?? String(pull.key).replace(/^new-/, '')) || 0;
export function draftOwnership(pulls, counts, editing = false) {
  const result = {}, earlier = new Map();
  const sorted = pulls.filter(pull => pull.card_id && !pull.bulk).slice().sort((a, b) => Number(!a.id) - Number(!b.id) || order(a) - order(b));
  for (const pull of sorted) {
    const owned = ownedCount(counts, pull.card_id), before = earlier.get(pull.card_id) || 0, qty = quantity(pull);
    const title = 'Same catalog card, across finishes. In edit mode, copies automatically filed by this rip are excluded from the collection baseline. This is not historical ownership at opening.';
    let kind, text;
    if (owned > 0) { kind = 'owned'; text = `Already owned · ${owned}${editing ? ' outside this rip' : ''}`; }
    else if (before > 0) { kind = 'extra'; text = `Extra copy in this rip · ${before} earlier`; }
    else if (owned == null || !qty) { kind = 'unknown'; text = 'Ownership unknown'; }
    else { kind = editing && pull.id ? 'first' : 'new'; text = kind === 'first' ? 'First copy in this rip' : 'New to collection'; }
    if (qty > 1) text += ` · ${kind === 'new' || kind === 'first' ? qty - 1 : qty} ${kind === 'unknown' ? 'copies in entry' : 'extra copies'}`;
    result[pull.key] = { kind, text, title, owned, earlier: before };
    earlier.set(pull.card_id, before + qty);
  }
  return result;
}
export function candidateOwnership(cardId, pulls, counts, editing = false) {
  const owned = ownedCount(counts, cardId), inRip = pulls.filter(pull => pull.card_id === cardId && !pull.bulk).reduce((sum, pull) => sum + quantity(pull), 0);
  const title = 'Same catalog card, across finishes; collection baseline excludes automatically filed copies from the opening being edited.';
  if (owned > 0) return { kind: 'owned', text: `Already owned · ${owned}${editing ? ' outside this rip' : ''}${inRip ? ` + ${inRip} in this rip` : ''}`, title };
  if (inRip) return { kind: 'extra', text: `Already in this rip · ${inRip}`, title };
  if (owned == null) return { kind: 'unknown', text: 'Ownership unknown', title };
  return { kind: 'new', text: 'New to collection', title };
}
