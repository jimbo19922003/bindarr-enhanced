import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confidentScan, likelyRepeatedScan, reviewMatch, sameScanCard, topMatchId } from './scanQueue.js';

test('queued matches require the same confidence and ambiguity gates as the scanner', () => {
  const top = { name: 'A', set: 's1', number: '1', score: 0.8, inliers: 15 };
  assert.equal(confidentScan({ candidates: [top], verified: false }), true);
  assert.equal(confidentScan({ candidates: [{ ...top, score: 0.54 }], verified: false }), false);
  assert.equal(confidentScan({ candidates: [{ ...top, inliers: 11 }], verified: true }), false);
  assert.equal(confidentScan({ candidates: [top], notInCatalog: true }), false);
  assert.equal(confidentScan({ candidates: [top, { ...top, name: 'B', score: 0.79 }] }), false);
  assert.equal(confidentScan({ candidates: [top, { ...top, set: 's2', inliers: 11 }], verified: true }), false);
  assert.equal(confidentScan({ candidates: [top, { ...top, name: 'B', score: 0.7 }] }), true);
  assert.equal(confidentScan({ candidates: [] }), false);
});

test('resolved cards must match the candidate set and normalized number', () => {
  const card = { set_id: 'SV01', set_name: 'Set One', number: '013' };
  assert.equal(sameScanCard(card, { set: 'sv01', number: '13' }), true);
  assert.equal(sameScanCard(card, { set: 'set one', number: '013' }), true);
  assert.equal(sameScanCard(card, { set: 'sv02', number: '13' }), false);
  assert.equal(sameScanCard(card, { set: 'sv01', number: '14' }), false);
  assert.equal(sameScanCard(card, { set: 'sv01' }), false);
});

test('only confident and correctly resolved matches are preselected for review', () => {
  const top = { name: 'A', set: 's1', number: '1', score: 0.8 };
  const card = { id: 'a', set_id: 's1', number: '001' };
  assert.equal(reviewMatch({ candidates: [top] }, [card]), 'a');
  assert.equal(reviewMatch({ candidates: [top], notInCatalog: true }, [card]), null);
  assert.equal(reviewMatch({ candidates: [top, { ...top, name: 'B', score: 0.79 }] }, [card]), null);
  assert.equal(reviewMatch({ candidates: [top] }, [{ ...card, set_id: 's2' }]), null);
  assert.equal(reviewMatch({ candidates: [top] }, []), null);
});

test('only consecutive recognizable candidates trigger the repeated-scan guard', () => {
  const top = { name: 'A', set: 's1', number: '1', score: 0.6 };
  const card = { id: 'a', set_id: 's1', number: '001' };
  const result = { candidates: [top, { ...top, name: 'B', score: 0.59 }] };
  const item = { game: 'pokemon' };
  const previous = { game: 'pokemon', matchId: 'a' };
  assert.equal(reviewMatch(result, [card]), null);
  assert.equal(topMatchId(result, [card]), 'a');
  assert.equal(likelyRepeatedScan(previous, item, result, [card]), true);
  assert.equal(likelyRepeatedScan({ ...previous, matchId: 'b' }, item, result, [card]), false);
  assert.equal(likelyRepeatedScan({ ...previous, game: 'mtg' }, item, result, [card]), false);
  assert.equal(likelyRepeatedScan(null, item, result, [card]), false);
  assert.equal(likelyRepeatedScan(previous, item, { ...result, notInCatalog: true }, [card]), false);
  assert.equal(likelyRepeatedScan(previous, item, result, [{ ...card, set_id: 'other' }]), false);
});
