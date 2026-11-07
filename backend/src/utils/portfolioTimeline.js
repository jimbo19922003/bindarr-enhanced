function currentValues(cards, sealed, resolveCardPrice, summarizeHoldings) {
  const cardsValue = cards.reduce((sum, row) => sum + (row.quantity || 1) * resolveCardPrice(row), 0);
  const sealedValue = summarizeHoldings(sealed).marketValue;
  return { cardsCents: Math.round(cardsValue * 100), sealedCents: Math.round(sealedValue * 100), totalCents: Math.round((cardsValue + sealedValue) * 100) };
}

function timelinePoints(rows) {
  return rows.map(row => ({
    date: new Date(row.recorded_at).toISOString(),
    value: row.total_cents / 100,
    cardsValue: row.cards_cents / 100,
    sealedValue: row.sealed_cents / 100,
  }));
}

function createHistoryHandler({ db, resolveCardPrice, summarizeHoldings }) {
  let ready;
  return async (req, res) => {
    try {
      if (!ready) {
        ready = db.run(`CREATE TABLE IF NOT EXISTS portfolio_timeline (
          user_id INTEGER NOT NULL, game TEXT NOT NULL, recorded_at INTEGER NOT NULL,
          cards_cents INTEGER NOT NULL, sealed_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
          PRIMARY KEY (user_id, game, recorded_at)
        )`).catch(error => { ready = null; throw error; });
      }
      await ready;
      const game = String(req.query.game || '');
      const userId = req.user.id;
      const cards = await db.all(`
        SELECT c.quantity, c.printing, c.market_value, cc.price_trend, cc.price_normal,
               cc.price_holofoil, cc.price_reverse_holofoil, cc.price_1st_edition
          FROM collection c JOIN card_cache cc ON cc.id = c.card_id
         WHERE c.user_id = ?${game ? ' AND cc.game = ?' : ''}
      `, game ? [userId, game] : [userId]);
      const sealed = game && game !== 'pokemon' ? [] : await db.all(`
        SELECT l.remaining_quantity AS remainingQuantity, l.remaining_cost_cents AS remainingCostCents,
               l.currency AS currency, p.market_price_cents AS marketPriceCents, p.market_currency AS marketCurrency
          FROM sealed_lot l JOIN sealed_product p ON p.id = l.product_id AND p.user_id = l.user_id
         WHERE l.user_id = ? AND l.archived_at IS NULL AND p.archived_at IS NULL
      `, [userId]);
      const value = currentValues(cards, sealed, resolveCardPrice, summarizeHoldings);
      const now = Date.now();
      await db.run(`INSERT OR REPLACE INTO portfolio_timeline
        (user_id, game, recorded_at, cards_cents, sealed_cents, total_cents) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, game, now, value.cardsCents, value.sealedCents, value.totalCents]);
      const days = { '7d': 7, '30d': 30, '1y': 365, '5y': 1826 }[req.query.period] || 30;
      const rows = await db.all(`SELECT recorded_at, cards_cents, sealed_cents, total_cents
        FROM portfolio_timeline WHERE user_id = ? AND game = ? AND recorded_at >= ? AND recorded_at <= ?
        ORDER BY recorded_at ASC`, [userId, game, now - days * 86400000, now]);
      res.set('Cache-Control', 'no-store');
      res.json(timelinePoints(rows));
    } catch (error) {
      console.error('Portfolio timeline failed:', error);
      res.status(500).json({ error: 'Failed to compute portfolio timeline' });
    }
  };
}

module.exports = { currentValues, timelinePoints, createHistoryHandler };
