import { useState, useRef, useEffect } from 'react';
import { X, Maximize2 } from 'lucide-react';
import confetti from 'canvas-confetti';
import { priceText } from '../utils/formatPrice';
import CardEntryFields from './CardEntryFields';
import CardImageZoom from './CardImageZoom';
import CardImage from './CardImage';
import { getCardDisplayName } from '../utils/langHelper';
import { preferredPrinting } from '../utils/availablePrintings';
import { resolveCardPrice } from '../utils/resolveCardPrice';
import PriceQuoteDetails from './PriceQuoteDetails';
import { langName, isEnglish, displayName, translatedName, setCode } from '../utils/languages';
import { useT } from '../utils/i18n';

// The single-card "Add to collection" sheet, shared by Search and the Sets view.
// The form is keyed by card so every open starts from the given defaults.
function QuickAddForm({ card: initialCard, game, defaults, allowWishlist, onClose, onAdded, showToast, onZoom }) {
  const { t } = useT();
  const [card, setCard] = useState(initialCard);
  const [quantity, setQuantity] = useState(defaults.quantity ?? 1);
  const [condition, setCondition] = useState(defaults.condition || 'Near Mint');
  const [printing, setPrinting] = useState(() => preferredPrinting(initialCard, defaults.printing));
  const [language, setLanguage] = useState(initialCard.language || defaults.language || langName('en'));
  const [purchasePrice, setPurchasePrice] = useState(0);
  const [grader, setGrader] = useState('Raw');
  const [grade, setGrade] = useState('');
  const [certNumber, setCertNumber] = useState('');
  const [languageLoading, setLanguageLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const languageRequest = useRef(0);
  const cardGame = card.game || game;
  useEffect(() => {
    if (card.game !== 'pokemon' || !card.id.startsWith('tcgdex-en-')) { setQuoteLoading(false); return; }
    let active = true;
    setQuoteLoading(true);
    fetch(`/api/cards/${encodeURIComponent(card.id)}/price-quote`).then(async response => {
      if (!response.ok) throw new Error(t('pricing.refreshFailed'));
      const quote = await response.json();
      if (active) setCard(previous => ({ ...previous, ...quote }));
    }).catch(error => {
      console.error('Card quote request failed:', error);
      if (active) showToast(t('pricing.refreshFailed'));
    }).finally(() => { if (active) setQuoteLoading(false); });
    return () => { active = false; };
  }, [card.id, card.game, showToast, t]);

  const handleLanguageChange = async (newLang) => {
    const ticket = ++languageRequest.current;
    setLanguageLoading(true);
    try {
      const resp = await fetch(`/api/cards/${encodeURIComponent(card.id)}/printing?lang=${encodeURIComponent(newLang)}&game=${encodeURIComponent(cardGame)}`);
      if (!resp.ok) throw new Error('Could not load the selected language');
      const localized = await resp.json();
      if (!localized?.id) throw new Error('Could not load the selected language');
      if (ticket !== languageRequest.current) return;
      const next = { ...card, ...localized, available_printings: localized.available_printings ?? null, language: newLang };
      setCard(next);
      setLanguage(newLang);
      setPrinting(previous => preferredPrinting(next, previous));
    } catch (e) {
      console.warn('Could not switch to localized printing:', e);
      if (ticket === languageRequest.current) showToast(e.message);
    } finally {
      if (ticket === languageRequest.current) setLanguageLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (languageLoading || quoteLoading || saving) return;
    const wishlist = allowWishlist && e.nativeEvent.submitter?.value === 'wishlist';
    setSaving(true);
    try {
      const response = await fetch('/api/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: card.id,
          quantity: parseInt(quantity, 10),
          condition,
          printing,
          language,
          purchase_price: wishlist || purchasePrice === '' ? null : Number(purchasePrice),
          list_type: wishlist ? 'wishlist' : 'collection',
          location_id: null,
          grader,
          grade: grade === '' ? null : parseFloat(grade),
          cert_number: certNumber.trim() || null
        })
      });

      if (response.ok) {
        showToast(wishlist ? t('customSet.wishlistAdded', { count: Number(quantity) }) : t('search.addedToCollection', { name: displayName(card) }));
        const rarity = (card.rarity || '').toLowerCase();
        const price = card.price_trend || 0;
        if (!wishlist && (rarity.includes('holo') || rarity.includes('secret') || rarity.includes('ultra') || price > 10)) {
          confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });
        }
        onAdded?.(card);
        onClose();
      } else {
        // A rejected cert number (already in the collection) explains itself; the
        // generic message would send the user back to re-type a correct number.
        const body = await response.json().catch(() => null);
        showToast(body?.error || t('search.errAddDb'));
      }
    } catch (err) {
      console.error(err);
      showToast(t('search.errSave'));
    } finally {
      setSaving(false);
    }
  };

  const price = resolveCardPrice(card, printing) || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
        <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <h3 style={{ color: 'var(--text-strong)', fontSize: '1.25rem', margin: 0, wordBreak: 'break-word' }}>{t('search.addCardTitle')}</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0.25rem 0 0 0', wordBreak: 'break-word' }}>
            {getCardDisplayName(card.name, language, card.printed_name, cardGame)}
            {translatedName(card) && <span style={{ color: 'var(--text-muted)' }}> ({translatedName(card)})</span>}
            {' '}({card.set_name}
            {/* Code only where the set name isn't readable to an English speaker. */}
            {!isEnglish(card.language) && setCode(card) ? ` / ${setCode(card)}` : ''}
            {' • '}#{card.number})
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-icon-only" onClick={onClose} aria-label={t('common.close')} style={{ borderRadius: '50%', flexShrink: 0 }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)', width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
        {/* Tap the art to enlarge, same as the collection inspector. */}
        <div
          onClick={() => onZoom(card)}
          title={t('inspector.zoomHint')}
          style={{ position: 'relative', flexShrink: 0, cursor: 'pointer', lineHeight: 0 }}
        >
          <CardImage card={card} style={{ width: '75px', aspectRatio: 0.718, objectFit: 'cover', borderRadius: 'var(--radius-sm)', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }} />
          <div style={{
            position: 'absolute', bottom: '4px', right: '4px',
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
            padding: '2px 4px', borderRadius: '4px', color: '#fff',
            display: 'flex', alignItems: 'center', pointerEvents: 'none',
            border: '1px solid rgba(255,255,255,0.15)'
          }}>
            <Maximize2 size={11} />
          </div>
        </div>
        <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('pricing.marketReference', { printing })}</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--accent-yellow)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{price == null ? t('card.printingUnpriced') : priceText(price, card.price_currency)}</div>
          <PriceQuoteDetails card={card} printing={printing} />
          {quoteLoading && <small>{t('pricing.refreshing')}</small>}
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t('search.rarityLabel')} <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{card.rarity}</span></div>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
        <CardEntryFields
          quantity={quantity} purchasePrice={purchasePrice} condition={condition} printing={printing} language={language}
          onQuantity={setQuantity} onPurchasePrice={setPurchasePrice} onCondition={setCondition} onPrinting={setPrinting} onLanguage={handleLanguageChange}
          game={cardGame} card={card}
          grader={grader} grade={grade} certNumber={certNumber}
          onGrader={setGrader} onGrade={setGrade} onCertNumber={setCertNumber}
        />

        <div className="quick-add-footer" style={{ marginTop: '1.25rem', paddingTop: '1rem' }}>
          <div className="quick-add-footer-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={languageLoading || quoteLoading || saving}>{t('search.addToCollection')}</button>
            {allowWishlist && <button type="submit" value="wishlist" className="btn btn-secondary" disabled={languageLoading || quoteLoading || saving}>{t('customSet.wishlistOne')}</button>}
          </div>
        </div>
      </form>
    </div>
  );
}

// `defaults` seeds quantity/condition/language/printing; a printing the card
// doesn't come in falls back to its preferred one.
export default function QuickAddDrawer({ card, game, defaults = {}, allowWishlist = false, onClose, onAdded, showToast }) {
  const [zoomCard, setZoomCard] = useState(null);
  const open = Boolean(card);
  const close = () => { setZoomCard(null); onClose(); };
  return (
    <>
      <div className={`drawer-backdrop ${open ? 'open' : ''}`} onClick={close}></div>
      <div className={`quick-add-drawer ${open ? 'open' : ''}`}>
        {card && (
          <QuickAddForm
            key={`${card.id}|${defaults.printing || ''}`}
            card={card} game={game} defaults={defaults} allowWishlist={allowWishlist}
            onClose={close} onAdded={onAdded} showToast={showToast} onZoom={setZoomCard}
          />
        )}
      </div>
      {/* Outside the drawer on purpose: .quick-add-drawer is transformed, and a
          transformed ancestor becomes the containing block for position:fixed,
          which would trap this overlay inside the drawer instead of the page. */}
      {zoomCard && card && <CardImageZoom card={zoomCard} onClose={() => setZoomCard(null)} />}
    </>
  );
}
