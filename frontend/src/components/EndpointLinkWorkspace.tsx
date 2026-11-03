import { useState } from 'react';
import { useI18n } from '../i18n';
import { applyBulkNames, bulkNamePreview, spatialOrderedKeys, reorderOrderedKeys, pairwiseContinuityPreview, applyPairwiseContinuity, internalLinkPairKey, type BlueprintEditorState } from '../blueprints/editorModel';

export function EndpointLinkWorkspace({ state, onChange, onClose }: { state: BlueprintEditorState; onChange: (state: BlueprintEditorState) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [sides, setSides] = useState(() => [state.activePanelKey, state.panels.find(p => p.panel_key !== state.activePanelKey)?.panel_key ?? state.activePanelKey].map(panel => ({ panel, order: state.slots.filter(s => s.panel_key === panel).map(s => s.key), selected: [] as string[], horizontal: 'ltr' as 'ltr' | 'rtl', vertical: 'ttb' as 'ttb' | 'btt', naming: { mask: '#', start: '1', step: '1' } })));
  const [removed, setRemoved] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const patch = (index: number, value: Partial<typeof sides[number]>) => setSides(old => old.map((s, i) => i === index ? { ...s, ...value } : s));
  const keys = sides.map(side => side.order.filter(key => side.selected.includes(key)));
  const preview = pairwiseContinuityPreview(state, keys[0], keys[1], false);
  const label = (key: string) => { const slot = state.slots.find(s => s.key === key); return slot ? `${slot.display_name} · ${state.panels.find(p => p.panel_key === slot.panel_key)?.display_name}` : key; };
  return <section className="catalog-dialog" role="dialog" aria-modal="true" aria-label={t('endpointWorkspace.title')}><div className="catalog-dialog__surface endpoint-workspace">
    <h2>{t('endpointWorkspace.title')}</h2>
    <div className="endpoint-workspace__columns">{sides.map((side, index) => {
      const scoped = { ...state, activePanelKey: side.panel };
      const names = bulkNamePreview(scoped, keys[index], side.naming);
      return <section key={index} aria-label={index === 0 ? 'A' : 'B'}>
        <label>{index === 0 ? 'A' : 'B'}<select value={side.panel} onChange={e => patch(index, { panel: e.target.value, order: state.slots.filter(s => s.panel_key === e.target.value).map(s => s.key), selected: [] })}>{state.panels.map(p => <option key={p.panel_key} value={p.panel_key}>{p.display_name}</option>)}</select></label>
        <div className="endpoint-workspace__tools">
          <label>{t('blueprint.order.horizontal')}<select value={side.horizontal} onChange={e => patch(index, { horizontal: e.target.value as 'ltr' | 'rtl' })}>{(['ltr','rtl'] as const).map(v => <option key={v} value={v}>{t(`blueprint.order.${v}`)}</option>)}</select></label>
          <label>{t('blueprint.order.vertical')}<select value={side.vertical} onChange={e => patch(index, { vertical: e.target.value as 'ttb' | 'btt' })}>{(['ttb','btt'] as const).map(v => <option key={v} value={v}>{t(`blueprint.order.${v}`)}</option>)}</select></label>
          <button type="button" onClick={() => patch(index, { order: spatialOrderedKeys(scoped, side.order, side.horizontal, side.vertical) })}>{t('blueprint.order.spatial')}</button>
          <button type="button" onClick={() => patch(index, { order: [...side.order].sort((a,b) => label(a).localeCompare(label(b), undefined, { numeric: true }) || a.localeCompare(b)) })}>{t('endpointWorkspace.natural')}</button>
          <button type="button" onClick={() => patch(index, { selected: [...side.order] })}>{t('blueprint.links.selectAll')}</button>
          <button type="button" onClick={() => patch(index, { selected: [] })}>{t('blueprint.links.clearSelection')}</button>
        </div>
        <div className="endpoint-workspace__list">{side.order.map((key, row) => { const slot = state.slots.find(s => s.key === key)!; const links = state.individualLinks.filter(l => l.from_slot_key === key || l.to_slot_key === key); return <div key={key} className="endpoint-workspace__row" data-endpoint-row={key}>
          <label><input type="checkbox" checked={side.selected.includes(key)} onChange={e => patch(index, { selected: e.target.checked ? [...side.selected, key] : side.selected.filter(k => k !== key) })} />{slot.display_name}</label>
          <small>{t(slot.kind === 'NETWORK_PORT' ? 'blueprint.endpoint.networkPort' : 'blueprint.endpoint.connectionPoint')} · {links.length} ↔ {links.map(l => label(l.from_slot_key === key ? l.to_slot_key : l.from_slot_key)).join(', ')}</small>
          <span>{names?.find(n => n.key === key)?.display_name && `→ ${names.find(n => n.key === key)!.display_name}`}</span>
          <button type="button" aria-label={t('blueprint.order.up', { index: row + 1 })} disabled={!row} onClick={() => patch(index, { order: reorderOrderedKeys(side.order, row, -1) })}>↑</button>
          <button type="button" aria-label={t('blueprint.order.down', { index: row + 1 })} disabled={row === side.order.length - 1} onClick={() => patch(index, { order: reorderOrderedKeys(side.order, row, 1) })}>↓</button>
        </div>; })}</div>
        <div className="endpoint-workspace__tools">{(['mask','start','step'] as const).map(field => <label key={field}>{t(`blueprint.naming.${field}`)}<input value={side.naming[field]} onChange={e => patch(index, { naming: { ...side.naming, [field]: e.target.value } })} /></label>)}</div>
        {!names && <p role="alert">{t('blueprint.naming.invalid')}</p>}
        <button type="button" disabled={!names?.length} onClick={() => { const renamed = applyBulkNames(scoped, keys[index], side.naming); onChange({ ...renamed, activePanelKey: state.activePanelKey }); }}>{t('blueprint.naming.apply')}</button>
      </section>;
    })}</div>
    {preview.error && <p role="status">{t(`blueprint.pairwise.error.${preview.error}`)}</p>}
    <div className="endpoint-workspace__preview">{preview.pairs.map((p,i) => <div key={i}>{label(p.from_slot_key)} ↔ {label(p.to_slot_key)}</div>)}</div>
    <button type="button" disabled={!!preview.error} onClick={() => { onChange(applyPairwiseContinuity(state, keys[0], keys[1], false)); setStatus(t('endpointWorkspace.applied')); }}>{t(keys[0].length === 1 && keys[1].length === 1 ? 'blueprint.composition.addLink' : 'blueprint.pairwise.apply')}</button>
    <p role="status">{status}</p>
    <h3>{t('blueprint.composition.links')} · {state.individualLinks.length}</h3>
    <div className="endpoint-workspace__preview">{state.individualLinks.map(l => { const id = internalLinkPairKey(l.from_slot_key,l.to_slot_key); return <div key={id}><label><input type="checkbox" checked={removed.includes(id)} onChange={e => setRemoved(e.target.checked ? [...removed,id] : removed.filter(k => k !== id))} />{label(l.from_slot_key)} ↔ {label(l.to_slot_key)}</label><button type="button" onClick={() => onChange({ ...state, individualLinks: state.individualLinks.filter(link => link !== l) })}>{t('blueprint.composition.remove')}</button></div>; })}</div>
    <div className="catalog-dialog__actions">
      <button type="button" onClick={() => setRemoved(state.individualLinks.map(l => internalLinkPairKey(l.from_slot_key,l.to_slot_key)))}>{t('blueprint.links.selectAll')}</button>
      <button type="button" disabled={!removed.length} onClick={() => { onChange({ ...state, individualLinks: state.individualLinks.filter(l => !removed.includes(internalLinkPairKey(l.from_slot_key,l.to_slot_key))) }); setRemoved([]); }}>{t('blueprint.links.deleteSelected', { count: removed.length })}</button>
      <button type="button" autoFocus onClick={onClose}>{t('action.close')}</button>
    </div>
  </div></section>;
}
