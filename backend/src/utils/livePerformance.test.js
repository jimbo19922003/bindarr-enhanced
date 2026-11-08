'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeCurrent, readCurrentPoint } = require('./livePerformance');
const { createPerformanceHandler } = require('./performanceHistory');
test('today uses current investment; earlier observations are not rewritten', () => {
  const prior = {day:'2026-11-07',invested_cents:10000}, old = {day:'2026-11-08',invested_cents:10000};
  const live = {day:'2026-11-08',invested_cents:40000,is_live:1};
  assert.deepEqual(mergeCurrent([prior,old],live,'2026-11-01','2026-11-08'),[prior,live]);
  assert.equal(old.invested_cents,10000);
  assert.deepEqual(mergeCurrent([],live,'2026-11-01','2026-11-07'),[]);
});
test('reader scopes current valuation and closes its read transaction', async () => {
  const calls = [];
  const connection = {run: async sql => calls.push(sql),close:async () => calls.push('close')};
  const row = await readCurrentPoint({userId:42,game:'',timeZone:'UTC',now:() => Date.parse('2026-11-08T04:23:00Z'),connectRead:async () => connection,createValuation:currency => { assert.equal(currency,'USD'); return {metadata:() => ({staleRates:false})}; },getPortfolio:async (id,game,valuation,tx) => {
    assert.equal(id,42); assert.equal(game,''); assert.equal(tx,connection);
    return {totalValue:500,totalSpent:399.98,cardValue:500,cards:[],sealed:{holdings:{marketValue:0,unpricedUnits:0}}};
  }});
  assert.equal(row.invested_cents,39998); assert.equal(row.day,'2026-11-08');
  assert.equal(row.is_live,1); assert.deepEqual(calls,['BEGIN','COMMIT','close']);
});
test('history overlays sale-aware remaining basis and total gain rather than legacy cost', async () => {
  let body, passed;
  const db = {run:async () => {},all:async () => [{day:'2026-11-08',value_cents:19871,cards_cents:19871,sealed_cents:0,invested_cents:9998}]};
  const accounting={version:2,remainingBasisCents:39998,unknownBasisCount:0,unknownSaleCount:0,knownRealizedGainCents:500,realizedGainCents:500,unrealizedGainCents:9873,totalGainCents:10373,extraUnpriced:0};
  const handler = createPerformanceHandler({db,now:() => Date.parse('2026-11-08T04:23:00Z'),timeZone:'UTC',loadCurrent:async params => { passed=params; return {day:'2026-11-08',value_cents:49871,cards_cents:49871,sealed_cents:0,invested_cents:39998,is_live:1,accounting}; }});
  const res = {set() {},status() {return this;},json(data) {body=data;return this;}};
  await handler({user:{id:42},query:{range:'30d'}},res);
  assert.equal(passed.userId,42); assert.equal(body.portfolio.length,1);
  assert.equal(body.portfolio[0].invested,399.98); assert.equal(body.portfolio[0].isLive,true);
  assert.equal(body.portfolio[0].unrealizedGain,98.73);assert.equal(body.portfolio[0].realizedGain,5);assert.equal(body.portfolio[0].totalGain,103.73);
});
