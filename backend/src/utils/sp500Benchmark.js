'use strict';
const SOURCE = 'FRED SP500 daily closing price index; excludes dividends';
const URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500';
function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (!/^(observation_date|DATE),SP500$/i.test(lines[0]?.trim() || '')) throw new Error('Unexpected benchmark format');
  const rows = new Map();
  for (const line of lines.slice(1)) {
    const [date, raw] = line.trim().split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) continue;
    if (!/^[0-9]+(?:\.[0-9]+)?$/.test(raw || '')) continue;
    const value = Number(raw); if (Number.isFinite(value) && value > 0) rows.set(date,{date,value});
  }
  const result = [...rows.values()].sort((a,b) => a.date.localeCompare(b.date));
  if (!result.length) throw new Error('No usable benchmark closes');
  return result;
}
function compare(portfolio, quotes) {
  const prices = [...quotes].sort((a,b) => a.date.localeCompare(b.date));
  let cursor = 0, close = null, base = null; const data = [];
  for (const row of [...portfolio].sort((a,b) => a.date.localeCompare(b.date))) {
    while (cursor < prices.length && prices[cursor].date <= row.date) close = prices[cursor++];
    if (!close || !Number.isFinite(row.value) || row.value < 0) continue;
    if (!base) { if (row.value <= 0) continue; base = { date:row.date, portfolio:row.value, index:close.value, indexAsOf:close.date }; }
    data.push({date:row.date, holdingsValuePct:(row.value/base.portfolio-1)*100, sp500Pct:(close.value/base.index-1)*100, benchmarkAsOf:close.date});
  }
  return {baseDate:base?.date || null, baseIndexAsOf:base?.indexAsOf || null, data};
}
function createBenchmarkReader({ download = async () => {
  const response = await require('axios').get(URL,{timeout:8000,responseType:'text',maxContentLength:2000000,maxRedirects:3});
  return response.data;
}, now = Date.now, ttl = 6*60*60*1000, cooldown = 5*60*1000 } = {}) {
  let cache = null, fetchedAt = null, retryAt = 0, inflight = null;
  const present = stale => ({source:SOURCE,sourceUrl:'https://fred.stlouisfed.org/series/SP500',fetchedAt,stale,unavailable:!cache,firstAvailableDate:cache?.[0]?.date || null,lastCloseDate:cache?.[cache.length-1]?.date || null,closes:cache || []});
  return { async read() {
    if (cache && now()-fetchedAt < ttl) return present(false);
    if (now() < retryAt) return present(true);
    if (!inflight) inflight = (async () => {
      try { cache = parseCsv(await download()); fetchedAt = now(); retryAt = 0; return present(false); }
      catch { retryAt = now()+cooldown; return present(true); }
      finally { inflight = null; }
    })();
    return inflight;
  } };
}
let reader;
async function loadBenchmark(portfolio) {
  if (!reader) reader = createBenchmarkReader();
  const {closes,...metadata} = await reader.read();
  return {...metadata,...compare(portfolio,closes)};
}
module.exports = {parseCsv,compare,createBenchmarkReader,loadBenchmark};
