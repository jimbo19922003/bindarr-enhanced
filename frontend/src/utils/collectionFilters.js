export function duplicateCardIds(cards) {
  const counts = new Map();
  for (const card of cards) {
    if (!card.card_id) continue;
    const quantity = Number(card.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    counts.set(card.card_id, (counts.get(card.card_id) || 0) + quantity);
  }
  return new Set([...counts].filter(([, quantity]) => quantity > 1).map(([id]) => id));
}

export function missingArtwork(card, localArtIds) {
  return !String(card.image_url || '').trim() && !localArtIds.has(card.card_id);
}
