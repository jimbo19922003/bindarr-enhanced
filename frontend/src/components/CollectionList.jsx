import { useState, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Search, Trash2, Edit2, LayoutGrid, List, SlidersHorizontal, X, MousePointerClick, Plus, EyeOff, Heart } from 'lucide-react';
import { getCardDisplayName, translateJapaneseName } from '../utils/langHelper';
import { priceText, reportingTotal, reportingTotalText, subscribeCurrency, currencyRevision } from '../utils/formatPrice';
import { CONDITIONS, PRINTINGS, GRADERS, getLanguageNamesForGame, getLanguagesForGame } from '../utils/cardOptions';
import { getPrintingBadgeLabel, getPrintingBadgeStyle, getFoilOverlayClass } from '../utils/cardPrinting';
import { getCardRarityBorder, getRarityBadgeLabel, getRarityBadgeStyle } from '../utils/cardRarity';
import { sortCardsByOrder } from '../utils/cardSort';
import { sortCardsBySetNumber } from '../utils/setCardOrder';
import { inspectorCardForSetCard } from '../utils/setCardEntries';
import { useMultiSelect } from '../utils/useMultiSelect';
import { defaultGameFilter, gameOptions, GAMES, isGameEnabled, showGamePicker } from '../utils/games';
import { langCode } from '../utils/languages';
import { preferredPrinting } from '../utils/availablePrintings';
import { useT } from '../utils/i18n';
import CardInspectorModal from './CardInspectorModal';
import QuickAddDrawer from './QuickAddDrawer';
import CustomSetEditor from './CustomSetEditor';
import AddToDeckSelect from './AddToDeckSelect';
import PackPriceSplitter from './PackPriceSplitter';
import CardImage from './CardImage';
import MultiSelectDropdown from './MultiSelectDropdown';
import { duplicateCardIds, missingArtwork } from '../utils/collectionFilters';
import { refreshCardArtIndex, useCardArtIndexState } from '../utils/cardArt';

const labelStyle = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' };

// Maps each Sort By option to sortCardsByOrder criteria so ordering matches the
// storage engine (set = chronological via setsList, type = POKEMON_TYPE_ORDER or
// the MTG card-type order, color = WUBRG).
// 'qty-desc' isn't a card-order scheme, handled separately.
const SORT_CRITERIA = {
  'added-newest': [{ by: 'added_at', dir: 'desc' }, { by: 'entry_id', dir: 'desc' }],
  'added-oldest': [{ by: 'added_at', dir: 'asc' }],
  'name-asc': [{ by: 'name', dir: 'asc' }],
  'name-desc': [{ by: 'name', dir: 'desc' }],
  'price-desc': [{ by: 'price', dir: 'desc' }],
  'price-asc': [{ by: 'price', dir: 'asc' }],
  'set-asc': [{ by: 'set', dir: 'asc' }, { by: 'number', dir: 'asc' }],
  'number-asc': [{ by: 'number', dir: 'asc' }, { by: 'name', dir: 'asc' }],
  'rarity-desc': [{ by: 'rarity', dir: 'desc' }, { by: 'name', dir: 'asc' }],
  'rarity-asc': [{ by: 'rarity', dir: 'asc' }, { by: 'name', dir: 'asc' }],
  // Magic: card type (Creature, Instant, Land...); Pokémon: energy type.
  'type-asc': [{ by: 'type', dir: 'asc' }, { by: 'name', dir: 'asc' }],
  // Colour identity in WUBRG order, then Multicolor, then Colorless — the
  // storage engine's colour buckets. 'type' stopped meaning colour for Magic (#88).
  'color-asc': [{ by: 'color', dir: 'asc' }, { by: 'name', dir: 'asc' }],
  'language-asc': [{ by: 'language', dir: 'asc' }, { by: 'name', dir: 'asc' }],
  'favorite-first': [{ by: 'favorite', dir: 'desc' }, { by: 'added_at', dir: 'desc' }],
};
const setKey = (set) => `${set.game || 'pokemon'}:${set.id}`;
const CUSTOM_PREFIX = 'custom:';
const WISHLIST_CHUNK = 25;
const slotKey = (card) => `${card.id}|${card.slot_printing || ''}`;

