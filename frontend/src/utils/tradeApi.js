export async function tradeApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

// Parses a user-entered amount ("12.5") into integer cents; null when invalid.
export function amountToCents(value, max = 1000000) {
  const textValue = String(value ?? '').trim();
  if (!textValue) return 0;
  const amount = Number(textValue);
  if (!Number.isFinite(amount) || amount < 0 || amount > max) return null;
  return Math.round(amount * 100);
}

export const centsToAmount = cents => (cents == null ? '' : (cents / 100).toFixed(2));

export const tradeEntryId = value => String(value).startsWith('sealed:') ? value : Number(value);

export function tradeItemDetails(item) {
  return item.kind === 'sealed'
    ? [item.set_name, item.language]
    : [item.set_name && `${item.set_name} #${item.number || ''}`, item.printing, item.language, item.condition,
      item.grader && item.grader !== 'Raw' ? `${item.grader} ${item.grade ?? ''}` : null];
}

export const TRADES_CHANGED = 'bindarr:trades-changed';
export const notifyTradesChanged = () => window.dispatchEvent(new Event(TRADES_CHANGED));
