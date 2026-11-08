import test from 'node:test';
import assert from 'node:assert/strict';
import { cardAverages, formatDayTick, formatDayTooltip, formatMoneyTick } from './dashboardTimeline.js';
test('invested average is independent of average market value', () => {
  const averages = cardAverages({ totalSpent: 99.98, totalCards: 6, avgCardValue: 33.12 });
  assert.equal(averages.investedPerCard.toFixed(2), '16.66');
  assert.equal(averages.marketPerCard.toFixed(2), '33.12');
  assert.deepEqual(cardAverages({ totalSpent: 99.98, totalCards: 0, avgCardValue: 0 }), { investedPerCard: null, marketPerCard: null });
});
test('daily labels omit times and preserve the supplied calendar date', () => {
  assert.equal(formatDayTick('2026-11-07', 'en-US'), 'Nov 7');
  assert.match(formatDayTooltip('2026-11-07', 'en-US'), /November 7, 2026/);
  assert.equal(formatDayTick('invalid'), '');
  assert.match(formatMoneyTick(1200, 'USD', 'en-US'), /\$1\.2K/);
});
