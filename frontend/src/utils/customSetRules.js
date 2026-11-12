export function withPendingRules(rules, pending) {
  return Object.fromEntries(Object.entries(rules).map(([key, values]) => {
    const value = (pending[key] || '').trim();
    return [key, value && !values.some(existing => existing.toLowerCase() === value.toLowerCase())
      ? [...values, value]
      : values];
  }));
}
