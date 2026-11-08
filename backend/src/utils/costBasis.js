'use strict';
function cents(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  return BigInt(value);
}
// Weights are frozen opening-time LINE values, including quantity, in one currency.
// Caller must confirm all contents (including bulk) before finalizing an opening.
function allocateOpeningCost(totalCostCents, lines, { complete = false } = {}) {
  const total = cents(totalCostCents, 'opening cost');
  if (!Array.isArray(lines)) throw new TypeError('Expected opening lines');
  const ids = new Set();
  const weighted = lines.map(line => {
    if (typeof line.id !== 'string' || !line.id || ids.has(line.id)) throw new TypeError('Unique string line IDs required');
    ids.add(line.id);
    return { id: line.id, weight: cents(line.openingValueCents, 'opening line value') };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const denominator = weighted.reduce((sum, line) => sum + line.weight, 0n);
  if (!complete || !weighted.length || denominator === 0n) return { status: 'pending', allocations: [], pendingCents: Number(total) };
  const shares = weighted.map(line => ({ id: line.id, cost: total * line.weight / denominator, remainder: total * line.weight % denominator }));
  let left = total - shares.reduce((sum, line) => sum + line.cost, 0n);
  const order = [...shares].sort((a, b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const line of order) { if (left === 0n) break; line.cost++; left--; }
  return { status: 'allocated', allocations: shares.map(line => ({ id: line.id, costCents: Number(line.cost) })), pendingCents: 0 };
}
// A lot must contain identical units with the same acquisition provenance.
function calculateSale({ proceedsCents, feesCents = 0, remainingBasisCents, remainingQuantity, quantity }) {
  const proceeds = cents(proceedsCents, 'sale proceeds'), fees = cents(feesCents, 'selling fees');
  if (!Number.isSafeInteger(remainingQuantity) || remainingQuantity < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > remainingQuantity) throw new RangeError('Invalid sale quantity');
  const net = Number(proceeds - fees);
  if (remainingBasisCents == null) return { netProceedsCents: net, soldBasisCents: null, realizedGainCents: null, remainingBasisCents: null, remainingQuantity: remainingQuantity - quantity, basisStatus: 'unknown' };
  const basis = cents(remainingBasisCents, 'remaining basis');
  const sold = basis * BigInt(quantity) / BigInt(remainingQuantity);
  const gain = proceeds - fees - sold;
  if (gain < BigInt(Number.MIN_SAFE_INTEGER) || gain > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Gain exceeds safe integer range');
  return { netProceedsCents: net, soldBasisCents: Number(sold), realizedGainCents: Number(gain), remainingBasisCents: Number(basis - sold), remainingQuantity: remainingQuantity - quantity, basisStatus: 'known' };
}
module.exports = { allocateOpeningCost, calculateSale };
