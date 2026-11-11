import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { applyBulkNames, bulkNamePreview, spatialOrderedKeys, reorderOrderedKeys, pairwiseContinuityPreview, applyPairwiseContinuity, internalLinkPairKey, type BlueprintEditorState } from '../blueprints/editorModel';

export function presentedLinks(state: BlueprintEditorState, sides: { panel: string; order: string[] }[], all: boolean) {
  const slots = new Map(state.slots.map(s => [s.key, s]));
  const compare = (a: string, b: string) => {
    const x = slots.get(a)!; const y = slots.get(b)!;
    return (state.panels.find(p => p.panel_key === x.panel_key)!.panel_number - state.panels.find(p => p.panel_key === y.panel_key)!.panel_number)
      || x.display_name.localeCompare(y.display_name, 'ru', { numeric: true }) || a.localeCompare(b);
  };
  return state.individualLinks.flatMap(link => {
    let a = link.from_slot_key; let b = link.to_slot_key;
    if (all) { if (compare(a,b) > 0) [a,b] = [b,a]; }
    else {
      const forward = slots.get(a)?.panel_key === sides[0].panel && slots.get(b)?.panel_key === sides[1].panel;
      const backward = slots.get(b)?.panel_key === sides[0].panel && slots.get(a)?.panel_key === sides[1].panel;
      if (!forward && !backward) return [];
      if (!forward || (backward && compare(a,b) > 0)) [a,b] = [b,a];
    }
    return [{ link, a, b }];
  }).sort((x,y) => compare(x.a,y.a) || compare(x.b,y.b));
}

