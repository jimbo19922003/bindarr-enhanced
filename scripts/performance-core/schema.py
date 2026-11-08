def build():
    columns = 'user_id, source_kind, source_id, operation, source_date, date_basis, amount_cents, currency, game, active'
    schema = [
        "CREATE TABLE IF NOT EXISTS investment_event (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, source_kind TEXT NOT NULL, source_id INTEGER NOT NULL, operation TEXT NOT NULL, recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), source_date TEXT, date_basis TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, game TEXT NOT NULL, active INTEGER NOT NULL)",
        'CREATE INDEX IF NOT EXISTS investment_event_user ON investment_event(user_id, id)',
        'CREATE INDEX IF NOT EXISTS investment_event_source ON investment_event(user_id, source_kind, source_id, id)',
    ]
    def values(kind, a, operation, active=None):
        if kind == 'card':
            amount = f'CAST(ROUND(COALESCE({a}.purchase_price,0)*100) AS INTEGER)*COALESCE({a}.quantity,1)'
            parts = [f'{a}.user_id', "'card'", f'{a}.id', f"'{operation}'", f'substr({a}.added_at,1,10)', "'added_at'", amount, "'USD'", f"COALESCE({a}.game,'pokemon')", active or f"CASE WHEN {a}.list_type='collection' THEN 1 ELSE 0 END"]
        else:
            enabled = f'CASE WHEN {a}.archived_at IS NULL AND EXISTS(SELECT 1 FROM sealed_product p WHERE p.id={a}.product_id AND p.user_id={a}.user_id AND p.archived_at IS NULL) THEN 1 ELSE 0 END'
            parts = [f'{a}.user_id', "'sealed'", f'{a}.id', f"'{operation}'", f'{a}.purchased_at', "'purchased_at'", f'{a}.total_cost_cents', f'{a}.currency', "'pokemon'", active or enabled]
        return ', '.join(parts)
    for kind, table, watched in [
        ('card', 'collection', ['purchase_price','quantity','game','list_type','user_id','added_at']),
        ('sealed', 'sealed_lot', ['total_cost_cents','quantity','currency','purchased_at','archived_at','user_id','product_id']),
    ]:
        schema.append(f'CREATE TRIGGER IF NOT EXISTS investment_{kind}_insert_v1 AFTER INSERT ON {table} WHEN NEW.user_id IS NOT NULL BEGIN INSERT INTO investment_event ({columns}) SELECT {values(kind,"NEW","insert")}; END')
        changed = ' OR '.join(f'OLD.{field} IS NOT NEW.{field}' for field in watched)
        schema.append(f'CREATE TRIGGER IF NOT EXISTS investment_{kind}_update_v1 AFTER UPDATE OF {", ".join(watched)} ON {table} WHEN {changed} BEGIN INSERT INTO investment_event ({columns}) SELECT {values(kind,"OLD","reassigned","0")} WHERE OLD.user_id IS NOT NEW.user_id AND OLD.user_id IS NOT NULL; INSERT INTO investment_event ({columns}) SELECT {values(kind,"NEW","update")} WHERE NEW.user_id IS NOT NULL; END')
        schema.append(f'CREATE TRIGGER IF NOT EXISTS investment_{kind}_delete_v1 AFTER DELETE ON {table} WHEN OLD.user_id IS NOT NULL BEGIN INSERT INTO investment_event ({columns}) SELECT {values(kind,"OLD","delete","0")}; END')
    schema.append(f'CREATE TRIGGER IF NOT EXISTS investment_product_visibility_v1 AFTER UPDATE OF archived_at, user_id ON sealed_product WHEN OLD.archived_at IS NOT NEW.archived_at OR OLD.user_id IS NOT NEW.user_id BEGIN INSERT INTO investment_event ({columns}) SELECT {values("sealed","l","product-visibility")} FROM sealed_lot l WHERE l.product_id=NEW.id AND l.user_id IS NOT NULL; END')
    seed = [f"INSERT INTO investment_event ({columns}) SELECT {values(kind,'s','baseline')} FROM {table} s WHERE s.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM investment_event e WHERE e.user_id=s.user_id AND e.source_kind='{kind}' AND e.source_id=s.id)" for kind, table in [('card','collection'),('sealed','sealed_lot')]]
    fields = ['user_id','game','currency','time_zone','day','recorded_at','value_cents','cards_cents','sealed_cents','invested_cents','gain_cents','return_pct','ledger_id','stale_rates','unpriced_cards','unpriced_sealed']
    daily = 'CREATE TABLE IF NOT EXISTS portfolio_daily_performance (user_id INTEGER NOT NULL, game TEXT NOT NULL, currency TEXT NOT NULL, time_zone TEXT NOT NULL, day TEXT NOT NULL, recorded_at INTEGER NOT NULL, value_cents INTEGER NOT NULL, cards_cents INTEGER NOT NULL, sealed_cents INTEGER NOT NULL, invested_cents INTEGER NOT NULL, gain_cents INTEGER NOT NULL, return_pct REAL, ledger_id INTEGER NOT NULL, stale_rates INTEGER NOT NULL, unpriced_cards INTEGER NOT NULL, unpriced_sealed INTEGER NOT NULL, PRIMARY KEY(user_id,game,currency,time_zone,day))'
    upsert = f"INSERT INTO portfolio_daily_performance ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)}) ON CONFLICT(user_id,game,currency,time_zone,day) DO UPDATE SET {','.join(f'{field}=excluded.{field}' for field in fields[5:])} WHERE excluded.recorded_at>=portfolio_daily_performance.recorded_at"
    return {'schema': schema, 'seed': seed, 'dailySchema': daily, 'dailyUpsert': upsert}
