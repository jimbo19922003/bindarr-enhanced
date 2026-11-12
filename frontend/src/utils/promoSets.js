// Promo cards in sealed products come from a Black Star promo set, not from the
// product's own set. Pokémon TCG Pocket promos (Promos-A) are never in sealed.
export const isPromoSet = set => /black star promo/i.test(String(set?.name || ''));

const released = set => String(set?.release_date || '').replace(/\//g, '-');

// Promo sets newest first; list order stands in when release dates are missing.
export function promoSets(sets) {
  return (sets || []).map((set, index) => ({ set, index })).filter(({ set }) => isPromoSet(set))
    .sort((a, b) => released(b.set).localeCompare(released(a.set)) || b.index - a.index).map(({ set }) => set);
}

// The promo set of the product's series, else the newest promo set.
export function defaultPromoSet(sets, productSetId) {
  const promos = promoSets(sets);
  const series = String((sets || []).find(set => set.id === productSetId)?.series || '').trim().toLowerCase();
  return (series && promos.find(set => String(set.series || '').trim().toLowerCase() === series)) || promos[0] || null;
}