export function EndpointLinkWorkspace({ state, onChange, onClose, initialSelectedKeys }: { state: BlueprintEditorState; initialSelectedKeys?: string[]; onChange: (state: BlueprintEditorState) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [sideState, setSides] = useState(() => (initialSelectedKeys?.length ? undefined : state.endpointNaming?.map(side => {
    const panel = state.panels.some(p => p.panel_key === side.panel) ? side.panel : state.activePanelKey;
    const available = state.slots.filter(s => s.panel_key === panel).map(s => s.key);
    const retained = side.order.filter(key => available.includes(key));
    return { ...side, panel, order: [...retained, ...available.filter(key => !retained.includes(key))], selected: [] as string[] };
  })) ?? [state.activePanelKey, state.panels.find(p => p.panel_key !== state.activePanelKey)?.panel_key ?? state.activePanelKey].map((panel, index) => {
    const selected = index === 0 ? (initialSelectedKeys ?? []).filter(key => state.slots.some(s => s.key === key && s.panel_key === panel)) : [];
    const available = state.slots.filter(s => s.panel_key === panel).map(s => s.key);
    return { panel, mode: (selected.length ? 'manual' : 'name') as 'name' | 'spatial' | 'manual', order: [...selected, ...available.filter(key => !selected.includes(key))], selected, horizontal: 'ltr' as 'ltr' | 'rtl', vertical: 'ttb' as 'ttb' | 'btt', naming: { mask: '#', start: '1', step: '1' } }; }));
  useEffect(() => {
    const endpointNaming = sideState.map(({ selected: _selected, ...side }) => side);
    if (JSON.stringify(endpointNaming) !== JSON.stringify(state.endpointNaming)) onChange({ ...state, endpointNaming });
  }, [sideState]);
  const sides = sideState.map(side => {
    const available = state.slots.filter(s => s.panel_key === side.panel);
    const order = side.mode === 'name' ? [...available].sort((a,b) => a.display_name.localeCompare(b.display_name, 'ru', { numeric: true }) || a.key.localeCompare(b.key)).map(s => s.key)
      : side.mode === 'spatial' ? spatialOrderedKeys({ ...state, activePanelKey: side.panel }, available.map(s => s.key), side.horizontal, side.vertical)
      : side.order.filter(key => available.some(s => s.key === key));
    return { ...side, order };
  });
  const [tab, setTab] = useState<'ports' | 'links'>('ports');
  const [allLinks, setAllLinks] = useState(false);
  const visibleLinks = presentedLinks(state, sides, allLinks);
  const [removed, setRemoved] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const patch = (index: number, value: Partial<typeof sides[number]>) => setSides(old => old.map((s, i) => i === index ? { ...s, ...value } : s));
  const keys = sides.map(side => side.order.filter(key => side.selected.includes(key)));
  const preview = pairwiseContinuityPreview(state, keys[0], keys[1], false);
  const label = (key: string) => { const slot = state.slots.find(s => s.key === key); return slot ? `${slot.display_name} · ${state.panels.find(p => p.panel_key === slot.panel_key)?.display_name}` : key; };
  return <section className="catalog-dialog" role="dialog" aria-modal="true" aria-label={t('endpointWorkspace.title')}><div className="catalog-dialog__surface endpoint-workspace">
    <h2>{t('endpointWorkspace.title')}</h2>
    <div role="tablist" aria-label={t('endpointWorkspace.title')} className="endpoint-workspace__tabs">
      <button type="button" role="tab" aria-selected={tab === 'ports'} onClick={() => setTab('ports')}>{t('endpointWorkspace.operations')}</button>
      <button type="button" role="tab" aria-selected={tab === 'links'} onClick={() => setTab('links')}>{t('endpointWorkspace.existing')} · {state.individualLinks.length}</button>
    </div>
    {tab === 'ports' && <div role="tabpanel">
    <div className="endpoint-workspace__columns">{sides.map((side, index) => {
      const scoped = { ...state, activePanelKey: side.panel };
      const names = bulkNamePreview(scoped, keys[index], side.naming);
      return <section key={index} aria-label={index === 0 ? 'A' : 'B'}>
        <label>{index === 0 ? 'A' : 'B'}<select value={side.panel} onChange={e => patch(index, { panel: e.target.value, mode: 'name', order: state.slots.filter(s => s.panel_key === e.target.value).map(s => s.key), selected: [] })}>{state.panels.map(p => <option key={p.panel_key} value={p.panel_key}>{p.display_name}</option>)}</select></label>
        <div className="endpoint-workspace__tools">
          <label>{t('endpointWorkspace.sort')}<select value={side.mode} onChange={e => patch(index, { mode: e.target.value as typeof side.mode, order: [...side.order] })}>{(['name','spatial','manual'] as const).map(mode => <option key={mode} value={mode}>{t(`endpointWorkspace.sort.${mode}`)}</option>)}</select></label>
          {side.mode === 'spatial' && <>
          <label>{t('blueprint.order.horizontal')}<select value={side.horizontal} onChange={e => patch(index, { horizontal: e.target.value as 'ltr' | 'rtl' })}>{(['ltr','rtl'] as const).map(v => <option key={v} value={v}>{t(`blueprint.order.${v}`)}</option>)}</select></label>
          <label>{t('blueprint.order.vertical')}<select value={side.vertical} onChange={e => patch(index, { vertical: e.target.value as 'ttb' | 'btt' })}>{(['ttb','btt'] as const).map(v => <option key={v} value={v}>{t(`blueprint.order.${v}`)}</option>)}</select></label>
          </>}
          <button type="button" onClick={() => patch(index, { selected: [...side.order] })}>{t('blueprint.links.selectAll')}</button>
          <button type="button" onClick={() => patch(index, { selected: [] })}>{t('blueprint.links.clearSelection')}</button>
        </div>
        <div className="endpoint-workspace__list">{side.order.map((key, row) => { const slot = state.slots.find(s => s.key === key)!; const links = state.individualLinks.filter(l => l.from_slot_key === key || l.to_slot_key === key); return <div key={key} className="endpoint-workspace__row" data-endpoint-row={key} data-manual={side.mode === 'manual'}>
          <label><input type="checkbox" checked={side.selected.includes(key)} onChange={e => patch(index, { selected: e.target.checked ? [...side.selected, key] : side.selected.filter(k => k !== key) })} /><span title={slot.display_name}>{slot.display_name}</span></label>
          <span className="endpoint-workspace__kind" role="img" aria-label={t(slot.kind === 'NETWORK_PORT' ? 'blueprint.endpoint.networkPort' : 'blueprint.endpoint.connectionPoint')} title={t(slot.kind === 'NETWORK_PORT' ? 'blueprint.endpoint.networkPort' : 'blueprint.endpoint.connectionPoint')}>{slot.kind === 'NETWORK_PORT' ? '▣' : '●'}</span>
          <span className="endpoint-workspace__name-preview" title={names?.find(n => n.key === key)?.display_name}>{names?.find(n => n.key === key)?.display_name && `→ ${names.find(n => n.key === key)!.display_name}`}</span>
          <span className="endpoint-workspace__connections" title={links.map(l => label(l.from_slot_key === key ? l.to_slot_key : l.from_slot_key)).join(', ')}>↔ {links.length ? links.map(l => label(l.from_slot_key === key ? l.to_slot_key : l.from_slot_key)).join(', ') : '—'}</span>
          {side.mode === 'manual' && <><button type="button" aria-label={t('blueprint.order.up', { index: row + 1 })} disabled={!row} onClick={() => patch(index, { order: reorderOrderedKeys(side.order, row, -1) })}>↑</button>
          <button type="button" aria-label={t('blueprint.order.down', { index: row + 1 })} disabled={row === side.order.length - 1} onClick={() => patch(index, { order: reorderOrderedKeys(side.order, row, 1) })}>↓</button></>}
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
    </div>}
    {tab === 'links' && <div role="tabpanel" className="endpoint-workspace__existing-links">
    <h3>{t('blueprint.composition.links')} · {state.individualLinks.length}</h3>
    <label className="endpoint-workspace__filter"><input type="checkbox" checked={allLinks} onChange={e => { setAllLinks(e.target.checked); setRemoved([]); }} />{t('endpointWorkspace.allLinks')}</label>
    <div className="endpoint-workspace__preview">{visibleLinks.map(({link:l,a,b}) => { const id = internalLinkPairKey(a,b); const text = `${label(a)} ↔ ${label(b)}`; return <div key={id} className="endpoint-workspace__link-row" data-link-row={id}><label title={text} aria-label={text}><input type="checkbox" checked={removed.includes(id)} onChange={e => setRemoved(e.target.checked ? [...removed,id] : removed.filter(k => k !== id))} /><span>{text}</span></label><button type="button" onClick={() => onChange({ ...state, individualLinks: state.individualLinks.filter(link => link !== l) })}>{t('blueprint.composition.remove')}</button></div>; })}</div>
    <div className="catalog-dialog__actions">
      <button type="button" onClick={() => setRemoved(visibleLinks.map(({a,b}) => internalLinkPairKey(a,b)))}>{t('blueprint.links.selectAll')}</button>
      <button type="button" disabled={!removed.length} onClick={() => { onChange({ ...state, individualLinks: state.individualLinks.filter(l => !removed.includes(internalLinkPairKey(l.from_slot_key,l.to_slot_key))) }); setRemoved([]); }}>{t('blueprint.links.deleteSelected', { count: removed.length })}</button>
    </div></div>}
    <div className="catalog-dialog__actions"><button type="button" autoFocus onClick={onClose}>{t('action.close')}</button>
    </div>
  </div></section>;
}
