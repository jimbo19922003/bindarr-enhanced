export function sameDraftCard(left, right) {
  return !left.id && !right.id && !left.bulk && !right.bulk && !left.lineMode && !right.lineMode &&
    !!left.card_id && left.card_id === right.card_id &&
    (left.printing || 'Normal') === (right.printing || 'Normal') &&
    (left.language || '') === (right.language || '') &&
    (left.condition || 'Near Mint') === (right.condition || 'Near Mint');
}
export function stackRipCard(pulls, incoming) {
  const index = pulls.findIndex(pull => sameDraftCard(pull, incoming) && Number.isSafeInteger(Number(pull.quantity)) && Number(pull.quantity) >= 1);
  if (index < 0) return [incoming, ...pulls];
  const count = Number(pulls[index].quantity), extra = Number(incoming.quantity);
  if (!Number.isSafeInteger(extra) || extra < 1 || count + extra > 5000) return pulls;
  return pulls.map((pull, position) => position === index ? { ...pull, quantity: String(count + extra) } : pull);
}