// Small labelled field wrapper to keep the filter grid uniform.
function Field({ label, children }) {
  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function CollectionList({ statsTrigger, onUpdate, showToast, selectedCardFilter, setSelectedCardFilter, onNavigate, setSelectedLocationId, setFocusEntryId, collectionSetNavigation, onSetNavigationHandled }) {
  const { t } = useT();
  const fxRevision = useSyncExternalStore(subscribeCurrency, currencyRevision, () => 0);
  const artworkIndex = useCardArtIndexState();
  const [collection, setCollection] = useState([]);
  const [locations, setLocations] = useState([]);
  const [setsList, setSetsList] = useState([]);
  const [availableSets, setAvailableSets] = useState([]);
  const [selectedSetKey, setSelectedSetKey] = useState('');
  const [setViewGame, setSetViewGame] = useState('pokemon');
  const [setViewLanguage, setSetViewLanguage] = useState('English');
  const [setCards, setSetCards] = useState([]);
  const [setCardsLoading, setSetCardsLoading] = useState(false);
  const [setCardsError, setSetCardsError] = useState('');
  const [customSets, setCustomSets] = useState([]);
  const [customSetData, setCustomSetData] = useState(null);
  const [customRevision, setCustomRevision] = useState(0);
  // undefined = closed, null = new set, object = editing that set
  const [editingCustomSet, setEditingCustomSet] = useState(undefined);
  const [addCard, setAddCard] = useState(null);
  const [wishlistProgress, setWishlistProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (selectedCardFilter) {
      setSearchFilter(selectedCardFilter);
      // Reset after applying so they can clear search manually
      setSelectedCardFilter('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCardFilter]);

  // UX view state
  const [viewMode, setViewMode] = useState('gallery'); // 'gallery' or 'list'
  const [inspectorCard, setInspectorCard] = useState(null);
  const [inspectorStartEdit, setInspectorStartEdit] = useState(false);
  const [subTab, setSubTab] = useState('collection'); // 'collection', 'wishlist', 'sets'
  const [showFilters, setShowFilters] = useState(false);

  // Search & Filter state
  const [searchFilter, setSearchFilter] = useState('');
  // '' | 'pokemon' | 'mtg'. Falls back to a visible game if the Settings default
  // has since been hidden.
  const [gameFilter, setGameFilter] = useState(() => (isGameEnabled(localStorage.getItem('default_game')) ? localStorage.getItem('default_game') : defaultGameFilter()));
  const [locationFilter, setLocationFilter] = useState([]);
  const [rarityFilter, setRarityFilter] = useState([]);
  const [conditionFilter, setConditionFilter] = useState([]);
  const [graderFilter, setGraderFilter] = useState([]);
  const [printingFilter, setPrintingFilter] = useState([]);
  const [setFilter, setSetFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [supertypeFilter, setSupertypeFilter] = useState([]);
  const [cmcFilter, setCmcFilter] = useState([]);
  const [languageFilter, setLanguageFilter] = useState([]);
  const [minPriceFilter, setMinPriceFilter] = useState('');
  const [maxPriceFilter, setMaxPriceFilter] = useState('');
  const [sortBy, setSortBy] = useState('added-newest');
  const [tradeOnly, setTradeOnly] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [notCheckedOutOnly, setNotCheckedOutOnly] = useState(false);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [missingArtworkOnly, setMissingArtworkOnly] = useState(false);
  const selectedCustomId = selectedSetKey.startsWith(CUSTOM_PREFIX)
    ? Number(selectedSetKey.slice(CUSTOM_PREFIX.length))
    : null;
  const selectedCustomSet = customSets.find(set => set.id === selectedCustomId) || null;
  const selectedSet = useMemo(
    () => availableSets.find(set => setKey(set) === selectedSetKey) || null,
    [availableSets, selectedSetKey]
  );

  // Stacking state (default to stacked)
  const [stackCards, setStackCards] = useState(true);
  const [stackByCondition, setStackByCondition] = useState(false);
  const [stackByPrinting, setStackByPrinting] = useState(false);

  // Multi-select / bulk actions — shared long-press + /api/collection/bulk logic.
  const {
    selectMode, setSelectMode, selectedIds, setSelectedIds, toggleSelect, selectAt, clearSelection, exitSelectMode,
    bulkMoveTarget, setBulkMoveTarget, pressHandlers, longPressFired, runBulk,
  } = useMultiSelect({ showToast, onChanged: () => { onUpdate(); fetchCollection(); } });

  useEffect(() => {
    // The Sets tab needs the collection too: owned tiles open these entries.
    fetchCollection();
    fetchLocations();
    fetchSets();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsTrigger, subTab]);

  useEffect(() => {
    if (!collectionSetNavigation) return;
    setSetViewGame(collectionSetNavigation.game || 'pokemon');
    setSetViewLanguage('English');
    setSelectedSetKey(`${collectionSetNavigation.game || 'pokemon'}:${collectionSetNavigation.setId}`);
    setSubTab('sets');
    onSetNavigationHandled?.();
  }, [collectionSetNavigation, onSetNavigationHandled]);

  useEffect(() => {
    if (subTab !== 'sets') return undefined;

    let active = true;
    const fetchAvailableSets = async () => {
      setAvailableSets([]);
      try {
        const query = new URLSearchParams({ game: setViewGame, lang: langCode(setViewLanguage) });
        const response = await fetch(`/api/sets?${query}`);
        if (!response.ok) throw new Error(`Set list request failed: ${response.status}`);
        const sets = await response.json();
        if (!Array.isArray(sets)) throw new Error('Set list response was not an array');
        if (active) setAvailableSets(sets);
      } catch (error) {
        console.error('Error fetching available sets:', error);
        if (active) showToast(t('common.errBackend'));
      }
    };
    fetchAvailableSets();
    return () => { active = false; };
  }, [setViewGame, setViewLanguage, showToast, subTab, t]);

  const fetchCollection = async () => {
    try {
      setLoading(true);
      let url = '/api/collection?list_type=collection';
      if (subTab === 'wishlist') {
        url = '/api/collection?list_type=wishlist';
      }
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setCollection(data);
      }
    } catch (err) {
      console.error(err);
      showToast(t('collection.errLoad'));
    } finally {
      setLoading(false);
    }
  };

  const fetchLocations = async () => {
    try {
      const response = await fetch('/api/locations');
      if (response.ok) {
        const data = await response.json();
        setLocations(data);
      }
    } catch (err) {
      console.error('Error fetching locations:', err);
    }
  };

  const fetchSets = async () => {
    try {
      const response = await fetch('/api/sets');
      if (response.ok) setSetsList(await response.json());
    } catch (err) {
      console.error('Error fetching sets:', err);
    }
  };

  useEffect(() => {
    if (subTab !== 'sets' || !selectedSet) {
      setSetCards([]);
      setSetCardsError('');
      setSetCardsLoading(false);
      return undefined;
    }

    let active = true;
    const fetchCachedSetCards = async () => {
      setSetCardsLoading(true);
      setSetCardsError('');
      try {
        const query = new URLSearchParams({
          game: selectedSet.game || 'pokemon',
          lang: langCode(setViewLanguage),
        });
        const response = await fetch(`/api/collection/sets/${encodeURIComponent(selectedSet.id)}/cards?${query}`);
        if (!response.ok) throw new Error(t('collection.setCardsError'));
        const cards = await response.json();
        if (active) setSetCards(cards);
      } catch (error) {
        console.error('Error fetching cached set cards:', error);
        if (active) {
          setSetCards([]);
          setSetCardsError(t('collection.setCardsError'));
        }
      } finally {
        if (active) setSetCardsLoading(false);
      }
    };
    fetchCachedSetCards();
    return () => { active = false; };
  }, [selectedSet, setViewLanguage, statsTrigger, subTab, t]);

  useEffect(() => {
    if (subTab !== 'sets') return undefined;
    let active = true;
    fetch(`/api/custom-sets?${new URLSearchParams({ game: setViewGame })}`)
      .then(r => (r.ok ? r.json() : []))
      .then(rows => { if (active) setCustomSets(Array.isArray(rows) ? rows : []); })
      .catch(err => console.error('Error fetching custom sets:', err));
    return () => { active = false; };
  }, [setViewGame, subTab, customRevision]);

  useEffect(() => {
    if (subTab !== 'sets' || !selectedCustomId) {
      setCustomSetData(null);
      return undefined;
    }
    let active = true;
    const fetchCustomSetCards = async () => {
      setSetCardsLoading(true);
      setSetCardsError('');
      try {
        const query = new URLSearchParams({ lang: langCode(setViewLanguage) });
        const response = await fetch(`/api/custom-sets/${selectedCustomId}/cards?${query}`);
        if (!response.ok) throw new Error(t('collection.setCardsError'));
        const data = await response.json();
        if (active) setCustomSetData(data);
      } catch (error) {
        console.error('Error fetching custom set cards:', error);
        if (active) {
          setCustomSetData(null);
          setSetCardsError(t('collection.setCardsError'));
        }
      } finally {
        if (active) setSetCardsLoading(false);
      }
    };
    fetchCustomSetCards();
    return () => { active = false; };
  }, [selectedCustomId, setViewLanguage, statsTrigger, subTab, customRevision, t]);

  const handleDelete = async (entryId, cardName) => {
    if (!window.confirm(t('collection.confirmDeleteCard', { name: cardName }))) {
      return;
    }

    try {
      const response = await fetch(`/api/collection/${entryId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        showToast(t('collection.cardRemoved', { name: cardName }));
        onUpdate();
      } else {
        showToast(t('collection.errDelete'));
      }
    } catch (err) {
      console.error(err);
      showToast(t('common.errBackend'));
    }
  };

  const openEdit = (item) => {
    setInspectorCard(item);
    setInspectorStartEdit(true);
  };

  // Tap: swallowed if a long-press just armed selection; otherwise toggle (in
  // select mode) or open the inspector.
  const activateCard = (item, event) => {
    if (longPressFired.current) { longPressFired.current = false; return; }
    if (selectMode) selectAt(item.entry_id, displayCards.map(i => i.entry_id), event?.shiftKey);
    else { setInspectorCard(item); setInspectorStartEdit(false); }
  };

  const openSetCard = (card) => {
    const target = inspectorCardForSetCard(card, collection);
    if (!target) return;
    setInspectorCard(target);
    setInspectorStartEdit(false);
  };

  const activateSetCard = (card) => {
    if (card.owned) openSetCard(card);
    else setAddCard(card);
  };

  // Wishlist rows use the slot's printing in per-printing custom sets, otherwise
  // the card's usual printing. Sent in chunks so progress can be shown and one
  // request never carries a whole set.
  const addToWishlist = async (cards) => {
    if (!cards.length || wishlistProgress) return;
    const groups = new Map();
    for (const card of cards) {
      const printing = card.slot_printing || preferredPrinting(card);
      const language = card.language || setViewLanguage;
      const key = `${printing}|${language}`;
      if (!groups.has(key)) groups.set(key, { printing, language, ids: [] });
      const group = groups.get(key);
      if (!group.ids.includes(card.id)) group.ids.push(card.id);
    }
    const total = [...groups.values()].reduce((sum, group) => sum + group.ids.length, 0);
    let added = 0;
    let failed = 0;
    setWishlistProgress({ done: 0, total });
    try {
      for (const { printing, language, ids } of groups.values()) {
        for (let i = 0; i < ids.length; i += WISHLIST_CHUNK) {
          const chunk = ids.slice(i, i + WISHLIST_CHUNK);
          try {
            const res = await fetch('/api/collection/bulk-add', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ card_ids: chunk, list_type: 'wishlist', printing, language, quantity: 1, condition: 'Near Mint', purchase_price: null }),
            });
            const body = await res.json().catch(() => ({}));
            const ok = Number(body.added) || 0;
            added += ok;
            failed += chunk.length - ok;
          } catch (err) {
            console.error('Wishlist add failed:', err);
            failed += chunk.length;
          }
          setWishlistProgress({ done: added + failed, total });
        }
      }
    } finally {
      setWishlistProgress(null);
    }
    showToast(failed
      ? t('customSet.wishlistPartial', { added, failed })
      : t('customSet.wishlistAdded', { count: added }));
    if (added) onUpdate();
  };

  const addMissingToWishlist = () => {
    const missing = orderedSetCards.filter(card => !card.owned && !card.wishlisted);
    if (!missing.length) return;
    if (!window.confirm(t('customSet.wishlistConfirm', { count: missing.length }))) return;
    addToWishlist(missing);
  };

  const excludeFromCustomSet = async (card) => {
    if (!selectedCustomId) return;
    try {
      const res = await fetch(`/api/custom-sets/${selectedCustomId}/cards/${encodeURIComponent(card.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'exclude' }),
      });
      if (!res.ok) throw new Error('exclude failed');
      showToast(t('customSet.excluded', { name: card.name }));
      setCustomRevision(r => r + 1);
    } catch (err) {
      console.error(err);
      showToast(t('customSet.errSave'));
    }
  };

  const handleViewStorage = (card) => {
    setInspectorCard(null);
    if (setSelectedLocationId) {
      setSelectedLocationId(card.location_id || 'unsorted');
    }
    if (setFocusEntryId) {
      setFocusEntryId(card.entry_id || card.id);
    }
    if (onNavigate) {
      onNavigate('storage');
    }
  };

  // Extract unique filter values from the loaded collection.
  const uniqueRarities = useMemo(
    () => Array.from(new Set(collection.map(item => item.rarity).filter(Boolean))).sort(),
    [collection]
  );
  const uniqueSets = useMemo(
    () => Array.from(new Set(collection.map(item => item.set_name).filter(Boolean))).sort(),
    [collection]
  );
  const uniqueTypes = useMemo(
    () => Array.from(new Set(collection.flatMap(item => item.types || []).filter(Boolean))).sort(),
    [collection]
  );
  const uniqueSupertypes = useMemo(
    () => Array.from(new Set(collection.map(item => item.supertype).filter(Boolean))).sort(),
    [collection]
  );
  const uniqueLanguages = useMemo(
    () => Array.from(new Set(collection.map(item => item.language).filter(Boolean))).sort(),
    [collection]
  );
  const uniqueCmcs = useMemo(
    () => Array.from(new Set(collection.map(item => item.cmc).filter(v => v !== null && v !== undefined))).sort((a, b) => a - b),
    [collection]
  );
  const duplicateIds = useMemo(() => duplicateCardIds(collection), [collection]);

  const activeFilterCount =
    [locationFilter, rarityFilter, conditionFilter, graderFilter, printingFilter,
    setFilter, typeFilter, supertypeFilter, cmcFilter, languageFilter]
      .filter(v => v.length > 0).length
    + (gameFilter !== '' ? 1 : 0)
    + (minPriceFilter !== '' ? 1 : 0)
    + (maxPriceFilter !== '' ? 1 : 0)
    + (tradeOnly ? 1 : 0)
    + (favoriteOnly ? 1 : 0)
    + (notCheckedOutOnly ? 1 : 0)
    + (duplicatesOnly ? 1 : 0)
    + (missingArtworkOnly ? 1 : 0);

  const clearAllFilters = () => {
    setSearchFilter('');
    setGameFilter('');
    setLocationFilter([]); setRarityFilter([]); setConditionFilter([]); setGraderFilter([]);
    setPrintingFilter([]); setSetFilter([]); setTypeFilter([]); setSupertypeFilter([]);
    setCmcFilter([]); setLanguageFilter([]);
    setMinPriceFilter(''); setMaxPriceFilter('');
    setTradeOnly(false); setFavoriteOnly(false);
    setNotCheckedOutOnly(false);
    setDuplicatesOnly(false); setMissingArtworkOnly(false);
  };

  // Filter + sort
  const filteredCollection = useMemo(() => {
    const translatedSearch = searchFilter ? (translateJapaneseName(searchFilter) || searchFilter).toLowerCase() : '';
    // The raw query is matched against the localized name as well as the
    // translated one: a Japanese Magic card is stored under its English `name`,
    // so typing 稲妻 only finds it via printed_name.
    const rawSearch = searchFilter.toLowerCase();
    const result = collection.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(translatedSearch) ||
                            (item.printed_name || '').toLowerCase().includes(rawSearch) ||
                            (item.set_name || '').toLowerCase().includes(translatedSearch) ||
                            (item.number || '').includes(searchFilter);
      const matchesLocation = locationFilter.length === 0 ? true :
                              locationFilter.some(f => f === 'unassigned' ? !item.location_id : item.location_id == f);
      // "All games" still means only the games the user has chosen to see: a hidden
      // game's cards stay in the collection (and in exports) but are out of view.
      const itemGame = item.game || 'pokemon';
      const matchesGame = gameFilter === '' ? isGameEnabled(itemGame) : itemGame === gameFilter;
      const matchesRarity = rarityFilter.length === 0 ? true : rarityFilter.includes(item.rarity);
      const matchesCondition = conditionFilter.length === 0 ? true : conditionFilter.includes(item.condition);
      const matchesPrinting = printingFilter.length === 0 ? true : printingFilter.includes(item.printing);
      const matchesSet = setFilter.length === 0 ? true : setFilter.includes(item.set_name);
      const matchesType = typeFilter.length === 0 ? true : typeFilter.some(t => (item.types || []).includes(t));
      const matchesSupertype = supertypeFilter.length === 0 ? true : supertypeFilter.includes(item.supertype);
      const matchesCmc = cmcFilter.length === 0 ? true : cmcFilter.includes(String(item.cmc));
      const matchesLanguage = languageFilter.length === 0 ? true : languageFilter.includes(item.language);
      const matchesFavorite = favoriteOnly ? item.favorite === 1 : true;
      // Rows written before grading existed have a NULL grader, which means raw —
      // so the comparison defaults rather than treating NULL as its own category.
      const itemGrader = item.grader || 'Raw';
      const matchesGrader = graderFilter.length === 0 ? true
        : graderFilter.some(f => f === '__graded' ? itemGrader !== 'Raw' : itemGrader === f);

      const price = item.price_trend || 0;
      const matchesMinPrice = minPriceFilter === '' ? true : price >= parseFloat(minPriceFilter);
      const matchesMaxPrice = maxPriceFilter === '' ? true : price <= parseFloat(maxPriceFilter);
      const matchesNotCheckedOut = !notCheckedOutOnly || (item.checked_out_qty || 0) === 0;
      const matchesTrade = !tradeOnly || item.is_trade === 1;
      const matchesDuplicates = !duplicatesOnly || duplicateIds.has(item.card_id);
      const matchesArtwork = !missingArtworkOnly || (artworkIndex.status === 'ready' && missingArtwork(item, artworkIndex.ids));

      return matchesSearch && matchesGame && matchesLocation && matchesRarity && matchesCondition &&
             matchesPrinting && matchesSet && matchesType && matchesSupertype &&
             matchesCmc && matchesLanguage && matchesFavorite && matchesGrader && matchesMinPrice && matchesMaxPrice &&
             matchesNotCheckedOut && matchesTrade && matchesDuplicates && matchesArtwork;
    });

    if (sortBy === 'qty-desc') {
      result.sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
    } else {
      sortCardsByOrder(result, SORT_CRITERIA[sortBy] || SORT_CRITERIA['added-newest'], undefined, setsList);
    }
    return result;
  }, [collection, searchFilter, gameFilter, locationFilter, rarityFilter, conditionFilter, printingFilter, setFilter, typeFilter, supertypeFilter, cmcFilter, languageFilter, favoriteOnly, graderFilter, minPriceFilter, maxPriceFilter, notCheckedOutOnly, tradeOnly, duplicatesOnly, duplicateIds, missingArtworkOnly, artworkIndex, sortBy, setsList]);

  // Group duplicate cards if stack option is active
  const processedCollection = useMemo(() => {
    if (!stackCards) return filteredCollection;

    const groups = {};
    filteredCollection.forEach(item => {
      let key = item.card_id;
      if (stackByCondition) key += `-${item.condition}`;
      if (stackByPrinting) key += `-${item.printing}`;

      // stack_entries keeps the real rows so the inspector can pick which
      // print/copy to edit or sell instead of always the first one.
      if (!groups[key]) {
        groups[key] = { ...item, stack_entries: [item] };
      } else {
        groups[key].quantity += item.quantity;
        groups[key].stack_entries.push(item);
      }
    });
    return Object.values(groups);
  }, [filteredCollection, stackCards, stackByCondition, stackByPrinting]);

  // In select mode, render the unstacked list so every entry is individually
  // selectable and bulk actions hit real entry_ids (stacking merges rows).
  const displayCards = selectMode ? filteredCollection : processedCollection;

  const totalValue = useMemo(
    () => reportingTotal(displayCards),
    // Recalculate when rates or the selected currency change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayCards, fxRevision]
  );
  // Custom sets come back ordered (and split per printing) by the server.
  const orderedSetCards = useMemo(
    () => (selectedCustomId ? customSetData?.cards || [] : sortCardsBySetNumber(setCards)),
    [selectedCustomId, customSetData, setCards]
  );
  const hasSetSelection = Boolean(selectedSet || selectedCustomSet);
  const ownedSetCardCount = orderedSetCards.filter(card => card.owned).length;
  const wishableSetCardCount = orderedSetCards.filter(card => !card.owned && !card.wishlisted).length;
  const setProgressPercent = orderedSetCards.length
    ? Math.round(ownedSetCardCount / orderedSetCards.length * 100)
    : 0;

  return (
    <div>
      {/* Header: sub-tabs + selection hint + view toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className={`btn ${subTab === 'collection' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSubTab('collection')}
            style={{ fontSize: '0.85rem', padding: '0.45rem 1.25rem', borderRadius: 'var(--radius-sm)' }}
          >
            {t('nav.collection')}
          </button>
          <button
            className={`btn ${subTab === 'wishlist' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSubTab('wishlist')}
            style={{ fontSize: '0.85rem', padding: '0.45rem 1.25rem', borderRadius: 'var(--radius-sm)' }}
          >
            {t('collection.wishlist')}
          </button>
          <button
            className={`btn ${subTab === 'sets' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSubTab('sets')}
            style={{ fontSize: '0.85rem', padding: '0.45rem 1.25rem', borderRadius: 'var(--radius-sm)' }}
          >
            {t('collection.sets')}
          </button>
        </div>

        {subTab !== 'sets' && <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Multi-select toggle (long-press cards is the primary path) */}
          <button
            className={`btn ${selectMode ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.9rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            title={t('collection.selectHint')}
          >
            <MousePointerClick size={14} />
            {t(selectMode ? 'bulk.done' : 'collection.select')}
          </button>

          {/* View Toggle */}
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-glass)' }}>
            <button
              className={`btn btn-icon-only ${viewMode === 'gallery' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('gallery')}
              style={{ borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.5rem', width: '32px', height: '32px' }}
              title={t('collection.galleryView')}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              className={`btn btn-icon-only ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('list')}
              style={{ borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.5rem', width: '32px', height: '32px' }}
              title={t('collection.listView')}
            >
              <List size={14} />
            </button>
          </div>
        </div>}
      </div>

      {subTab === 'sets' ? (
        <div>
          <div className="glass-panel" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.75rem' }}>
              <h3 className="chart-title" style={{ margin: 0, flexBasis: '100%' }}>{t('collection.setViewTitle')}</h3>
              <Field label={t('catalog.thGame')}>
                <select
                  className="select-control"
                  value={setViewGame}
                  onChange={(event) => {
                    setSetViewGame(event.target.value);
                    setSetViewLanguage('English');
                    setSelectedSetKey('');
                  }}
                  aria-label={t('catalog.thGame')}
                >
                  {GAMES.map(game => <option key={game.value} value={game.value}>{game.label}</option>)}
                </select>
              </Field>
              <Field label={t('card.language')}>
                <select
                  className="select-control"
                  value={setViewLanguage}
                  onChange={(event) => {
                    setSetViewLanguage(event.target.value);
                    // Custom sets span every set, so they survive a language change.
                    setSelectedSetKey(key => (key.startsWith(CUSTOM_PREFIX) ? key : ''));
                  }}
                  aria-label={t('card.language')}
                >
                  {getLanguagesForGame(setViewGame).map(language => (
                    <option key={language.code} value={language.name}>{language.name}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('collection.setPicker')}>
              <select
                className="select-control"
                value={selectedSetKey}
                onChange={(event) => setSelectedSetKey(event.target.value)}
                aria-label={t('collection.selectSet')}
                style={{ minWidth: 'min(100%, 18rem)' }}
              >
                <option value="">{t('collection.selectSet')}</option>
                {customSets.length > 0 && (
                  <optgroup label={t('customSet.group')}>
                    {customSets.map(set => (
                      <option key={`custom-${set.id}`} value={`${CUSTOM_PREFIX}${set.id}`}>{set.name}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={t('customSet.standardGroup')}>
                  {availableSets.map(set => (
                    <option key={setKey(set)} value={setKey(set)}>{set.name}</option>
                  ))}
                </optgroup>
              </select>
              </Field>
              {selectedCustomSet && (
                <button type="button" className="btn btn-secondary" onClick={() => setEditingCustomSet(selectedCustomSet)}>
                  <Edit2 size={14} /> {t('customSet.edit')}
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => setEditingCustomSet(null)}>
                <Plus size={14} /> {t('customSet.new')}
              </button>
              {hasSetSelection && !setCardsLoading && wishableSetCardCount > 0 && (
                <button type="button" className="btn btn-secondary" onClick={addMissingToWishlist} disabled={Boolean(wishlistProgress)}>
                  <Heart size={14} />
                  {wishlistProgress
                    ? t('customSet.wishlistProgress', { done: wishlistProgress.done, total: wishlistProgress.total })
                    : t('customSet.wishlistMissing', { count: wishableSetCardCount })}
                </button>
              )}
            </div>
            {hasSetSelection && !setCardsLoading && !setCardsError && orderedSetCards.length > 0 && (
              <p style={{ margin: '0.85rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                {t(selectedCustomSet?.completion_mode === 'printing' ? 'customSet.printingProgressSummary' : 'collection.setProgressSummary', {
                  owned: ownedSetCardCount,
                  total: orderedSetCards.length,
                  percent: setProgressPercent,
                })}
              </p>
            )}
            {selectedCustomSet && customSetData?.truncated && (
              <p role="status" style={{ margin: '0.5rem 0 0', color: 'var(--accent-yellow)', fontSize: '0.8rem' }}>{t('customSet.truncated')}</p>
            )}
            {hasSetSelection && !setCardsLoading && orderedSetCards.length > 0 && (
              <p style={{ margin: '0.35rem 0 0', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{t('customSet.tileHint')}</p>
            )}
          </div>

          {setCardsLoading ? (
            <div className="spinner"></div>
          ) : setCardsError ? (
            <div className="glass-panel" role="alert" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
              {setCardsError}
            </div>
          ) : !hasSetSelection ? (
            <div className="glass-panel" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
              {t('collection.selectSet')}
            </div>
          ) : orderedSetCards.length === 0 ? (
            <div className="glass-panel" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
              {selectedCustomSet ? t('customSet.empty') : t('collection.noSetCards')}
            </div>
          ) : (
            <div className="card-grid">
              {orderedSetCards.map(card => (
                <div
                  key={slotKey(card)}
                  className="tcg-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`${card.name} #${card.number}${card.slot_printing ? ` · ${card.slot_printing}` : ''} — ${t(card.owned ? 'collection.setCardOwned' : 'customSet.addThisCard')}`}
                  onClick={() => activateSetCard(card)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      activateSetCard(card);
                    }
                  }}
                  title={card.owned ? undefined : t('customSet.addThisCard')}
                  style={{ opacity: card.owned ? 1 : card.wishlisted ? 0.7 : 0.45, filter: card.owned ? undefined : card.wishlisted ? 'grayscale(0.5)' : 'grayscale(1)', cursor: 'pointer' }}
                >
                  <div className="tcg-card-inner">
                    <CardImage card={card} className="tcg-card-image" loading="lazy" draggable={false} />
                    {!card.owned && !card.wishlisted && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon-only"
                        onClick={(event) => { event.stopPropagation(); addToWishlist([card]); }}
                        disabled={Boolean(wishlistProgress)}
                        title={t('customSet.wishlistOne')}
                        aria-label={`${t('customSet.wishlistOne')}: ${card.name}`}
                        style={{ position: 'absolute', bottom: '4px', right: '4px', zIndex: 11, width: '24px', height: '24px', padding: 0 }}
                      >
                        <Heart size={12} />
                      </button>
                    )}
                    {selectedCustomSet && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon-only"
                        onClick={(event) => { event.stopPropagation(); excludeFromCustomSet(card); }}
                        title={t('customSet.exclude')}
                        aria-label={`${t('customSet.exclude')}: ${card.name}`}
                        style={{ position: 'absolute', top: '4px', right: '4px', zIndex: 11, width: '24px', height: '24px', padding: 0 }}
                      >
                        <EyeOff size={12} />
                      </button>
                    )}
                    <span style={{
                      position: 'absolute',
                      top: '6px',
                      left: '6px',
                      zIndex: 10,
                      padding: '2px 5px',
                      borderRadius: '3px',
                      fontSize: '0.6rem',
                      fontWeight: 800,
                      color: 'var(--text-strong)',
                      background: card.owned ? 'var(--accent-green, var(--accent-blue))' : card.wishlisted ? 'var(--accent-red)' : 'var(--bg-secondary)',
                    }}>
                      {t(card.owned ? 'collection.setCardOwned' : card.wishlisted ? 'customSet.wishlisted' : 'collection.setCardMissing')}
                    </span>
                  </div>
                  <div className="tcg-card-info">
                    <div className="tcg-card-name">{getCardDisplayName(card.name, card.language, card.printed_name)}</div>
                    <div className="tcg-card-meta">
                      <span>#{card.number}</span>
                      {selectedCustomSet && card.set_name && <span>{card.set_name}</span>}
                      {card.slot_printing && <span>{card.slot_printing}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
      <>
      {/* Filter Panel */}
      <div className="glass-panel" style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem' }}>
        {/* Always-visible top bar: search + sort + filters toggle */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.5fr) minmax(150px, 1fr) auto', gap: '0.75rem', alignItems: 'flex-end' }}>
          <Field label={t('collection.searchLabel')}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="input-control"
                placeholder={t('collection.searchPlaceholder')}
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                style={{ width: '100%', paddingLeft: '2.5rem' }}
              />
              <Search size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>
          </Field>

          <Field label={t('collection.sortBy')}>
            <select className="select-control" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {['added-newest', 'added-oldest', 'name-asc', 'name-desc', 'price-desc', 'price-asc', 'qty-desc', 'set-asc', 'number-asc', 'type-asc', 'color-asc', 'rarity-desc', 'rarity-asc', 'language-asc', 'favorite-first']
                .map(key => <option key={key} value={key}>{t(`collection.sort.${key}`)}</option>)}
            </select>
          </Field>

          <button
            className={`btn ${showFilters ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowFilters(s => !s)}
            style={{ padding: '0.5rem 0.9rem', height: '40px', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}
          >
            <SlidersHorizontal size={15} />
            {t('collection.filters')}
            {activeFilterCount > 0 && (
              <span style={{ background: 'var(--accent-red)', color: 'var(--text-strong)', fontSize: '0.65rem', fontWeight: 900, borderRadius: '999px', padding: '1px 7px', minWidth: '18px', textAlign: 'center' }}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-glass)' }}>
            {/* Selector filters grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem' }}>
              {/* Nothing to filter when only one game is shown. */}
              {showGamePicker() && (
                <Field label={t('collection.fGame')}>
                  <select className="select-control" value={gameFilter} onChange={(e) => setGameFilter(e.target.value)}>
                    <option value="">{t('collection.allGames')}</option>
                    {gameOptions().map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </Field>
              )}

              <Field label={t('collection.fLocation')}>
                <MultiSelectDropdown
                  label={t('collection.fLocation')}
                  allLabel={t('collection.allLocations')}
                  value={locationFilter}
                  onChange={setLocationFilter}
                  options={[
                    { value: 'unassigned', label: t('bulk.unassignedPile') },
                    ...locations.map(loc => ({ value: loc.id, label: loc.name }))
                  ]}
                />
              </Field>

              <Field label={t('collection.fSet')}>
                <MultiSelectDropdown
                  label={t('collection.fSet')}
                  allLabel={t('collection.allSets')}
                  value={setFilter}
                  onChange={setSetFilter}
                  options={uniqueSets.map(s => ({ value: s, label: s }))}
                />
              </Field>

              <Field label={t('collection.fSupertype')}>
                <MultiSelectDropdown
                  label={t('collection.fSupertype')}
                  allLabel={t('collection.allSupertypes')}
                  value={supertypeFilter}
                  onChange={setSupertypeFilter}
                  options={uniqueSupertypes.map(s => ({ value: s, label: s }))}
                />
              </Field>

              <Field label={t('collection.fType')}>
                <MultiSelectDropdown
                  label={t('collection.fType')}
                  allLabel={t('collection.allTypes')}
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={uniqueTypes.map(t => ({value: t, label: t}))}
                />
              </Field>

              <Field label={t('collection.fRarity')}>
                <MultiSelectDropdown
                  label={t('collection.fRarity')}
                  allLabel={t('collection.allRarities')}
                  value={rarityFilter}
                  onChange={setRarityFilter}
                  options={uniqueRarities.map(r => ({value: r, label: r}))}
                />
              </Field>

              <Field label={t('card.condition')}>
                <MultiSelectDropdown
                  label={t('card.condition')}
                  allLabel={t('collection.allConditions')}
                  value={conditionFilter}
                  onChange={setConditionFilter}
                  options={CONDITIONS.map(c => ({value: c, label: c}))}
                />
              </Field>

              <Field label={t('card.printing')}>
                <MultiSelectDropdown
                  label={t('card.printing')}
                  allLabel={t('collection.allPrintings')}
                  value={printingFilter}
                  onChange={setPrintingFilter}
                  options={PRINTINGS.map(p => ({value: p, label: p}))}
                />
              </Field>

              {/* 'Any graded' earns its own entry above the per-company options:
                  "show me my slabs" is the question people actually ask, and
                  answering it otherwise means selecting each grader in turn. */}
              <Field label={t('card.grader')}>
                <MultiSelectDropdown
                  label={t('card.grader')}
                  allLabel={t('collection.allGraders')}
                  value={graderFilter}
                  onChange={setGraderFilter}
                  options={[
                    { value: '__graded', label: t('collection.anyGraded') },
                    ...GRADERS.map(g => ({ value: g, label: g === 'Raw' ? t('card.graderRaw') : g }))
                  ]}
                />
              </Field>

              {uniqueCmcs.length > 0 && (
                <Field label={t('collection.fManaValue')}>
                  <MultiSelectDropdown
                    label={t('collection.fManaValue')}
                    allLabel={t('collection.allManaValues')}
                    value={cmcFilter}
                    onChange={setCmcFilter}
                    options={uniqueCmcs.map(c => ({ value: String(c), label: String(c) }))}
                  />
                </Field>
              )}

              <Field label={t('card.language')}>
                <MultiSelectDropdown
                  label={t('card.language')}
                  allLabel={t('collection.allLanguages')}
                  value={languageFilter}
                  onChange={setLanguageFilter}
                  options={uniqueLanguages.map(l => ({ value: l, label: l }))}
                />
              </Field>

              <Field label={t('collection.fMinPrice')}>
                <input type="number" className="input-control" placeholder={t('collection.minPricePlaceholder')} value={minPriceFilter} onChange={(e) => setMinPriceFilter(e.target.value)} />
              </Field>

              <Field label={t('collection.fMaxPrice')}>
                <input type="number" className="input-control" placeholder={t('collection.maxPricePlaceholder')} value={maxPriceFilter} onChange={(e) => setMaxPriceFilter(e.target.value)} />
              </Field>
            </div>

            {/* Options row: stacking + trade + clear */}
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border-glass)', paddingTop: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="stackCardsOpt" checked={stackCards} onChange={(e) => setStackCards(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <label htmlFor="stackCardsOpt" style={{ cursor: 'pointer', margin: 0, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-strong)' }}>
                  {t('collection.stackDuplicates')}
                </label>
              </div>

              {stackCards && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input type="checkbox" id="stackByConditionOpt" checked={stackByCondition} onChange={(e) => setStackByCondition(e.target.checked)} style={{ width: '14px', height: '14px', cursor: 'pointer' }} />
                    <label htmlFor="stackByConditionOpt" style={{ cursor: 'pointer', margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {t('collection.splitByCondition')}
                    </label>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input type="checkbox" id="stackByPrintingOpt" checked={stackByPrinting} onChange={(e) => setStackByPrinting(e.target.checked)} style={{ width: '14px', height: '14px', cursor: 'pointer' }} />
                    <label htmlFor="stackByPrintingOpt" style={{ cursor: 'pointer', margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {t('collection.splitByPrinting')}
                    </label>
                  </div>
                </>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="tradeOnlyOpt" checked={tradeOnly} onChange={(e) => setTradeOnly(e.target.checked)} style={{ width: '14px', height: '14px', cursor: 'pointer' }} />
                <label htmlFor="tradeOnlyOpt" style={{ cursor: 'pointer', margin: 0, fontSize: '0.75rem', color: 'var(--accent-yellow)', fontWeight: 600 }}>
                  {t('collection.tradeOnly')}
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="favoriteOnlyOpt" checked={favoriteOnly} onChange={(e) => setFavoriteOnly(e.target.checked)} style={{ width: '14px', height: '14px', cursor: 'pointer' }} />
                <label htmlFor="favoriteOnlyOpt" style={{ cursor: 'pointer', margin: 0, fontSize: '0.75rem', color: '#facc15', fontWeight: 600 }}>
                  {t('collection.favoritesOnly')}
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="duplicatesOnlyOpt" checked={duplicatesOnly} onChange={(e) => setDuplicatesOnly(e.target.checked)} />
                <label htmlFor="duplicatesOnlyOpt" style={{ cursor: 'pointer', margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }} title={t('collection.duplicatesHint')}>
                  {t('collection.duplicatesOnly')}
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="missingArtworkOnlyOpt" checked={missingArtworkOnly} onChange={(e) => { setMissingArtworkOnly(e.target.checked); if (e.target.checked) void refreshCardArtIndex(); }} />
                <label htmlFor="missingArtworkOnlyOpt" style={{ cursor: 'pointer', margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }} title={t('collection.missingArtworkHint')}>
                  {t('collection.missingArtworkOnly')}
                </label>
              </div>

              {subTab === 'collection' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" id="notCheckedOutOpt" checked={notCheckedOutOnly} onChange={(e) => setNotCheckedOutOnly(e.target.checked)} style={{ width: '14px', height: '14px', cursor: 'pointer' }} />
                  <label htmlFor="notCheckedOutOpt" style={{ cursor: 'pointer', margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    {t('collection.notInCheckedOutDeck')}
                  </label>
                </div>
              )}

              {activeFilterCount > 0 && (
                <button className="btn btn-secondary" onClick={clearAllFilters} style={{ marginLeft: 'auto', fontSize: '0.72rem', padding: '0.3rem 0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <X size={13} /> {t('collection.clearFilters')}
                </button>
              )}
            </div>
            {missingArtworkOnly && artworkIndex.status !== 'ready' && (
              <div role={artworkIndex.status === 'error' ? 'alert' : 'status'}>
                {artworkIndex.status === 'error' ? t('collection.artworkIndexError') : t('collection.artworkIndexLoading')}
                {artworkIndex.status === 'error' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refreshCardArtIndex()}>{t('dash.retry')}</button>}
              </div>
            )}
            {duplicatesOnly && <small style={{ color: 'var(--text-secondary)' }}>{t('collection.duplicatesHint')}</small>}
            {missingArtworkOnly && <small style={{ color: 'var(--text-secondary)' }}>{t('collection.missingArtworkHint')}</small>}
          </div>
        )}
      </div>

      {/* Result summary bar */}
      {!loading && !selectMode && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', fontSize: '0.78rem', color: 'var(--text-secondary)', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span><strong style={{ color: 'var(--text-strong)' }}>{displayCards.length}</strong> {t('collection.cardUnit', { count: displayCards.length })}</span>
          <span>{t('collection.totalValue')} <strong style={{ color: 'var(--accent-yellow)' }}>{reportingTotalText(totalValue)}</strong></span>
        </div>
      )}

      {/* Bulk action bar */}
      {selectMode && (
        <div className="glass-panel bulk-action-bar" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', position: 'sticky', top: '0.5rem', zIndex: 30 }}>
          <span style={{ fontWeight: 800, color: 'var(--text-strong)', fontSize: '0.85rem' }}>{t('bulk.selected', { count: selectedIds.size })}</span>
          <button className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }} onClick={() => setSelectedIds(new Set(filteredCollection.map(i => i.entry_id)))}>{t('bulk.selectAll', { count: filteredCollection.length })}</button>
          <button className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }} onClick={clearSelection}>{t('bulk.clear')}</button>
          <div style={{ width: '1px', height: '22px', background: 'var(--border-glass)' }} />
          <button className="btn btn-danger" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }} disabled={!selectedIds.size} onClick={() => runBulk('delete', null, t('bulk.confirmDelete', { count: selectedIds.size }))}>{t('bulk.delete')}</button>
          <button className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }} disabled={!selectedIds.size} onClick={() => runBulk('trade', null)}>{t('bulk.markTrade')}</button>
          <button className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }} disabled={!selectedIds.size} onClick={() => runBulk('untrade', null)}>{t('bulk.untrade')}</button>
          <button className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }} disabled={!selectedIds.size} onClick={() => runBulk('list_type', subTab === 'wishlist' ? 'collection' : 'wishlist', null)}>{t(subTab === 'wishlist' ? 'bulk.moveToCollection' : 'bulk.moveToWishlist')}</button>
          <div style={{ width: '1px', height: '22px', background: 'var(--border-glass)' }} />
          <select className="select-control" value="" disabled={!selectedIds.size} onChange={(e) => { if (e.target.value) runBulk('condition', e.target.value); e.target.value = ''; }} style={{ fontSize: '0.72rem', maxWidth: '150px', padding: '0.3rem 0.4rem' }}>
            <option value="">{t('bulk.setCondition')}</option>
            {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="select-control" value="" disabled={!selectedIds.size} onChange={(e) => { if (e.target.value) runBulk('printing', e.target.value); e.target.value = ''; }} style={{ fontSize: '0.72rem', maxWidth: '150px', padding: '0.3rem 0.4rem' }}>
            <option value="">{t('bulk.setPrinting')}</option>
            {PRINTINGS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="select-control" value="" disabled={!selectedIds.size} onChange={(e) => { if (e.target.value) runBulk('language', e.target.value); e.target.value = ''; }} style={{ fontSize: '0.72rem', maxWidth: '150px', padding: '0.3rem 0.4rem' }}>
            <option value="">{t('bulk.setLanguage')}</option>
            {getLanguageNamesForGame(gameFilter).map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <div style={{ width: '1px', height: '22px', background: 'var(--border-glass)' }} />
          <PackPriceSplitter
            entryIds={Array.from(selectedIds)}
            showToast={showToast}
            onApplied={() => { clearSelection(); onUpdate(); fetchCollection(); }}
          />
          <select className="select-control" value={bulkMoveTarget} onChange={(e) => setBulkMoveTarget(e.target.value)} style={{ fontSize: '0.72rem', maxWidth: '170px', padding: '0.3rem 0.4rem' }}>
            <option value="">{t('bulk.moveToContainer')}</option>
            <option value="unassign">{t('bulk.unassignedPile')}</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className="btn btn-primary" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }} disabled={!bulkMoveTarget || !selectedIds.size} onClick={() => runBulk('move', bulkMoveTarget === 'unassign' ? null : bulkMoveTarget)}>{t('bulk.applyMove')}</button>
          <div style={{ width: '1px', height: '22px', background: 'var(--border-glass)' }} />
          <AddToDeckSelect
            onAdd={(id) => runBulk('add_to_deck', id)}
            disabled={!selectedIds.size}
            style={{ fontSize: '0.72rem', maxWidth: '160px', padding: '0.3rem 0.4rem' }}
          />
          <button className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem', marginLeft: 'auto' }} onClick={exitSelectMode}>{t('bulk.done')}</button>
        </div>
      )}

      {loading ? (
        <div className="spinner"></div>
      ) : displayCards.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '3rem 1.5rem' }}>
          <p>{t('collection.noMatches')} {t(activeFilterCount > 0 ? 'collection.noMatchesFiltered' : 'collection.noMatchesEmpty')}</p>
        </div>
      ) : viewMode === 'gallery' ? (
        /* Visual Cards Grid Gallery View */
        <div className="card-grid">
          {displayCards.map((item) => {
            const rarityStyle = getCardRarityBorder(item.rarity);
            const selected = selectedIds.has(item.entry_id);

            return (
              <div
                key={item.entry_id}
                className="tcg-card tilt-card-wrapper"
                style={{ cursor: 'pointer', touchAction: 'pan-y' }}
                onClick={(e) => activateCard(item, e)}
                {...pressHandlers(item.entry_id)}
              >
                <div className="tcg-card-inner" style={{ ...rarityStyle, ...(selected ? { outline: '3px solid var(--accent-red)', outlineOffset: '2px' } : {}) }}>
                  {selectMode && (
                    <div style={{ position: 'absolute', top: '6px', right: '6px', zIndex: 20, width: '22px', height: '22px', borderRadius: '50%', background: selected ? 'var(--accent-red)' : 'rgba(0,0,0,0.6)', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-strong)', fontSize: '0.8rem', fontWeight: 900 }}>{selected ? '✓' : ''}</div>
                  )}
                  <CardImage card={item} className="tcg-card-image" loading="lazy" draggable={false} />
                  {getFoilOverlayClass(item.printing) && (
                    <div className={getFoilOverlayClass(item.printing)} style={{ borderRadius: 'var(--radius-sm)' }} />
                  )}
                  {item.quantity > 1 && (
                    <div className="tcg-card-quantity-tag">x{item.quantity}</div>
                  )}

                  {/* Rarity badge (shared tier system, matches Storage view) */}
                  <span style={{
                    position: 'absolute',
                    top: '6px',
                    left: '6px',
                    fontSize: '0.55rem',
                    fontWeight: 900,
                    padding: '2px 4px',
                    borderRadius: '3px',
                    zIndex: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                    ...getRarityBadgeStyle(item.rarity)
                  }}>
                    {getRarityBadgeLabel(item.rarity)}
                  </span>

                  {/* Overlay Tags */}
                  <div style={{
                    position: 'absolute',
                    bottom: '6px',
                    left: '6px',
                    right: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '4px',
                    pointerEvents: 'none'
                  }}>
                    {/* One badge in this slot, not two: a slab's grade replaces the
                        condition rather than sitting beside it, because they answer
                        the same question and the grader's answer is the one that
                        counts. Coloured, because 'PSA 10' in the same grey as 'NM'
                        would bury the distinction that matters most in a grid. */}
                    {item.grader && item.grader !== 'Raw' ? (
                      <span style={{
                        fontSize: '0.6rem',
                        fontWeight: 800,
                        padding: '2px 5px',
                        borderRadius: '3px',
                        background: 'rgba(250, 204, 21, 0.9)',
                        color: '#1a1a1a',
                        border: '1px solid rgba(255, 255, 255, 0.25)',
                        textTransform: 'uppercase'
                      }}>
                        {item.grader}{item.grade != null ? ` ${item.grade}` : ''}
                      </span>
                    ) : (
                      <span style={{
                        fontSize: '0.6rem',
                        fontWeight: 800,
                        padding: '2px 5px',
                        borderRadius: '3px',
                        background: 'rgba(0, 0, 0, 0.75)',
                        color: 'var(--text-strong)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        textTransform: 'uppercase'
                      }}>
                        {item.condition === 'Near Mint' ? 'NM' :
                         item.condition === 'Lightly Played' ? 'LP' :
                         item.condition === 'Moderately Played' ? 'MP' :
                         item.condition === 'Heavily Played' ? 'HP' : 'DMG'}
                      </span>
                    )}
                    {item.printing !== 'Normal' && (
                      <span style={{
                        fontSize: '0.6rem',
                        fontWeight: 800,
                        padding: '2px 5px',
                        borderRadius: '3px',
                        ...getPrintingBadgeStyle(item.printing),
                        border: '1px solid rgba(255, 255, 255, 0.2)'
                      }}>
                        {getPrintingBadgeLabel(item.printing)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="tcg-card-info">
                  <div className="tcg-card-name">{getCardDisplayName(item.name, item.language, item.printed_name)}</div>
                  <div className="tcg-card-meta">
                    <span style={{ fontSize: '0.7rem' }}>{item.set_name} • #{item.number}</span>
                    <span className="tcg-card-price">{priceText(item.price_trend, item.price_currency)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Traditional List Table View */
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowY: 'auto' }}>
            <table className="collection-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>{t('collection.colCard')}</th>
                  <th style={{ width: '70px', textAlign: 'right' }}>{t('collection.colQtyValue')}</th>
                </tr>
              </thead>
              <tbody>
                {displayCards.map((item) => {
                  const selected = selectedIds.has(item.entry_id);
                  return (
                  <tr key={item.entry_id} style={selected ? { background: 'rgba(255,71,71,0.12)' } : undefined}>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {selectMode && (
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleSelect(item.entry_id)}
                            style={{ width: '18px', height: '18px', flexShrink: 0, cursor: 'pointer' }}
                          />
                        )}
                        <div
                          onClick={(e) => activateCard(item, e)}
                          {...pressHandlers(item.entry_id)}
                          style={{ position: 'relative', width: '36px', height: '50px', flexShrink: 0, overflow: 'hidden', borderRadius: '4px', cursor: 'pointer', touchAction: 'pan-y', ...getCardRarityBorder(item.rarity) }}
                        >
                          <CardImage card={item} className="collection-row-thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} draggable={false} />
                          {getFoilOverlayClass(item.printing) && (
                            <div className={getFoilOverlayClass(item.printing)} style={{ borderRadius: '4px' }} />
                          )}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div onClick={(e) => activateCard(item, e)} {...pressHandlers(item.entry_id)} style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{getCardDisplayName(item.name, item.language, item.printed_name)}</div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <span>{item.set_name} • #{item.number}</span>
                            <span style={{ fontSize: '0.55rem', fontWeight: 800, padding: '1px 3px', borderRadius: '3px', flexShrink: 0, ...getRarityBadgeStyle(item.rarity) }}>
                              {getRarityBadgeLabel(item.rarity)}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                            {item.printing} • {item.condition}
                          </div>
                          {!selectMode && (
                            <div style={{ display: 'flex', gap: '0.35rem', marginTop: '2px' }}>
                              <button className="btn btn-secondary btn-icon-only" style={{ width: '18px', height: '18px', padding: 0, borderRadius: '3px' }} onClick={() => openEdit(item)} title={t('common.edit')}>
                                <Edit2 size={9} />
                              </button>
                              <button className="btn btn-danger btn-icon-only" style={{ width: '18px', height: '18px', padding: 0, borderRadius: '3px' }} onClick={() => handleDelete(item.entry_id, getCardDisplayName(item.name, item.language, item.printed_name))} title={t('common.delete')}>
                                <Trash2 size={9} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', verticalAlign: 'top', paddingTop: '0.6rem' }}>
                      {item.quantity > 1 && (
                        <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: '0.85rem' }}>x{item.quantity}</div>
                      )}
                      <div style={{ fontSize: '0.7rem', color: 'var(--accent-yellow)', fontWeight: 600 }}>{priceText(item.price_trend, item.price_currency)}</div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}

      {/* Card Detail Inspector Modal (Private Authorized View) */}
      <CardInspectorModal
        card={inspectorCard}
        startInEdit={inspectorStartEdit}
        onClose={() => { setInspectorCard(null); setInspectorStartEdit(false); }}
        onUpdate={onUpdate}
        showToast={showToast}
        onViewStorage={handleViewStorage}
      />

      <QuickAddDrawer
        card={addCard}
        game={addCard?.game || setViewGame}
        defaults={{ printing: addCard?.slot_printing || undefined, language: addCard?.language || setViewLanguage }}
        onClose={() => setAddCard(null)}
        onAdded={() => onUpdate()}
        showToast={showToast}
      />

      {editingCustomSet !== undefined && (
        <CustomSetEditor
          key={editingCustomSet?.id ?? 'new'}
          set={editingCustomSet}
          game={setViewGame}
          language={setViewLanguage}
          availableSets={availableSets}
          excluded={editingCustomSet && editingCustomSet.id === selectedCustomId ? customSetData?.excluded || [] : []}
          onClose={() => setEditingCustomSet(undefined)}
          onSaved={(saved) => {
            setEditingCustomSet(undefined);
            setCustomRevision(r => r + 1);
            setSelectedSetKey(`${CUSTOM_PREFIX}${saved.id}`);
          }}
          onDeleted={() => {
            setEditingCustomSet(undefined);
            setSelectedSetKey('');
            setCustomRevision(r => r + 1);
          }}
          onChanged={() => setCustomRevision(r => r + 1)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

export default CollectionList;
