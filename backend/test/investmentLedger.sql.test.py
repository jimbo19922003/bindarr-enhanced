from pathlib import Path
import json
import sqlite3
spec = json.loads((Path(__file__).resolve().parents[2] / 'shared/investmentLedgerSchema.json').read_text())
db = sqlite3.connect(':memory:')
db.executescript('CREATE TABLE collection(id INTEGER PRIMARY KEY,user_id INTEGER,purchase_price REAL,quantity INTEGER,game TEXT,list_type TEXT,added_at TEXT,notes TEXT); CREATE TABLE sealed_product(id INTEGER PRIMARY KEY,user_id INTEGER,archived_at TEXT); CREATE TABLE sealed_lot(id INTEGER PRIMARY KEY,user_id INTEGER,product_id INTEGER,total_cost_cents INTEGER,quantity INTEGER,currency TEXT,purchased_at TEXT,archived_at TEXT,remaining_quantity INTEGER,remaining_cost_cents INTEGER);')
db.execute("INSERT INTO collection VALUES(1,1,10,1,'pokemon','collection','2026-11-07','')")
db.execute('INSERT INTO sealed_product VALUES(1,1,NULL)')
db.execute("INSERT INTO sealed_lot VALUES(1,1,1,4999,1,'USD','2026-11-07',NULL,1,4999)")
for statement in spec['schema'] + spec['seed'] + spec['seed']:
    db.execute(statement)
assert db.execute('SELECT COUNT(*) FROM investment_event').fetchone()[0] == 2
db.execute('UPDATE sealed_lot SET remaining_quantity=0,remaining_cost_cents=0 WHERE id=1')
db.execute("UPDATE collection SET notes='changed' WHERE id=1")
assert db.execute('SELECT COUNT(*) FROM investment_event').fetchone()[0] == 2
db.execute('UPDATE collection SET purchase_price=20 WHERE id=1')
assert db.execute("SELECT amount_cents FROM investment_event WHERE source_kind='card' ORDER BY id DESC LIMIT 1").fetchone()[0] == 2000
db.execute("UPDATE sealed_product SET archived_at='now' WHERE id=1")
assert db.execute("SELECT active FROM investment_event WHERE source_kind='sealed' ORDER BY id DESC LIMIT 1").fetchone()[0] == 0
db.execute('SAVEPOINT rollback_test')
db.execute("INSERT INTO collection VALUES(2,1,0,4,'pokemon','collection','2026-11-07','')")
db.execute('ROLLBACK TO rollback_test'); db.execute('RELEASE rollback_test')
assert not db.execute("SELECT 1 FROM investment_event WHERE source_kind='card' AND source_id=2").fetchone()
db.execute('DELETE FROM collection WHERE id=1')
assert db.execute("SELECT active FROM investment_event WHERE source_kind='card' ORDER BY id DESC LIMIT 1").fetchone()[0] == 0
db.execute(spec['dailySchema'])
row = [1,'','USD','America/Chicago','2026-11-07',1000,14000,12000,2000,10000,4000,40.0,4,0,0,0]
db.execute(spec['dailyUpsert'], row)
row[5]=2000; row[6]=15000; db.execute(spec['dailyUpsert'],row)
older=row.copy(); older[5]=500; older[6]=1; db.execute(spec['dailyUpsert'],older)
assert db.execute('SELECT COUNT(*),value_cents FROM portfolio_daily_performance').fetchone() == (1,15000)
row[4]='2026-11-08'; row[5]=3000; db.execute(spec['dailyUpsert'],row)
assert db.execute('SELECT COUNT(*) FROM portfolio_daily_performance').fetchone()[0] == 2
print('investmentLedger.sql.test.py: assertions passed')
