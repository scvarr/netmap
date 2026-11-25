import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { reorderOrderedKeys } from '../blueprints/editorModel';
import { internalOccupancy, memberAddressKey, memberPairKey, pairSelectedMembers, replacePreviewMember, type MemberAddress, type MemberPair, type MemberPairError } from '../blueprints/memberMappings';

const markerKinds = {
  CONNECTION_POINT: { label: 'blueprint.endpoint.connectionPoint', glyph: '●' },
  NETWORK_PORT: { label: 'blueprint.endpoint.networkPort', glyph: '▣' },
  MODULE_PORT: { label: 'blueprint.endpoint.modulePort', glyph: '◆' },
  MODULE_BAY: { label: 'blueprint.endpoint.moduleBay', glyph: '◆' },
} as const;

export interface WorkspaceSide {
  panel?: string;
  mode: 'name' | 'spatial' | 'manual';
  order: string[];
  selected: string[];
  horizontal: 'ltr' | 'rtl';
  vertical: 'ttb' | 'btt';
  naming: { mask: string; start: string; step: string };
}

interface WorkspaceEndpoint {
  key: string;
  display_name: string;
  kind: keyof typeof markerKinds;
  panel?: string;
  cardinality: number;
  designations?: readonly string[];
}

interface PanelTools {
  panels: { key: string; name: string }[];
  defaultPanels: string[];
  initialSides?: Omit<WorkspaceSide, 'selected'>[];
  onPreferencesChange: (sides: WorkspaceSide[]) => void;
  spatialOrder: (side: WorkspaceSide, keys: string[]) => string[];
  names: (side: WorkspaceSide, keys: string[]) => { key: string; display_name: string }[] | undefined;
  rename: (side: WorkspaceSide, keys: string[]) => void;
  present: (sides: WorkspaceSide[], all: boolean) => MemberPair[];
}

