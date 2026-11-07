export const VALUATION_CHANGED = 'bindarr_valuation_changed';

export function isSealedMutation(input, options = {}, origin) {
  const raw = typeof input === 'string' ? input : input?.url || input?.href;
  const method = String(options.method || input?.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !raw) return false;
  try {
    const url = new URL(raw, origin);
    return url.origin === origin && url.pathname.startsWith('/api/sealed/');
  } catch {
    return false;
  }
}
