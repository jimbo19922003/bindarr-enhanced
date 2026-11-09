import { getPrintings } from './cardOptions.js';

export function availablePrintings(card) {
  let available = card?.available_printings;
  if (typeof available === 'string') {
    try { available = JSON.parse(available); } catch { available = null; }
  }
  const options = getPrintings(card?.game || 'pokemon');
  if (!Array.isArray(available) || !available.length ||
      available.some(value => !options.some(option => option.value === value))) {
    return { options, verified: false };
  }
  return { options: options.filter(option => available.includes(option.value)), verified: true };
}

export function preferredPrinting(card, preferred = 'Normal') {
  const { options } = availablePrintings(card);
  return options.some(option => option.value === preferred) ? preferred : options[0].value;
}

export function exactPrintingPrice(card, printing) {
  const field = {
    Normal: 'price_normal', Holofoil: 'price_holofoil',
    'Reverse Holofoil': 'price_reverse_holofoil', '1st Edition': 'price_1st_edition',
  }[printing];
  const value = field && Number(card?.[field]);
  return value > 0 && Number.isFinite(value) ? value : null;
}
