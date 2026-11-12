// Group only derived lots from the same physical source opening. Individual
// lots remain the action targets so cost rounding, sales and rip history survive.
export function sealedPackGroups(lots) {
  const groups = new Map();
  for (const lot of lots) {
    const key = lot.parent_opening_id ? JSON.stringify([
      lot.parent_opening_id, lot.product_id, lot.currency, lot.location_id ?? null,
      lot.archived_at || null, lot.purchased_at, !!lot.cost_pending, lot.market_unit_cents ?? null,
    ]) : `lot-${lot.id}`;
    if (!groups.has(key)) groups.set(key, { key, lots: [], quantity: 0, remaining: 0, costCents: 0, remainingCostCents: 0 });
    const group = groups.get(key);
    group.lots.push(lot);
    group.quantity += lot.quantity;
    group.remaining += lot.remaining_quantity;
    group.costCents += lot.total_cost_cents;
    group.remainingCostCents += lot.remaining_cost_cents;
  }
  return [...groups.values()];
}
