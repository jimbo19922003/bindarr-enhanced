import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Search, RefreshCw, Undo2 } from 'lucide-react';
import { langCode } from '../utils/languages';
import { useT } from '../utils/i18n';
import CardImage from './CardImage';

const EMPTY_RULES = { names: [], illustrators: [], set_ids: [], rarities: [] };
const listStyle = { display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.4rem' };
const chipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.15rem 0.5rem',
  borderRadius: '999px', fontSize: '0.75rem', background: 'var(--surface-2, var(--bg-secondary))',
  border: '1px solid var(--border-glass)', color: 'var(--text-strong)',
};
const sectionLabel = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' };

function Chips({ values, label = value => value, onRemove }) {
  if (!values.length) return null;
  return (
    <div style={listStyle}>
      {values.map(value => (
        <span key={value} style={chipStyle}>
          {label(value)}
          <button type="button" className="btn-icon-only" onClick={() => onRemove(value)} aria-label={`✕ ${label(value)}`}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

// One free-text rule list (names, illustrators, rarities) with optional
// suggestions from cards Bindarr has already cached.
function TermRule({ id, label, hint, values, onChange, suggestions }) {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    if (value && !values.some(v => v.toLowerCase() === value.toLowerCase())) onChange([...values, value]);
    setDraft('');
  };
  return (
    <div>
      <label htmlFor={id} style={sectionLabel}>{label}</label>
      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem' }}>
        <input
          id={id} className="input-control" value={draft} list={suggestions ? `${id}-options` : undefined}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={hint} style={{ flex: 1, minWidth: 0 }}
        />
        <button type="button" className="btn btn-secondary" onClick={add} disabled={!draft.trim()}>
          <Plus size={14} /> {t('customSet.addRule')}
        </button>
      </div>
      {suggestions && (
        <datalist id={`${id}-options`}>
          {suggestions.map(s => <option key={s.value} value={s.value}>{`${s.value} (${s.cards})`}</option>)}
        </datalist>
      )}
      <Chips values={values} onRemove={value => onChange(values.filter(v => v !== value))} />
    </div>
  );
}

export default function CustomSetEditor({ set, game, language, availableSets, excluded = [], onClose, onSaved, onDeleted, onChanged, showToast }) {
  const { t } = useT();
  const [name, setName] = useState(set?.name || '');
  const [mode, setMode] = useState(set?.completion_mode || 'card');
  const [rules, setRules] = useState({ ...EMPTY_RULES, ...(set?.rules || {}) });
  const [setPick, setSetPick] = useState('');
  const [illustrators, setIllustrators] = useState([]);
  const [rarities, setRarities] = useState([]);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [includeQuery, setIncludeQuery] = useState('');
  const [includeResults, setIncludeResults] = useState(null);
  const [includeBusy, setIncludeBusy] = useState(false);
  const [restored, setRestored] = useState([]);

  useEffect(() => {
    let active = true;
    const load = async (field, apply) => {
      try {
        const res = await fetch(`/api/custom-sets-suggestions?${new URLSearchParams({ game, field })}`);
        if (res.ok && active) apply(await res.json());
      } catch { /* suggestions are optional */ }
    };
    load('illustrator', setIllustrators);
    load('rarity', setRarities);
    return () => { active = false; };
  }, [game]);

  const setRule = key => values => setRules(prev => ({ ...prev, [key]: values }));
  const setName_ = id => availableSets.find(s => s.id === id)?.name || id;

  const save = async () => {
    if (!name.trim()) { showToast(t('customSet.errName')); return; }
    setSaving(true);
    try {
      const body = { name: name.trim(), completion_mode: mode, rules };
      const res = set
        ? await fetch(`/api/custom-sets/${set.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/custom-sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, game }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) { showToast(data?.error || t('customSet.errSave')); return; }
      showToast(t('customSet.saved', { name: data.name }));
      onSaved(data);
    } catch (err) {
      console.error(err);
      showToast(t('customSet.errSave'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!set || !window.confirm(t('customSet.confirmDelete', { name: set.name }))) return;
    try {
      const res = await fetch(`/api/custom-sets/${set.id}`, { method: 'DELETE' });
      if (!res.ok) { showToast(t('customSet.errSave')); return; }
      showToast(t('customSet.deleted', { name: set.name }));
      onDeleted();
    } catch (err) {
      console.error(err);
      showToast(t('customSet.errSave'));
    }
  };

  const sync = async () => {
    if (!set) return;
    setSyncing(true);
    try {
      const res = await fetch(`/api/custom-sets/${set.id}/sync?${new URLSearchParams({ lang: langCode(language) })}`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) { showToast(data?.error || t('customSet.errSync')); return; }
      showToast(data.local ? t('customSet.syncLocal') : t('customSet.synced', { count: data.fetched }));
      onChanged();
    } catch (err) {
      console.error(err);
      showToast(t('customSet.errSync'));
    } finally {
      setSyncing(false);
    }
  };

  const searchInclude = async (event) => {
    event.preventDefault();
    if (!includeQuery.trim()) return;
    setIncludeBusy(true);
    try {
      const params = new URLSearchParams({ name: includeQuery.trim(), scope: 'internet', game, lang: langCode(language), page: 1, limit: 30 });
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data)) { showToast(data?.error || t('search.errLookup')); return; }
      setIncludeResults(data);
    } catch (err) {
      console.error(err);
      showToast(t('search.errLookup'));
    } finally {
      setIncludeBusy(false);
    }
  };

  const override = async (cardId, mode_) => {
    try {
      const res = mode_
        ? await fetch(`/api/custom-sets/${set.id}/cards/${encodeURIComponent(cardId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: mode_ }) })
        : await fetch(`/api/custom-sets/${set.id}/cards/${encodeURIComponent(cardId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) { showToast(data?.error || t('customSet.errSave')); return false; }
      onChanged();
      return true;
    } catch (err) {
      console.error(err);
      showToast(t('customSet.errSave'));
      return false;
    }
  };

  const include = async card => {
    if (await override(card.id, 'include')) showToast(t('customSet.included', { name: card.name }));
  };
  const restore = async card => {
    if (await override(card.id, null)) setRestored(prev => [...prev, card.id]);
  };
  const visibleExcluded = excluded.filter(card => !restored.includes(card.id));

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="custom-set-editor-title"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '640px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 id="custom-set-editor-title" style={{ margin: 0 }}>{set ? t('customSet.editTitle') : t('customSet.newTitle')}</h3>
          <button type="button" className="btn btn-secondary btn-icon-only" onClick={onClose} aria-label={t('common.close')} style={{ width: '28px', height: '28px', padding: 0 }}><X size={15} /></button>
        </div>

        <div>
          <label htmlFor="custom-set-name" style={sectionLabel}>{t('customSet.name')}</label>
          <input id="custom-set-name" className="input-control" value={name} maxLength={100} onChange={e => setName(e.target.value)}
            placeholder={t('customSet.namePlaceholder')} style={{ width: '100%', marginTop: '0.25rem' }} />
        </div>

        <div>
          <div style={sectionLabel}>{t('customSet.completion')}</div>
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
            {['card', 'printing'].map(value => (
              <button key={value} type="button" className={`btn ${mode === value ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={mode === value} onClick={() => setMode(value)}>
                {t(`customSet.mode.${value}`)}
              </button>
            ))}
          </div>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t(`customSet.modeHint.${mode}`)}</p>
        </div>

        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('customSet.rulesHint')}</p>

        <TermRule id="custom-set-names" label={t('customSet.ruleNames')} hint={t('customSet.ruleNamesHint')} values={rules.names} onChange={setRule('names')} />
        <TermRule id="custom-set-illustrators" label={t('customSet.ruleIllustrators')} hint={t('customSet.ruleIllustratorsHint')} values={rules.illustrators} onChange={setRule('illustrators')} suggestions={illustrators} />

        <div>
          <label htmlFor="custom-set-sets" style={sectionLabel}>{t('customSet.ruleSets')}</label>
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem' }}>
            <select id="custom-set-sets" className="select-control" value={setPick} onChange={e => setSetPick(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
              <option value="">{t('collection.selectSet')}</option>
              {availableSets.filter(s => !rules.set_ids.includes(s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" className="btn btn-secondary" disabled={!setPick}
              onClick={() => { setRule('set_ids')([...rules.set_ids, setPick]); setSetPick(''); }}>
              <Plus size={14} /> {t('customSet.addRule')}
            </button>
          </div>
          <Chips values={rules.set_ids} label={setName_} onRemove={id => setRule('set_ids')(rules.set_ids.filter(v => v !== id))} />
        </div>

        <TermRule id="custom-set-rarities" label={t('customSet.ruleRarities')} hint={t('customSet.ruleRaritiesHint')} values={rules.rarities} onChange={setRule('rarities')} suggestions={rarities} />

        {set && (
          <>
            <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.85rem' }}>
              <div style={sectionLabel}>{t('customSet.includeTitle')}</div>
              <form onSubmit={searchInclude} style={{ display: 'flex', gap: '0.4rem', marginTop: '0.25rem' }}>
                <input className="input-control" value={includeQuery} onChange={e => setIncludeQuery(e.target.value)}
                  placeholder={t('customSet.includePlaceholder')} aria-label={t('customSet.includeTitle')} style={{ flex: 1, minWidth: 0 }} />
                <button type="submit" className="btn btn-secondary" disabled={includeBusy || !includeQuery.trim()}><Search size={14} /></button>
              </form>
              {includeResults && (
                includeResults.length === 0
                  ? <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('search.noQueryMatches')}</p>
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.5rem', maxHeight: '14rem', overflowY: 'auto' }}>
                      {includeResults.map(card => (
                        <div key={card.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <CardImage card={card} style={{ width: '32px', aspectRatio: 0.718, objectFit: 'cover', borderRadius: '3px' }} loading="lazy" />
                          <span style={{ flex: 1, minWidth: 0, fontSize: '0.8rem' }}>{card.name} <span style={{ color: 'var(--text-muted)' }}>· {card.set_name} #{card.number}</span></span>
                          <button type="button" className="btn btn-secondary" onClick={() => include(card)}><Plus size={14} /> {t('customSet.include')}</button>
                        </div>
                      ))}
                    </div>
                  )
              )}
            </div>

            {visibleExcluded.length > 0 && (
              <div>
                <div style={sectionLabel}>{t('customSet.excludedTitle')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.35rem' }}>
                  {visibleExcluded.map(card => (
                    <div key={card.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: '0.8rem' }}>{card.name} <span style={{ color: 'var(--text-muted)' }}>· {card.set_name} #{card.number}</span></span>
                      <button type="button" className="btn btn-secondary" onClick={() => restore(card)}><Undo2 size={14} /> {t('customSet.restore')}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <button type="button" className="btn btn-secondary" onClick={sync} disabled={syncing || !set.rules?.names?.length}>
                <RefreshCw size={14} /> {syncing ? t('common.loading') : t('customSet.sync')}
              </button>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('customSet.syncHint')}</p>
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', borderTop: '1px solid var(--border-glass)', paddingTop: '0.85rem' }}>
          {set
            ? <button type="button" className="btn btn-secondary" onClick={remove} style={{ color: 'var(--accent-red)' }}><Trash2 size={14} /> {t('common.delete')}</button>
            : <span />}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{t('common.save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
