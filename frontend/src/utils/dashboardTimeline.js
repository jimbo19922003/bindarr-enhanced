export function cardAverages(summary) {
  const count = Number(summary.totalCards), spent = Number(summary.totalSpent), market = Number(summary.avgCardValue);
  return { investedPerCard: count > 0 && Number.isFinite(spent) ? spent / count : null,
    marketPerCard: count > 0 && summary.avgCardValue != null && Number.isFinite(market) ? market : null };
}
function calendarDate(day) {
  const key = String(day || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const date = new Date(`${key}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}
export function formatDayTick(day, locale = 'en-US') {
  const date = calendarDate(day);
  return date ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date) : '';
}
export function formatDayTooltip(day, locale = 'en-US') {
  const date = calendarDate(day);
  return date ? new Intl.DateTimeFormat(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date) : '';
}
export function formatMoneyTick(value, currency = 'USD', locale = 'en-US') {
  return Number.isFinite(Number(value)) ? new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(Number(value)) : '';
}
