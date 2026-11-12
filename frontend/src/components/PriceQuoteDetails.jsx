import { useT } from '../utils/i18n';
import { priceSource } from '../utils/marketplaceLinks';
import { exactPrintingPrice } from '../utils/availablePrintings';
import { resolveCardPrice } from '../utils/resolveCardPrice';

export default function PriceQuoteDetails({ card, printing }) {
  const { t, locale } = useT();
  if (!card || !(Number(resolveCardPrice(card, printing)) > 0) || card.market_value > 0) return null;
  const asOf = card.price_as_of ? Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(card.price_as_of) ? card.price_as_of : card.price_as_of.replace(' ', 'T') + 'Z') : NaN;
  const source = priceSource(card);
  return (
    <small style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.65rem', lineHeight: 1.4 }}>
      {source ? t('inspector.priceVia', { source: source.name, currency: source.currency }) : t('pricing.cachedQuote')}
      {printing ? ` · ${printing}` : ''}
      {printing && card.game === 'pokemon' && exactPrintingPrice(card, printing) == null ? ` · ${t('pricing.finishEstimate')}` : ''}
      {' · '}{Number.isFinite(asOf)
        ? t(Date.now() - asOf > 48 * 3600000 || asOf > Date.now() + 300000 ? 'pricing.staleAsOf' : 'pricing.asOf', { date: new Date(asOf).toLocaleString(locale) })
        : t('pricing.unknownAge')}
    </small>
  );
}
