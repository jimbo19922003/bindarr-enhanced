from pathlib import Path
marker='// sale-aware-timeline-v1\n'
def once(s,old,new):
 if s.count(old)!=1:raise RuntimeError('Sale-aware timeline anchor changed: '+old[:100])
 return s.replace(old,new,1)
changes=[]
def edit(path,fn):
 p=Path(path);s=p.read_text()
 if not s.startswith(marker):changes.append((p,marker+fn(s)))
def live(s):
 s=once(s,'    await connection.run(\'COMMIT\'); reading = false;',"    const accounting = typeof connection.get === 'function' && typeof connection.all === 'function' ? await require('./timelineAccounting').readAccounting(connection,userId,game,valuation,portfolio,require('./performanceHistory').dayAt(timestamp,timeZone)) : null;\n    await connection.run('COMMIT'); reading = false;")
 return once(s,'    return { day:', '    return { accounting, day:')
edit('backend/src/utils/livePerformance.js',live)
def daily(s):
 s=once(s,'ready = db.run(dailySchema).catch','ready = db.run(dailySchema).then(() => db.run(require(\'./timelineAccounting\').schema)).catch')
 s=once(s,'        const ledger = await connection.get(',"        const accounting = await require('./timelineAccounting').readAccounting(connection,user.id,game,valuation,portfolio,require('./performanceHistory').dayAt(timestamp,timeZone));\n        const ledger = await connection.get(")
 s=once(s,'        await connection.run(dailyUpsert,',"        await connection.run('BEGIN IMMEDIATE'); reading = true;\n        await connection.run(dailyUpsert,")
 return once(s,'        result.captured++;',"        await require('./timelineAccounting').save(connection,[user.id,game,'USD',timeZone,day,timestamp],accounting);\n        await connection.run('COMMIT'); reading = false;\n        result.captured++;")
edit('backend/src/utils/dailyPerformance.js',daily)
def history(s):
 s=once(s,'function point(row) {','function legacyPoint(row) {')
 s=once(s,'function createPerformanceHandler(',"function point(row) { return require('./timelineAccounting').decoratePoint(legacyPoint(row),row); }\nfunction createPerformanceHandler(")
 s=once(s,'      await db.run(dailySchema);',"      await db.run(dailySchema);\n      await db.run(require('./timelineAccounting').schema);")
 old='SELECT * FROM portfolio_daily_performance WHERE user_id = ? AND game = ? AND currency = ? AND time_zone = ? AND day BETWEEN ? AND ? ORDER BY day'
 new='SELECT p.*, a.accounting_json FROM portfolio_daily_performance p LEFT JOIN portfolio_accounting_daily a ON a.user_id=p.user_id AND a.game=p.game AND a.currency=p.currency AND a.time_zone=p.time_zone AND a.day=p.day AND a.recorded_at=p.recorded_at WHERE p.user_id = ? AND p.game = ? AND p.currency = ? AND p.time_zone = ? AND p.day BETWEEN ? AND ? ORDER BY p.day'
 s=once(s,old,new)
 s=once(s,"basis: 'gain-vs-recorded-cost', portfolio", "basis: portfolio.some(p=>p.accountingVersion===2)?'realized-plus-unrealized-v2':'gain-vs-recorded-cost', portfolio")
 return once(s,'        try { result.sp500 =',"        if (portfolio.some(p=>p.accountingVersion===2)) result.sp500={unavailable:true,data:[],reason:'cash-flow-aware-return-required'};\n        else try { result.sp500 =")
edit('backend/src/utils/performanceHistory.js',history)
def chart(s):
 s=once(s,"invested:'Recorded cost',gain:'Loss/Gain',gainPct:'Loss/Gain %'", "invested:'Remaining basis',gain:'Total Loss/Gain',gainPct:'Loss/Gain %',totalGain:'Total Loss/Gain',realizedGain:'Realized Loss/Gain',unrealizedGain:'Unrealized Loss/Gain'")
 s=once(s,"const series = view === 'value' ? ['value','invested'] : [view];", "const series = view === 'value' ? ['value','invested'] : view === 'gain' ? ['totalGain','realizedGain','unrealizedGain'] : [view];")
 s=once(s,'row.unpricedSealed > 0);','row.unpricedSealed > 0 || row.unknownBasisCount > 0 || row.unknownSaleCount > 0);')
 s=once(s,'<BenchmarkComparison benchmark={report.sp500} />',"(rows.some(r=>r.accountingVersion===2) ? <div className=\"portfolio-chart-state\">Benchmark comparison is paused until cash-flow-aware returns are available. Sales must not appear as investment losses.</div> : <BenchmarkComparison benchmark={report.sp500} />)")
 s=once(s,'Add recorded costs to calculate a percentage.','Percentage returns are paused until cash-flow-aware calculations are available.')
 s=once(s,"stroke={index ? '#f59e0b' : '#3b82f6'}","stroke={['#3b82f6','#10b981','#f59e0b'][index % 3]}")
 s=once(s,'Incomplete pricing</span>','Incomplete pricing or basis</span>')
 s=once(s,'Some observations include stale exchange rates or unpriced holdings.','Some observations have stale rates, unpriced holdings, or unknown acquisition or sale basis. Unknown amounts are not treated as zero.')
 s=once(s,'      <details className="portfolio-about">', '      {rows.some(r=>r.accountingVersion!==2)&&<span className="portfolio-warning">Legacy observations: market value only; no reconstructed gain.</span>}\n      <details className="portfolio-about">')
 return once(s,'Today uses current holdings and available quotes; earlier days use saved snapshots. Missing days are not backfilled. Loss/gain compares value with recorded cost, not a cash-flow-adjusted return. Hover or tap a point for exact amounts.','Today uses current holdings, remaining acquisition basis, and cumulative sales through today. New snapshots save realized, unrealized, and total gain separately. Sale fees reduce realized gain. Completed rip cost transfers to contents, not a second purchase. Older snapshots retain their recorded market values but do not invent historical total gains. Unknown basis or missing prices create gaps. Unlinked opening contents are flagged as unpriced. Non-USD realized results require a historical FX policy. Percentages and benchmark returns await cash-flow-aware calculations. Hover or tap a point for exact amounts.')
edit('frontend/src/components/PerformanceChart.jsx',chart)
def tests(s):
 return s.replace('}).gainPct, 50);','}).legacyGainPct, 50);')
edit('backend/src/utils/performanceHistory.test.js',tests)
for path,text in changes:path.write_text(text)
