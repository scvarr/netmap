import { useState } from 'react';
import { useI18n } from '../i18n';
import type { AutomaticLocationLayout, SavedMap } from '../topology/savedMapTypes';
import type { LocationDocument } from '../topology/locationTypes';

export function AutomaticLocationControls({ map, locations, objectLabels, onSave }: { map: SavedMap; objectLabels?: ReadonlyMap<string, string>; locations: readonly LocationDocument[]; onSave: (settings: AutomaticLocationLayout | null) => Promise<void> }) {
  const { t } = useI18n();
  const settings = map.variants.find(v => v.variant_ref.entity_id === map.active_variant_ref.entity_id)?.automatic_layout;
  const [container, setContainer] = useState('root');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const save = async (next: AutomaticLocationLayout | null) => { setBusy(true); setError(false); try {
    const parents = new Map([...locations.map(l => ['Location:' + l.location_ref.entity_id, l.parent_location_ref?.entity_id ?? 'root'] as const), ...map.placements.map(p => ['PhysicalObject:' + p.physical_object_ref.entity_id, p.location_ref?.entity_id ?? 'root'] as const)]);
    const containers = next ? Object.fromEntries(Object.entries(next.containers).filter(([id]) => id === 'root' || locations.some(l => l.location_ref.entity_id === id)).map(([id, entry]) => [id, { ...entry, order: entry.order.filter(key => parents.get(key) === id) }])) : {};
    await onSave(next ? { ...next, containers } : null);
  } catch { setError(true); } finally { setBusy(false); } };
  const validContainer = locations.some(l => l.location_ref.entity_id === container) ? container : 'root';
  const entry = settings?.containers[validContainer] ?? { direction: 'VERTICAL' as const, order: [] };
  const children = [...locations.filter(l => (l.parent_location_ref?.entity_id ?? 'root') === validContainer).map(l => ({ key: 'Location:' + l.location_ref.entity_id, label: l.name })),
    ...map.placements.filter(p => (p.location_ref?.entity_id ?? 'root') === validContainer).map((p, i) => ({ key: 'PhysicalObject:' + p.physical_object_ref.entity_id, label: objectLabels?.get(p.physical_object_ref.entity_id) ?? t('autoLocation.object', { number: String(i + 1) }) }))]
    .sort((a,b) => { const ai = entry.order.indexOf(a.key), bi = entry.order.indexOf(b.key); return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) || a.key.localeCompare(b.key); });
  const update = (change: Partial<typeof entry>) => settings && void save({ ...settings, containers: { ...settings.containers, [validContainer]: { ...entry, ...change } } });
  return <fieldset className="automatic-location-controls" disabled={busy}>
    <label><input type="checkbox" checked={Boolean(settings)} onChange={e => void save(e.target.checked ? { hide_empty: false, containers: {} } : null)} />{t('autoLocation.enabled')}</label>
    {settings && <>
      <label><input type="checkbox" checked={settings.hide_empty} onChange={e => void save({ ...settings, hide_empty: e.target.checked })} />{t('autoLocation.hideEmpty')}</label>
      <select aria-label={t('autoLocation.container')} value={validContainer} onChange={e => setContainer(e.target.value)}><option value="root">{t('autoLocation.root')}</option>{locations.map(l => <option key={l.location_ref.entity_id} value={l.location_ref.entity_id}>{l.name}</option>)}</select>
      <select aria-label={t('autoLocation.direction')} value={entry.direction} onChange={e => update({ direction: e.target.value as typeof entry.direction })}><option value="VERTICAL">{t('autoLocation.vertical')}</option><option value="HORIZONTAL">{t('autoLocation.horizontal')}</option></select>
      {children.map((child, i) => <div className="automatic-location-controls__row" key={child.key}><span>{child.label}</span><span className="map-utility-panel__actions"><button type="button" aria-label={t('autoLocation.up')} disabled={!i} onClick={() => { const order = children.map(c => c.key); [order[i-1],order[i]] = [order[i],order[i-1]]; update({ order }); }}>↑</button><button type="button" aria-label={t('autoLocation.down')} disabled={i === children.length - 1} onClick={() => { const order = children.map(c => c.key); [order[i+1],order[i]] = [order[i],order[i+1]]; update({ order }); }}>↓</button></span></div>)}
    </>}
    {error && <span role="alert">{t('autoLocation.error')}</span>}
  </fieldset>;
}
