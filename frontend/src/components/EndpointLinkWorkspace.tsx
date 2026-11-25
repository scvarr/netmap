import { isMountKind } from '../topology/hardwareModules';
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { applyBulkNames, blueprintMarkers, bulkNamePreview, spatialOrderedKeys, reorderOrderedKeys, applyMemberMappings, blueprintInternalOccupancy, linkMemberPairs, removeMemberMappings, validateBlueprintMemberPairs, type BlueprintEditorState } from '../blueprints/editorModel';

import { memberAddressKey, memberPairKey, pairSelectedMembers, replacePreviewMember, type MemberAddress, type MemberPair } from '../blueprints/memberMappings';
import type { PortType } from './PortTypeSelect';

const markerKinds = {
  CONNECTION_POINT: { label: 'blueprint.endpoint.connectionPoint', glyph: '●' },
  NETWORK_PORT: { label: 'blueprint.endpoint.networkPort', glyph: '▣' },
  MODULE_PORT: { label: 'blueprint.endpoint.modulePort', glyph: '◆' },
  MODULE_BAY: { label: 'blueprint.endpoint.moduleBay', glyph: '◆' },
} as const;

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

export function EndpointLinkWorkspace({ state, onChange, onClose, initialSelectedKeys, portTypes, wiringReadOnly = false }: {
  state: BlueprintEditorState;
  initialSelectedKeys?: string[];
  portTypes?: PortType[];
  wiringReadOnly?: boolean;
  onChange: (state: BlueprintEditorState) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const markers = blueprintMarkers(state);
  const markersByKey = new Map(markers.map(marker => [marker.key, marker]));
  const panelMarkers = (panel: string) => markers.filter(marker => marker.panel_key === panel);
  const [sideState, setSides] = useState(() => (initialSelectedKeys?.length ? undefined : state.endpointNaming?.map(side => {
    const panel = state.panels.some(p => p.panel_key === side.panel) ? side.panel : state.activePanelKey;
    const available = panelMarkers(panel).map(marker => marker.key);
    const retained = side.order.filter(key => available.includes(key));
    return { ...side, panel, order: [...retained, ...available.filter(key => !retained.includes(key))], selected: [] as string[] };
  })) ?? [state.activePanelKey, state.panels.find(p => p.panel_key !== state.activePanelKey)?.panel_key ?? state.activePanelKey].map((panel, index) => {
    const available = panelMarkers(panel).map(marker => marker.key);
    const selected = index === 0 ? (initialSelectedKeys ?? []).filter(key => available.includes(key)) : [];
    return { panel, mode: (selected.length ? 'manual' : 'name') as 'name' | 'spatial' | 'manual', order: [...selected, ...available.filter(key => !selected.includes(key))], selected, horizontal: 'ltr' as 'ltr' | 'rtl', vertical: 'ttb' as 'ttb' | 'btt', naming: { mask: '#', start: '1', step: '1' } }; }));
  useEffect(() => {
    const endpointNaming = sideState.map(({ selected: _selected, ...side }) => side);
    if (JSON.stringify(endpointNaming) !== JSON.stringify(state.endpointNaming)) onChange({ ...state, endpointNaming });
  }, [sideState]);
  const sides = sideState.map(side => {
    const available = panelMarkers(side.panel);
    const order = side.mode === 'name' ? [...available].sort((a,b) => a.display_name.localeCompare(b.display_name, 'ru', { numeric: true }) || a.key.localeCompare(b.key)).map(s => s.key)
      : side.mode === 'spatial' ? spatialOrderedKeys({ ...state, activePanelKey: side.panel }, available.map(s => s.key), side.horizontal, side.vertical)
      : side.order.filter(key => available.some(s => s.key === key));
    return { ...side, order };
  });
  const [tab, setTab] = useState<'ports' | 'links'>(wiringReadOnly && !initialSelectedKeys?.length ? 'links' : 'ports');
  const tabId = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const existingList = useRef<HTMLDivElement>(null);
  const previewList = useRef<HTMLDivElement>(null);
  const [allLinks, setAllLinks] = useState(wiringReadOnly);
  const visiblePairs = presentedLinks(state, sides, allLinks).flatMap(({ link, a }) =>
    linkMemberPairs(link).map(pair => a === pair.a.endpointKey ? pair : { a: pair.b, b: pair.a })
      .sort((first, second) => first.a.memberIndex - second.a.memberIndex || first.b.memberIndex - second.b.memberIndex));
  const storedCount = state.individualLinks.reduce((count, link) => count + linkMemberPairs(link).length, 0);
  const [removed, setRemoved] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [memberSelections, setMemberSelections] = useState<string[][]>([[], []]);
  const [activeChooser, setActiveChooser] = useState<string>();
  const [editedPreview, setEditedPreview] = useState<{ source: string; pairs: MemberPair[] }>();
  const patch = (index: number, value: Partial<typeof sides[number]>) => {
    if (value.panel !== undefined || value.selected !== undefined && !value.selected.length) {
      setMemberSelections(old => old.map((selection, i) => i === index ? [] : selection));
    }
    if (Object.keys(value).some(field => field !== 'naming')) setEditedPreview(undefined);
    setSides(old => old.map((s, i) => i === index ? { ...s, ...value } : s));
  };
  const keys = sides.map(side => side.order.filter(key => side.selected.includes(key)));
  const slots = new Map(state.slots.map(slot => [slot.key, slot]));
  const occupancy = blueprintInternalOccupancy(state);
  const addresses = (key: string): MemberAddress[] => {
    const slot = slots.get(key);
    return slot ? Array.from({ length: slot.cardinality ?? 1 }, (_, i) => ({ endpointKey: key, memberIndex: i + 1 })) : [];
  };
  const setMembers = (side: number, members: MemberAddress[], checked: boolean) => {
    const ids = new Set(members.map(memberAddressKey));
    setMemberSelections(old => old.map((selection, i) => i !== side ? selection
      : checked ? [...new Set([...selection, ...ids])] : selection.filter(id => !ids.has(id))));
    setEditedPreview(undefined);
  };
  const available = sides.map(side => side.order.flatMap(addresses));
  const selectedMembers = available.map((members, side) => {
    const selectedSlots = new Set(sides[side].selected);
    const selectedChannels = new Set(memberSelections[side]);
    return members.filter(address => {
      const slot = slots.get(address.endpointKey)!;
      return (slot.cardinality ?? 1) === 1 ? selectedSlots.has(slot.key) : selectedChannels.has(memberAddressKey(address));
    });
  });
  const [left, right] = selectedMembers;
  const hasSelectedModules = keys.some(selection => selection.some(key => isMountKind(markersByKey.get(key)?.kind)));
  const source = JSON.stringify([sides.map(side => side.panel), selectedMembers]);
  const pairs = editedPreview?.source === source ? editedPreview.pairs : pairSelectedMembers(left, right);
  const previewError = !left.length || !right.length ? 'empty' : left.length !== right.length ? 'countMismatch'
    : validateBlueprintMemberPairs(state, pairs, occupancy);
  const typeById = new Map(portTypes?.map(type => [type.id, type]));
  const memberName = ({ endpointKey, memberIndex }: MemberAddress) => {
    const name = typeById.get(slots.get(endpointKey)?.port_type_id ?? '')?.members[memberIndex - 1];
    return name && name !== String(memberIndex) ? `${memberIndex} · ${name}` : String(memberIndex);
  };
  const label = ({ endpointKey, memberIndex }: MemberAddress) => {
    const slot = slots.get(endpointKey);
    if (!slot) return endpointKey;
    const panel = state.panels.find(p => p.panel_key === slot.panel_key);
    const member = (slot.cardinality ?? 1) > 1 ? ` · ${t('endpointWorkspace.member', { member: memberName({ endpointKey, memberIndex }) })}` : '';
    return `${slot.display_name}${member} · ${panel?.display_name}`;
  };
  const removePairs = (ids: string[]) => {
    onChange(removeMemberMappings(state, new Set(ids)));
    setRemoved(selected => selected.filter(key => !ids.includes(key)));
    existingList.current?.focus();
  };
  return <section className="catalog-dialog endpoint-workspace-dialog" role="dialog" aria-modal="true" aria-label={t('endpointWorkspace.title')}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, details > summary, [tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !!element.getClientRects().length);
      const boundary = event.shiftKey ? focusable[0] : focusable.at(-1);
      if (event.target === boundary) {
        event.preventDefault();
        (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
      }
    }}><div className="catalog-dialog__surface endpoint-workspace" data-tab={tab}>
    <h2>{t('endpointWorkspace.title')}</h2>
    <div ref={tabs} role="tablist" aria-label={t('endpointWorkspace.title')} className="endpoint-workspace__tabs">
      {(['ports', 'links'] as const).map(item => <button key={item} id={`${tabId}-${item}`} type="button" role="tab"
        tabIndex={tab === item ? 0 : -1} aria-selected={tab === item} aria-controls={`${tabId}-panel-${item}`}
        onClick={() => setTab(item)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'ports' : event.key === 'End' ? 'links' : item === 'ports' ? 'links' : 'ports';
          setTab(next);
          tabs.current?.querySelectorAll('button')[next === 'ports' ? 0 : 1]?.focus();
        }}>{item === 'ports' ? t('endpointWorkspace.operations') : `${t('endpointWorkspace.existing')} · ${storedCount}`}</button>)}
    </div>
    {tab === 'ports' && <div role="tabpanel" id={`${tabId}-panel-ports`} aria-labelledby={`${tabId}-ports`}>
    <div className="endpoint-workspace__columns">{sides.map((side, index) => {
      const scoped = { ...state, activePanelKey: side.panel };
      const names = bulkNamePreview(scoped, keys[index], side.naming);
      return <section key={index} aria-label={index === 0 ? 'A' : 'B'}>
        <label>{index === 0 ? 'A' : 'B'}<select value={side.panel} onChange={e => patch(index, { panel: e.target.value, mode: 'name', order: panelMarkers(e.target.value).map(marker => marker.key), selected: [] })}>{state.panels.map(p => <option key={p.panel_key} value={p.panel_key}>{p.display_name}</option>)}</select></label>
        <div className="endpoint-workspace__tools">
          <label>{t('endpointWorkspace.sort')}<select value={side.mode} onChange={e => patch(index, { mode: e.target.value as typeof side.mode, order: [...side.order] })}>{(['name','spatial','manual'] as const).map(mode => <option key={mode} value={mode}>{t(`endpointWorkspace.sort.${mode}`)}</option>)}</select></label>
          {side.mode === 'spatial' && <>
          <label>{t('blueprint.order.horizontal')}<select value={side.horizontal} onChange={e => patch(index, { horizontal: e.target.value as 'ltr' | 'rtl' })}>{(['ltr','rtl'] as const).map(v => <option key={v} value={v}>{t(`blueprint.order.${v}`)}</option>)}</select></label>
          <label>{t('blueprint.order.vertical')}<select value={side.vertical} onChange={e => patch(index, { vertical: e.target.value as 'ttb' | 'btt' })}>{(['ttb','btt'] as const).map(v => <option key={v} value={v}>{t(`blueprint.order.${v}`)}</option>)}</select></label>
          </>}
          <button type="button" onClick={() => patch(index, { selected: [...side.order] })}>{t('blueprint.links.selectAll')}</button>
          <button type="button" onClick={() => patch(index, { selected: [] })}>{t('blueprint.links.clearSelection')}</button>
        </div>
        <div className="endpoint-workspace__list">{side.order.map((key, row) => { const slot = markersByKey.get(key)!; const kind = markerKinds[slot.kind]; const members = addresses(key);
          const free = members.filter(member => !occupancy.has(memberAddressKey(member)));
          const singlePeer = members.length === 1 ? occupancy.get(memberAddressKey(members[0])) : undefined;
          return <div key={key}><div className="endpoint-workspace__row" data-endpoint-row={key} data-manual={side.mode === 'manual'}>
          <label><input type="checkbox" checked={side.selected.includes(key)} onChange={e => patch(index, { selected: e.target.checked ? [...side.selected, key] : side.selected.filter(k => k !== key) })} /><span title={slot.display_name}>{slot.display_name}</span></label>
          <span className="endpoint-workspace__kind" role="img" aria-label={t(kind.label)} title={t(kind.label)}>{kind.glyph}</span>
          <span className="endpoint-workspace__name-preview" title={names?.find(n => n.key === key)?.display_name}>{names?.find(n => n.key === key)?.display_name && `→ ${names.find(n => n.key === key)!.display_name}`}</span>
          <span className="endpoint-workspace__connections" title={singlePeer && label(singlePeer)}>
            {members.length > 1 ? t('endpointWorkspace.occupancy', { used: members.length - free.length, total: members.length })
              : members.length === 1 && (singlePeer ? `↔ ${label(singlePeer)}` : t('endpointWorkspace.free'))}
          </span>
          {side.mode === 'manual' && <><button type="button" aria-label={t('blueprint.order.up', { index: row + 1 })} disabled={!row} onClick={() => patch(index, { order: reorderOrderedKeys(side.order, row, -1) })}>↑</button>
          <button type="button" aria-label={t('blueprint.order.down', { index: row + 1 })} disabled={row === side.order.length - 1} onClick={() => patch(index, { order: reorderOrderedKeys(side.order, row, 1) })}>↓</button></>}
        </div>
        {members.length > 1 && <details className="endpoint-workspace__members">
          <summary>{t('endpointWorkspace.members', { name: slot.display_name, count: members.length })}</summary>
          {!wiringReadOnly && <button type="button" disabled={!free.length} onClick={() => setMembers(index, free, true)}>
            {t('endpointWorkspace.selectFree')}
          </button>}
          {members.map(address => {
            const id = memberAddressKey(address);
            const peer = occupancy.get(id);
            return <label key={id} className="endpoint-workspace__member">
              {!wiringReadOnly && <input type="checkbox" aria-label={label(address)}
                disabled={!!peer} checked={!peer && memberSelections[index].includes(id)} onChange={event => setMembers(index, [address], event.target.checked)} />}
              <span>{t('endpointWorkspace.member', { member: memberName(address) })}</span>
              <span>{peer ? `↔ ${label(peer)}` : t('endpointWorkspace.free')}</span>
            </label>;
          })}
        </details>}
        </div>; })}</div>
        <div className="endpoint-workspace__tools">{(['mask','start','step'] as const).map(field => <label key={field}>{t(`blueprint.naming.${field}`)}<input value={side.naming[field]} onChange={e => patch(index, { naming: { ...side.naming, [field]: e.target.value } })} /></label>)}</div>
        {!names && <p role="alert">{t('blueprint.naming.invalid')}</p>}
        <button type="button" disabled={!names?.length} onClick={() => { const renamed = applyBulkNames(scoped, keys[index], side.naming); onChange({ ...renamed, activePanelKey: state.activePanelKey }); }}>{t('blueprint.naming.apply')}</button>
      </section>;
    })}</div>
    {!wiringReadOnly && <>
      {hasSelectedModules && <p role="status">{t('endpointWorkspace.physicalLinksOnly')}</p>}
      {previewError && <p role="status">{t(`blueprint.pairwise.error.${previewError}`)}</p>}
      <p aria-live="polite">{t('endpointWorkspace.previewCount', { count: pairs.length })}</p>
      {!!pairs.length && <p id={`${tabId}-preview-help`}>{t('endpointWorkspace.previewHelp')}</p>}
      {!!pairs.length && <div ref={previewList} className="endpoint-workspace__preview" role="region" aria-label={t('endpointWorkspace.preview')} aria-describedby={`${tabId}-preview-help`} tabIndex={0}>
        <table className="catalog-table endpoint-workspace__preview-table" aria-label={t('endpointWorkspace.preview')}>
          <thead><tr>
            <th scope="col">{t('endpointWorkspace.linkPort', { side: 'A' })}</th>
            <th scope="col">{t('endpointWorkspace.linkPort', { side: 'B' })}</th>
            <th scope="col">{t('catalog.actions')}</th>
          </tr></thead>
          <tbody>{pairs.map((pair, row) => <tr key={row} data-preview-row>
            {(['a', 'b'] as const).map((side, column) => <td key={side}>
              <select aria-label={t('endpointWorkspace.replaceOrSwap', { side: side.toUpperCase(), row: row + 1 })}
                onFocus={() => setActiveChooser(`${row}:${side}`)} onBlur={() => setActiveChooser(undefined)}
                value={memberAddressKey(pair[side])} onChange={event => {
                  const replacement = available[column].find(address => memberAddressKey(address) === event.target.value);
                  if (replacement) setEditedPreview({ source, pairs: replacePreviewMember(pairs, row, side, replacement) });
                }}>
                {(activeChooser === `${row}:${side}` ? available[column] : [pair[side]]).filter(address => {
                  const key = memberAddressKey(address);
                  return key === memberAddressKey(pair[side]) || !occupancy.has(key);
                }).map(address => <option key={memberAddressKey(address)} value={memberAddressKey(address)}>{label(address)}</option>)}
              </select>
            </td>)}
            <td><button type="button" onClick={() => {
              setEditedPreview({ source, pairs: pairs.filter((_, index) => index !== row) });
              if (pairs.length > 1) previewList.current?.focus();
              else tabs.current?.querySelector('button')?.focus();
            }}>{t('endpointWorkspace.exclude')}</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <button type="button" disabled={!!previewError || !pairs.length} onClick={() => {
        const next = applyMemberMappings(state, pairs);
        if (next === state) return;
        onChange(next);
        setEditedPreview(undefined);
        setMemberSelections([[], []]);
        setStatus(t('endpointWorkspace.applied'));
        tabs.current?.querySelector('button')?.focus();
      }}>{t(left.length === 1 && right.length === 1 ? 'blueprint.composition.addLink' : 'blueprint.pairwise.apply')}</button>
      <p role="status">{status}</p>
    </>}
    </div>}
    {tab === 'links' && <div role="tabpanel" id={`${tabId}-panel-links`} aria-labelledby={`${tabId}-links`} className="endpoint-workspace__existing-links">
    <label className="endpoint-workspace__filter"><input type="checkbox" checked={allLinks} onChange={e => { setAllLinks(e.target.checked); setRemoved([]); }} />{t('endpointWorkspace.allLinks')}</label>
    <div ref={existingList} className="endpoint-workspace__link-list" role="region" aria-label={t('endpointWorkspace.existing')} tabIndex={0}>
      <table className="catalog-table endpoint-workspace__link-table" aria-label={t('blueprint.composition.links')}>
        <thead>
          <tr>
            {!wiringReadOnly && <th scope="col">{t('endpointWorkspace.linkSelection')}</th>}
            <th scope="col">{t('endpointWorkspace.linkPort', { side: 'A' })}</th>
            <th scope="col">{t('endpointWorkspace.linkPort', { side: 'B' })}</th>
            {!wiringReadOnly && <th scope="col">{t('catalog.actions')}</th>}
          </tr>
        </thead>
        <tbody>
          {visiblePairs.map(pair => {
            const id = memberPairKey(pair);
            const portA = label(pair.a);
            const portB = label(pair.b);
            return <tr key={id} data-link-row={id}>
              {!wiringReadOnly && <td><input
                type="checkbox"
                aria-label={`${portA} ↔ ${portB}`}
                checked={removed.includes(id)}
                onChange={e => {
                  const checked = e.target.checked;
                  setRemoved(selected => checked ? [...selected, id] : selected.filter(key => key !== id));
                }}
              /></td>}
              <td>{portA}</td>
              <td>{portB}</td>
              {!wiringReadOnly && <td><button type="button" onClick={() => removePairs([id])}>{t('blueprint.composition.remove')}</button></td>}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    {!wiringReadOnly && <div className="catalog-dialog__actions">
      <button type="button" onClick={() => setRemoved(visiblePairs.map(memberPairKey))}>{t('blueprint.links.selectAll')}</button>
      <button type="button" disabled={!removed.length} onClick={() => removePairs(removed)}>{t('blueprint.links.deleteSelected', { count: removed.length })}</button>
    </div>}</div>}
    <div className="catalog-dialog__actions"><button type="button" autoFocus onClick={onClose}>{t('action.close')}</button>
    </div>
  </div></section>;
}
