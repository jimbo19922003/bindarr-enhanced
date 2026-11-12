import { useEffect, useState } from 'react';
import { useT } from '../../utils/i18n';
import { tradeApi } from '../../utils/tradeApi';
import { Money } from '../TradeShared';

export default function TradeHistory() {
  const { t } = useT();
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    tradeApi('/api/trade/history', { signal: controller.signal }).then(setHistory)
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, []);
  if (error) return <p role="alert" className="glass-panel">{error}</p>;
  if (!history) return <p role="status" className="glass-panel">{t('common.loading')}</p>;
  const { totals } = history;
  const stats = [
    ['trades.history.trades', totals.trades],
    ['trades.history.givenValue', <Money key="g" cents={totals.given_cents} currency="USD" />],
    ['trades.history.receivedValue', <Money key="r" cents={totals.received_cents} currency="USD" />],
    ['trades.history.cashIn', <Money key="i" cents={totals.cash_in_cents} currency="USD" />],
    ['trades.history.cashOut', <Money key="o" cents={totals.cash_out_cents} currency="USD" />],
    ['trades.history.gain', <Money key="n" cents={totals.realized_gain_cents} currency="USD" />],
  ];
  return <section className="glass-panel trades-history">
    <h3>{t('trades.history.title')}</h3>
    <p className="trade-muted">{t('trades.history.hint')}</p>
    <div className="trades-stats">
      {stats.map(([label, value]) => <div key={label} className="trades-stat"><span className="trade-muted">{t(label)}</span><strong>{value}</strong></div>)}
    </div>
    {totals.gain_unknown > 0 && <p className="trade-muted">{t('trades.history.gainUnknown', { count: totals.gain_unknown })}</p>}
    {!history.trades.length ? <p>{t('trades.history.empty')}</p> : <div className="trades-table-wrap"><table className="trades-table">
      <thead><tr>
        <th>{t('trades.history.date')}</th><th>{t('trade.contact')}</th><th>{t('trades.history.binder')}</th>
        <th>{t('trades.history.givenValue')}</th><th>{t('trades.history.receivedValue')}</th>
        <th>{t('trades.history.cashIn')}</th><th>{t('trades.history.cashOut')}</th><th>{t('trades.history.gain')}</th>
      </tr></thead>
      <tbody>{history.trades.map(trade => <tr key={trade.request_id}>
        <td>{trade.completed_on}</td>
        <td><details><summary>#{trade.request_id} {trade.discord_contact}</summary>
          <p>{t('trades.history.gave', { count: trade.result.given.reduce((sum, line) => sum + (line.quantity ?? 1), 0) })}: {trade.result.given.map(card => `${card.quantity ?? 1}x ${card.name}`).join(', ') || '—'}</p>
          <p>{t('trades.history.received', { count: trade.result.received.reduce((sum, line) => sum + line.quantity, 0) })}: {trade.result.received.map(line => `${line.quantity}x ${line.name}`).join(', ') || '—'}</p>
        </details></td>
        <td>{trade.binder_name || t('trades.binders.master')}</td>
        <td><Money cents={trade.given_cents} currency="USD" /></td>
        <td><Money cents={trade.received_cents} currency="USD" /></td>
        <td><Money cents={trade.cash_in_cents} currency="USD" /></td>
        <td><Money cents={trade.cash_out_cents} currency="USD" /></td>
        <td><Money cents={trade.realized_gain_cents} currency="USD" /></td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