export function EndpointLinkWorkspace({
  endpoints, storedPairs, validate, onApply, onRemove, onClose,
  initialSelectedKeys, panelTools, wiringReadOnly = false,
}: {
  endpoints: WorkspaceEndpoint[];
  storedPairs: MemberPair[];
  validate: (pairs: readonly MemberPair[]) => MemberPairError | undefined;
  onApply: (pairs: readonly MemberPair[]) => void;
  onRemove: (keys: ReadonlySet<string>) => void;
  onClose: () => void;
  initialSelectedKeys?: string[];
  panelTools?: PanelTools;
  wiringReadOnly?: boolean;
}) {
  const { t } = useI18n();
  const markersByKey = new Map(endpoints.map(marker => [marker.key, marker]));
  const panelMarkers = (panel?: string) => endpoints.filter(marker => marker.panel === panel);
  const compare = (a: WorkspaceEndpoint, b: WorkspaceEndpoint) =>
    a.display_name.localeCompare(b.display_name, 'ru', { numeric: true }) || a.key.localeCompare(b.key);
  const [sideState, setSides] = useState<WorkspaceSide[]>(() => [0, 1].map(index => {
    const initial = panelTools?.initialSides?.[index];
    const panel = initial?.panel ?? panelTools?.defaultPanels[index];
    const available = panelMarkers(panel).map(marker => marker.key);
    const selected = index === 0 ? (initialSelectedKeys ?? []).filter(key => available.includes(key)) : [];
    const retained = initial?.order.filter(key => available.includes(key)) ?? selected;
    return {
      mode: panelTools && selected.length ? 'manual' : 'name', horizontal: 'ltr', vertical: 'ttb',
      naming: { mask: '#', start: '1', step: '1' }, ...initial,
      panel, selected, order: [...retained, ...available.filter(key => !retained.includes(key))],
    };
  }));
  useEffect(() => { panelTools?.onPreferencesChange(sideState); }, [sideState]);
  const sides = sideState.map(side => {
    const available = panelMarkers(side.panel);
    const order = side.mode === 'name' ? [...available].sort(compare).map(marker => marker.key)
      : side.mode === 'spatial' && panelTools ? panelTools.spatialOrder(side, available.map(marker => marker.key))
      : side.order.filter(key => available.some(marker => marker.key === key));
    return { ...side, order };
  });
  const [tab, setTab] = useState<'ports' | 'links'>(wiringReadOnly && (!panelTools || !initialSelectedKeys?.length) ? 'links' : 'ports');
  const tabId = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const existingList = useRef<HTMLDivElement>(null);
  const previewList = useRef<HTMLDivElement>(null);
  const [allLinks, setAllLinks] = useState(wiringReadOnly);
  const visiblePairs = panelTools?.present(sides, allLinks) ?? storedPairs;
  const [removed, setRemoved] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [memberSelections, setMemberSelections] = useState<string[][]>([[], []]);
  const [activeChooser, setActiveChooser] = useState<string>();
  const [editedPreview, setEditedPreview] = useState<{ source: string; pairs: MemberPair[] }>();
  const patch = (index: number, value: Partial<WorkspaceSide>) => {
    if (value.panel !== undefined || value.selected !== undefined && !value.selected.length) {
      setMemberSelections(old => old.map((selection, i) => i === index ? [] : selection));
    }
    if (Object.keys(value).some(field => field !== 'naming')) setEditedPreview(undefined);
    setSides(old => old.map((side, i) => i === index ? { ...side, ...value } : side));
  };
  const keys = sides.map(side => side.order.filter(key => side.selected.includes(key)));
  const occupancy = internalOccupancy(storedPairs);
  const addresses = (key: string): MemberAddress[] => {
    const slot = markersByKey.get(key);
    return slot ? Array.from({ length: slot.cardinality }, (_, i) => ({ endpointKey: key, memberIndex: i + 1 })) : [];
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
      const slot = markersByKey.get(address.endpointKey)!;
      return slot.cardinality === 1 ? selectedSlots.has(slot.key) : selectedChannels.has(memberAddressKey(address));
    });
  });
  const [left, right] = selectedMembers;
  const hasSelectedModules = keys.some(selection => selection.some(key => markersByKey.get(key)?.kind.startsWith('MODULE_')));
  const source = JSON.stringify([sides.map(side => side.panel), selectedMembers]);
  const pairs = editedPreview?.source === source ? editedPreview.pairs : pairSelectedMembers(left, right);
  const previewError = !left.length || !right.length ? 'empty' : left.length !== right.length ? 'countMismatch'
    : validate(pairs);
  const memberName = ({ endpointKey, memberIndex }: MemberAddress) => {
    const name = markersByKey.get(endpointKey)?.designations?.[memberIndex - 1];
    return name && name !== String(memberIndex) ? `${memberIndex} · ${name}` : String(memberIndex);
  };
  const label = ({ endpointKey, memberIndex }: MemberAddress) => {
    const slot = markersByKey.get(endpointKey);
    const panel = panelTools?.panels.find(p => p.key === slot?.panel);
    const member = !panelTools || !slot || slot.cardinality > 1 || memberIndex !== 1 ? ` · ${t('endpointWorkspace.member', { member: memberName({ endpointKey, memberIndex }) })}` : '';
    return `${slot?.display_name ?? endpointKey}${member}${panel ? ` · ${panel.name}` : ''}`;
  };
  const removePairs = (ids: string[]) => {
    onRemove(new Set(ids));
    setRemoved(selected => selected.filter(key => !ids.includes(key)));
    existingList.current?.focus();
  };
  return <section className="catalog-dialog endpoint-workspace-dialog" role="dialog" aria-modal="true" aria-label={t('endpointWorkspace.title')}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, details > summary, [tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !!element.getClientRects().length);
      const boundary = event.shiftKey ? focusable[0] : focusable.at(-1);
      if (event.target === boundary) {
        event.preventDefault();
        (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
      }
    }}><div className="catalog-dialog__surface endpoint-workspace" data-tab={tab} data-module-wiring={!panelTools || undefined}>
    <h2>{t('endpointWorkspace.title')}</h2>
    {!panelTools && wiringReadOnly && <p>{t('moduleReview.publishedWiring')}</p>}
    <div ref={tabs} role="tablist" aria-label={t('endpointWorkspace.title')} className="endpoint-workspace__tabs">
      {(['ports', 'links'] as const).map(item => <button key={item} id={`${tabId}-${item}`} type="button" role="tab"
        tabIndex={tab === item ? 0 : -1} aria-selected={tab === item} aria-controls={`${tabId}-panel-${item}`}
        onClick={() => setTab(item)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'ports' : event.key === 'End' ? 'links' : item === 'ports' ? 'links' : 'ports';
          setTab(next);
          tabs.current?.querySelectorAll('button')[next === 'ports' ? 0 : 1]?.focus();
        }}>{item === 'ports' ? t('endpointWorkspace.operations') : `${t('endpointWorkspace.existing')} · ${storedPairs.length}`}</button>)}
    </div>
    {tab === 'ports' && <div role="tabpanel" id={`${tabId}-panel-ports`} aria-labelledby={`${tabId}-ports`}>
    <div className="endpoint-workspace__columns">{sides.map((side, index) => {
      const names = panelTools?.names(side, keys[index]);
      const freeChannels = keys[index].flatMap(key => {
        const members = addresses(key);
        return members.length > 1 ? members.filter(member => !occupancy.has(memberAddressKey(member))) : [];
      });
      return <section key={index} aria-label={index === 0 ? 'A' : 'B'}>
        {panelTools ? <label>{index === 0 ? 'A' : 'B'}<select value={side.panel} onChange={e => patch(index, { panel: e.target.value, mode: 'name', order: panelMarkers(e.target.value).map(marker => marker.key), selected: [] })}>{panelTools.panels.map(panel => <option key={panel.key} value={panel.key}>{panel.name}</option>)}</select></label>
          : <h3>{index === 0 ? 'A' : 'B'}</h3>}
        <div className="endpoint-workspace__tools">
          <label>{t('endpointWorkspace.sort')}<select value={side.mode} onChange={e => patch(index, { mode: e.target.value as typeof side.mode, order: [...side.order] })}>{(['name','spatial','manual'] as const).filter(mode => panelTools || mode !== 'spatial').map(mode => <option key={mode} value={mode}>{t(`endpointWorkspace.sort.${mode}`)}</option>)}</select></label>
          {side.mode === 'spatial' && <>
          <label>{t('blueprint.order.horizontal')}<select value={side.horizontal} onChange={e => patch(index, { horizontal: e.target.value as 'ltr' | 'rtl' })}>{(['ltr','rtl'] as const).map(v => <option key={v} value={v}>{t(`blueprint.order.${v}`)}</option>)}</select></label>
          <label>{t('blueprint.order.vertical')}<select value={side.vertical} onChange={e => patch(index, { vertical: e.target.value as 'ttb' | 'btt' })}>{(['ttb','btt'] as const).map(v => <option key={v} value={v}>{t(`blueprint.order.${v}`)}</option>)}</select></label>
          </>}
          <button type="button" onClick={() => patch(index, { selected: side.order.filter(key => panelTools || addresses(key).some(member => !occupancy.has(memberAddressKey(member)))) })}>{t('blueprint.links.selectAll')}</button>
          <button type="button" onClick={() => patch(index, { selected: [] })}>{t('blueprint.links.clearSelection')}</button>
          {!panelTools && !wiringReadOnly && <button type="button" disabled={!freeChannels.length}
            onClick={() => setMembers(index, freeChannels, true)}>
            {t('endpointWorkspace.selectFree')}
          </button>}
        </div>
        <div className="endpoint-workspace__list">{side.order.map((key, row) => { const slot = markersByKey.get(key)!; const kind = markerKinds[slot.kind]; const members = addresses(key);
          const free = members.filter(member => !occupancy.has(memberAddressKey(member)));
          const singlePeer = members.length === 1 ? occupancy.get(memberAddressKey(members[0])) : undefined;
          return <div key={key}><div className="endpoint-workspace__row" data-endpoint-row={key} data-manual={side.mode === 'manual'}>
          <label><input type="checkbox" disabled={!panelTools && (wiringReadOnly || !free.length)} checked={side.selected.includes(key)} onChange={e => patch(index, { selected: e.target.checked ? [...side.selected, key] : side.selected.filter(k => k !== key) })} /><span title={slot.display_name}>{slot.display_name}</span></label>
          <span className="endpoint-workspace__kind" role="img" aria-label={t(kind.label)} title={t(kind.label)}>{kind.glyph}</span>
          <span className="endpoint-workspace__name-preview" title={names?.find(n => n.key === key)?.display_name}>
            {names?.find(n => n.key === key)?.display_name && `→ ${names.find(n => n.key === key)!.display_name}`}
            {!panelTools && members.length === 1 && slot.designations?.[0] && t('endpointWorkspace.member', { member: memberName(members[0]) })}
          </span>
          <span className="endpoint-workspace__connections" title={singlePeer && label(singlePeer)}>
            {!panelTools && !members.length ? t('catalog.undefined') : members.length > 1 ? t('endpointWorkspace.occupancy', { used: members.length - free.length, total: members.length })
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
        {panelTools && <><div className="endpoint-workspace__tools">{(['mask','start','step'] as const).map(field => <label key={field}>{t(`blueprint.naming.${field}`)}<input value={side.naming[field]} onChange={e => patch(index, { naming: { ...side.naming, [field]: e.target.value } })} /></label>)}</div>
        {!names && <p role="alert">{t('blueprint.naming.invalid')}</p>}
        <button type="button" disabled={!names?.length} onClick={() => panelTools.rename(side, keys[index])}>{t('blueprint.naming.apply')}</button></>}
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
        if (validate(pairs)) return;
        onApply(pairs);
        setEditedPreview(undefined);
        setMemberSelections([[], []]);
        setStatus(t('endpointWorkspace.applied'));
        tabs.current?.querySelector('button')?.focus();
      }}>{t(left.length === 1 && right.length === 1 ? 'blueprint.composition.addLink' : 'blueprint.pairwise.apply')}</button>
      <p role="status">{status}</p>
    </>}
    </div>}
    {tab === 'links' && <div role="tabpanel" id={`${tabId}-panel-links`} aria-labelledby={`${tabId}-links`} className="endpoint-workspace__existing-links">
    {panelTools && <label className="endpoint-workspace__filter"><input type="checkbox" checked={allLinks} onChange={e => { setAllLinks(e.target.checked); setRemoved([]); }} />{t('endpointWorkspace.allLinks')}</label>}
    {!panelTools && !visiblePairs.length && <p>{t('moduleReview.emptyWiring')}</p>}
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
