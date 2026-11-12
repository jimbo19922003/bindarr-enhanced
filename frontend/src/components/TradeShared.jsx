import { useT } from '../utils/i18n';
import { tradeItemDetails } from '../utils/tradeApi';

export function Money({ cents, currency }) {
  const { t, locale } = useT();
  return cents == null ? t('trade.unknown') : new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function Balance({ quote, ownerView = false }) {
  const { t } = useT();
  const summary = quote.summary;
  return <div className="trade-balance" aria-live="polite">
    <div className="trade-columns">
      {['requested', 'offered'].map(side => <div key={side}>
        <strong>{t(ownerView ? `trade.owner.${side}` : `trade.visitor.${side}`)}</strong>
        <p><Money cents={summary[side].known_cents} currency={summary.currency} />
          {summary[side].unknown_quantity > 0 && <> + {t('trade.unpriced', { count: summary[side].unknown_quantity })}</>}
        </p>
        {side === 'offered' && summary.cash_cents > 0 && <p className="trade-muted">
          {t('trade.cashIncluded')} <Money cents={summary.cash_cents} currency={summary.currency} />
        </p>}
      </div>)}
    </div>
    <strong>{t('trade.balance')}: {summary.difference_percent == null ? t('trade.unknown')
      : `${summary.difference_percent > 0 ? '+' : ''}${summary.difference_percent}%`}</strong>
    {summary.difference_cents != null && <> (<Money cents={summary.difference_cents} currency={summary.currency} />)</>}
    <p className="trade-muted">{t('trade.formula')}</p>
    <p className="trade-muted">{t('trade.estimateHint')}</p>
    {quote.staleRates && <p role="status">{t('trade.staleRates')}</p>}
  </div>;
}

export function ProposalCards({ title, cards, currency }) {
  const { t } = useT();
  return <section>
    <h4>{title}</h4>
    {!cards.length && <p className="trade-muted">{t('trade.noCardsOffered')}</p>}
    <ul className="trade-snapshot">{cards.map(card => <li key={card.entry_id}>
      <strong>{card.quantity}x {card.printed_name || card.name}</strong>
      <p>{card.kind === 'sealed' && `${t('trade.kind.sealed')} · ${t(`sealed.type.${card.product_type}`)} · `}
        {tradeItemDetails(card).filter(Boolean).join(' / ')}</p>
      <Money cents={card.unit_cents} currency={currency} />
    </li>)}</ul>
  </section>;
}
