'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseCsv,compare,createBenchmarkReader} = require('./sp500Benchmark');
const csv = 'observation_date,SP500\n2026-11-06,100\n2026-11-07,.\n2026-11-09,110\n';
test('CSV parser discards missing, invalid and nonpositive closes', () => {
  assert.deepEqual(parseCsv(csv+'2026-11-10,-1\n2026-11-31,123\n'),[{date:'2026-11-06',value:100},{date:'2026-11-09',value:110}]);
  assert.throws(() => parseCsv('<html>unavailable</html>'));
});
test('comparison aligns baselines and never looks ahead on weekends', () => {
  const result = compare([{date:'2026-11-08',value:200},{date:'2026-11-09',value:300}],parseCsv(csv));
  assert.equal(result.baseDate,'2026-11-08'); assert.equal(result.baseIndexAsOf,'2026-11-06');
  assert.equal(result.data[0].sp500Pct,0); assert.equal(result.data[1].holdingsValuePct,50);
  assert.ok(Math.abs(result.data[1].sp500Pct-10)<1e-9);
  assert.equal(result.data[0].benchmarkAsOf,'2026-11-06');
});
test('no synthetic portfolio history or future baseline is created', () => {
  assert.equal(compare([{date:'2026-11-05',value:100}],parseCsv(csv)).data.length,0);
  assert.equal(compare([{date:'2026-11-08',value:0}],parseCsv(csv)).data.length,0);
});
test('concurrent requests share a fetch and cached data is reused', async () => {
  let calls=0; const reader=createBenchmarkReader({download:async () => {calls++;return csv;},now:() => 100});
  await Promise.all([reader.read(),reader.read()]); await reader.read(); assert.equal(calls,1);
});
test('provider failure keeps cached data and rate-limits retries', async () => {
  let clock=100,calls=0;
  const reader=createBenchmarkReader({ttl:10,cooldown:50,now:() => clock,download:async () => {if (++calls>1) throw new Error('offline');return csv;}});
  await reader.read(); clock=111; const stale=await reader.read();
  assert.equal(stale.stale,true); assert.equal(stale.unavailable,false);
  await reader.read(); assert.equal(calls,2);
});
test('benchmark outage does not fail the portfolio history handler', async () => {
  const {createPerformanceHandler}=require('./performanceHistory'); let result;
  const db={run:async () => {},all:async () => [{day:'2026-11-08',value_cents:20000,invested_cents:10000,cards_cents:20000,sealed_cents:0}]};
  const handler=createPerformanceHandler({db,now:() => Date.parse('2026-11-08T12:00:00Z'),timeZone:'UTC',loadBenchmark:async () => {throw new Error('offline');}});
  await handler({user:{id:1},query:{benchmark:'sp500'}},{set(){},status(){return this;},json(body){result=body;}});
  assert.equal(result.portfolio[0].value,200); assert.equal(result.sp500.unavailable,true);
});
test('sale-aware portfolio points still produce a value-change comparison', async () => {
  const {createPerformanceHandler}=require('./performanceHistory'); let result;
  const accounting={version:3,recordedRemainingCents:10000,soldBasisCents:0,totalGainCents:10000};
  const db={run:async () => {},all:async () => [{day:'2026-11-08',value_cents:20000,invested_cents:10000,cards_cents:20000,sealed_cents:0,accounting_json:JSON.stringify(accounting)}]};
  const handler=createPerformanceHandler({db,now:() => Date.parse('2026-11-08T12:00:00Z'),timeZone:'UTC',loadBenchmark:async portfolio => compare(portfolio,parseCsv(csv))});
  await handler({user:{id:1},query:{benchmark:'sp500'}},{set(){},status(){return this;},json(body){result=body;}});
  assert.equal(result.sp500.data.length,1);
  assert.equal(result.sp500.data[0].holdingsValuePct,0);
});
