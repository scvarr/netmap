import { mountTypeId, type MountKind, type ModuleMount, type ModuleBay } from '../topology/hardwareModules';
import { mountTypeName, useMountTypes, type MountCatalogs } from './ModulePortTypeSelect';
import { modulePortPosition } from '../topology/hardwareModules';
import { EndpointMarker } from './EndpointMarker';
import { usePortTypes } from './PortTypeSelect';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BlueprintPresentation } from '../topology/types';
import { panelCompositionBounds } from '../topology/blueprintDisplaySize';
import { useI18n, type MessageKey } from '../i18n';
import { HardwareModuleError, hardwareModuleDataSource, type BlockingModuleCable, type BlockingModuleCableEndpoint, type HardwareConfiguration, type HardwareModuleDataSource, type ModuleInstallation, type ModuleTemplate } from '../topology/hardwareModules';
import { physicalEndpointAddress } from '../topology/physicalPortAvailability';

function compareKeys(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function groupBays(config: HardwareConfiguration, image: BlueprintPresentation | undefined, collator: Intl.Collator, catalogs: MountCatalogs) {
  const panels = new Map(image?.panels.map(panel => [panel.panel_key, panel]));
  const panelNames = new Map(config.panels?.map(panel => [panel.panel_key, panel.display_name]));
  const panelNumber = (key: string) => panels.get(key)?.panel_number ?? Infinity;
  const bays = [...config.bays].sort((a, b) =>
    (panelNumber(a.panel_key) - panelNumber(b.panel_key)) ||
    compareKeys(a.panel_key, b.panel_key) ||
    collator.compare(mountTypeName(catalogs, a), mountTypeName(catalogs, b)) ||
    compareKeys(a.mount_kind, b.mount_kind) || compareKeys(mountTypeId(a), mountTypeId(b)) ||
    collator.compare(a.display_name, b.display_name) ||
    compareKeys(a.bay_key, b.bay_key)
  );
  const groups = new Map<string, { panelName: string; mount: ModuleMount; bays: typeof bays }>();
  for (const bay of bays) {
    const key = JSON.stringify([bay.panel_key, bay.mount_kind, mountTypeId(bay)]);
    let group = groups.get(key);
    if (!group) {
      group = {
        panelName: panels.get(bay.panel_key)?.display_name ?? panelNames.get(bay.panel_key) ?? bay.panel_key,
        mount: bay,
        bays: [],
      };
      groups.set(key, group);
    }
    group.bays.push(bay);
  }
  return groups;
}

const operationErrors: Partial<Record<string, MessageKey>> = {
  INVALID_MODULE_PARENT: 'hardware.error.parent',
  INVALID_MODULE_PLACE: 'hardware.error.place',
  MODULE_PLACE_OCCUPIED: 'hardware.error.occupied',
  MODULE_MOUNT_MISMATCH: 'hardware.error.mount',
  TRANSCEIVER_BINDING_REQUIRED: 'hardware.error.transceiver',
  UNSUPPORTED_TRANSCEIVER_TERMINATION: 'hardware.error.transceiverMember',
  HARDWARE_INTERFACE_ALREADY_BOUND: 'hardware.error.interfaceBound',
  MODULE_INSTALLATION_HAS_CHILDREN: 'hardware.error.children',
  MODULE_INSTALLATION_IN_USE: 'hardware.error.inUse',
};

const placeLabels = {
  MODULE_BAY: { group: 'hardware.boards', place: 'hardware.bay', component: 'hardware.board',
    select: 'hardware.selectBoard', empty: 'hardware.noBoards', remove: 'hardware.removeBoardConfirm' },
  MODULE_PORT: { group: 'hardware.transceivers', place: 'hardware.socket', component: 'hardware.transceiver',
    select: 'hardware.selectTransceiver', empty: 'hardware.noTransceivers', remove: 'hardware.removeTransceiverConfirm' },
} as const;
const mountKinds = ['MODULE_BAY', 'MODULE_PORT'] as const;

function placeChoiceKey(bayKey: string, parentId?: string) {
  return JSON.stringify([parentId ?? null, bayKey]);
}

function projectInstallationPosition(position: { x: number; y: number }, saved: ModuleInstallation['layout'], displayed: ModuleInstallation['layout']) {
  return {
    x: displayed.x + (position.x - saved.x) / saved.width * displayed.width,
    y: displayed.y + (position.y - saved.y) / saved.height * displayed.height,
  };
}

function SocketMarker({ cx, cy, r, name, installation, placeKey, color }: {
  cx: number; cy: number; r: number; name: string; installation?: ModuleInstallation; placeKey?: string; color?: string;
}) {
  const endpoint = installation?.endpoints[0];
  if (!endpoint) {
    return <EndpointMarker kind="MODULE_PORT" label={installation ? `${name} · ${installation.name}` : name}
      data-module-place-key={placeKey} data-occupied-socket={installation ? true : undefined}
      cx={cx} cy={cy} r={r} fill={installation ? '#66538a' : undefined}
      stroke={installation ? '#a39bbb' : '#0f172a'} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />;
  }
  const halfSide = r / Math.SQRT2 + r / 2;
  return <g pointerEvents="none">
    <rect data-transceiver-outline aria-hidden="true" x={cx - halfSide} y={cy - halfSide}
      width={2 * halfSide} height={2 * halfSide} rx={r / 4}
      fill="none" stroke="#94a3b8" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    <EndpointMarker kind="NETWORK_PORT" label={endpoint.contextual_display_name}
      data-endpoint-id={endpoint.connection_point_id} data-module-place-key={placeKey}
      cx={cx} cy={cy} r={r} fill={color} stroke="#0f172a" strokeWidth={1} vectorEffect="non-scaling-stroke" />
  </g>;
}

export function ModuleInstallationSection({ objectId, onInstalled, presentation, dataSource = hardwareModuleDataSource }: { objectId: string; presentation?: BlueprintPresentation; onInstalled: () => void | Promise<void>; dataSource?: HardwareModuleDataSource }) {
  const moduleTypes = useMountTypes();
  const { types: portTypes } = usePortTypes();
  const { t, collator } = useI18n(); const [config, setConfig] = useState<HardwareConfiguration>(); const [modules, setModules] = useState<ModuleTemplate[]>([]); const [error, setError] = useState(''); const [pending, setPending] = useState(false); const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [blockingCables, setBlockingCables] = useState<BlockingModuleCable[]>([]);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [draft, setDraft] = useState<ModuleInstallation['layout']>();
  const gesture = useRef<{ x: number; y: number; layout: ModuleInstallation['layout']; resize: boolean } | undefined>(undefined);
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = viewport.current!;
    // Height is an output of the layout. Only width feeds back into it.
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  // The projection is the existing Map presentation of the pinned base revision.
  // Do not combine a stale projection with a different configuration revision.
  const image = presentation && config?.base_revision_id === presentation.version_ref.entity_id ? presentation : undefined;
  const groups = config && groupBays(config, image, collator, moduleTypes);
  const bounds = image?.panels.length ? panelCompositionBounds(image.panels) : undefined;
  const contentWidth = Math.max(1, width - 40);
  const verticalPadding = editing ? 40 : 24;
  const height = bounds
    ? editing ? 360 : Math.min(360, Math.max(140, Math.ceil(contentWidth * bounds.height / bounds.width + verticalPadding)))
    : undefined;
  const scale = bounds && height ? Math.min(contentWidth / bounds.width, (height - verticalPadding) / bounds.height) : 1;
  const modulePorts = new Set([
    ...config?.bays.flatMap(b => b.installation?.endpoints ?? []) ?? [],
    ...config?.nested_installations?.flatMap(i => i.endpoints) ?? [],
  ].map(e => e.connection_point_id));
  const hasInstalledBoard = config?.bays.some(b => b.mount_kind === 'MODULE_BAY' && b.installation);
  const selectedBay = config?.bays.find(b => b.mount_kind === 'MODULE_BAY' && b.installation?.id === selected);
  const installed = selectedBay?.installation;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(installed?.layout);
  const cancel = () => { setDraft(undefined); setSelected(undefined); setError(''); gesture.current = undefined; };
  useEffect(() => { setEditing(false); setRefreshFailed(false); setBlockingCables([]); cancel(); }, [objectId]);
  const save = async () => {
    if (!installed || !draft || !config || !dataSource.saveLayout || pending) return;
    setPending(true); setError('');
    try {
      const confirmed = await dataSource.saveLayout(objectId, installed.id, {
        configuration_id: config.configuration_id, base_revision_id: config.base_revision_id,
        module_revision_id: installed.module_revision_id, bay_key: selectedBay!.bay_key,
        orientation: installed.orientation, expected_layout: installed.layout, layout: draft,
      });
      setConfig(confirmed); setDraft(undefined);
      await onInstalled();
    } catch(e) { showOperationError(e); }
    finally { setPending(false); }
  };
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, { module: string; orientation: 'HORIZONTAL' | 'VERTICAL' }>>({});
  useEffect(() => { let active = true; setConfig(undefined); setError(''); setChoices({}); setExpanded(new Set()); void Promise.all([dataSource.loadConfiguration(objectId), dataSource.listModules()]).then(([c, m]) => { if (active) { setConfig(c); setModules(m.modules); } }, e => { if(active) setError(t('hardware.failed', { error: String(e) })); }); return () => { active = false; }; }, [objectId, dataSource, retry, t]);
  const showOperationError = (error: unknown, removal?: { name: string; bay: string }) => {
    const key = error instanceof HardwareModuleError && operationErrors[error.reason ?? ''];
    const cables = error instanceof HardwareModuleError ? error.blockingCables : [];
    setBlockingCables(cables);
    setError(removal && cables.length ? t('hardware.error.transceiverConnected', removal)
      : key ? t(key) : t('hardware.failed', { error: String(error) }));
  };
  const cableEnd = (endpoint: BlockingModuleCableEndpoint) => {
    const panel = endpoint.panel;
    const panelLabel = panel ? [panel.name, panel.face && t(panel.face === 'FRONT' ? 'face.front' : 'face.rear'),
      `#${panel.number}`].filter(Boolean).join(' · ') : '';
    return physicalEndpointAddress(endpoint.object_label ?? t('hardware.unnamedObject'), panelLabel,
      endpoint.point_label ?? t('physical.port'), endpoint, endpoint.member_index ?? undefined, false,
      endpoint.location_path.map(location => location.name));
  };
  const install = async (bay: ModuleBay, parentId?: string) => {
    const choice = choices[placeChoiceKey(bay.bay_key, parentId)];
    if (!choice?.module || pending) return;
    setPending(true); setError(''); setBlockingCables([]);
    try {
      setConfig(await dataSource.installModule(objectId, {
        bay_key: bay.bay_key, ...(parentId ? { parent_installation_id: parentId } : {}),
        module_template_id: choice.module, orientation: bay.mount_kind === 'MODULE_BAY' ? choice.orientation : 'HORIZONTAL',
      }));
      await onInstalled();
    } catch(e) { showOperationError(e); }
    finally { setPending(false); }
  };
  const refreshAfterRemoval = async () => {
    setRefreshFailed(false);
    try { await onInstalled(); }
    catch { setRefreshFailed(true); }
  };
  const uninstall = async (installationId: string, name: string, bay: ModuleBay) => {
    if (pending || !window.confirm(t(placeLabels[bay.mount_kind].remove, { name, bay: bay.display_name }))) return;
    setPending(true); setError(''); setBlockingCables([]);
    try {
      setConfig(await dataSource.uninstallModule(objectId, installationId));
      await refreshAfterRemoval();
    }
    catch(e) { showOperationError(e, { name, bay: bay.display_name }); }
    finally { setPending(false); }
  };
  const nested = new Map(config?.nested_installations?.map(item => [item.id, item]));
  const header = (kind: MountKind) => <tr>
    <th scope="col">{t(placeLabels[kind].place)}</th>
    <th scope="col">{t(placeLabels[kind].component)}</th>
    {kind === 'MODULE_BAY' && <th scope="col">{t('hardware.orientation')}</th>}
    <th scope="col">{t('hardware.action')}</th>
  </tr>;
  const renderPlace = (bay: ModuleBay & { network_interface_id?: string }, installation: ModuleInstallation | undefined, parentId?: string, parentIsRootBoard = false) => {
    const labels = placeLabels[bay.mount_kind];
    const installable = !parentId || (parentIsRootBoard && bay.mount_kind === 'MODULE_PORT');
    const matches = installable ? modules.filter(module =>
      module.mount_kind === bay.mount_kind && mountTypeId(module) === mountTypeId(bay)
    ) : [];
    const compatible = bay.mount_kind === 'MODULE_PORT' ? matches.filter(({ endpoints }) =>
      endpoints.length === 0 || (bay.network_interface_id && endpoints.length === 1
        && endpoints[0].kind === 'CONNECTION_POINT'
        && portTypes?.some(type => type.id === endpoints[0].port_type_id
          && (type.cardinality === 1 || (type.medium === 'FIBER' && type.cardinality === 2))))) : matches;
    const physicalTransceiver = bay.mount_kind === 'MODULE_PORT'
      && installation?.endpoints.some(endpoint => endpoint.kind === 'CONNECTION_POINT');
    const hasPhysicalChild = installation?.module_places?.some(place =>
      place.mount_kind === 'MODULE_PORT' && nested.get(place.installation_id ?? '')?.endpoints.length);
    const choiceKey = placeChoiceKey(bay.bay_key, parentId);
    const choice = choices[choiceKey] ?? { module: '', orientation: 'HORIZONTAL' as const };
    const disabled = pending || editing;
    const children = installation?.module_places ?? [];
    return <tr key={bay.bay_key} data-bay-key={bay.bay_key}>
      <th scope="row">{bay.display_name}
        {bay.network_interface_id && <div title={bay.network_interface_id}>
          {t('hardware.parentInterface')} · <code>{bay.network_interface_id.slice(0, 8)}</code>
        </div>}
      </th>
      <td>{installation ? <>
        {installation.name}
        {installation.endpoints.length > 0 && <details key={installation.id}>
          <summary>{t('hardware.ports')}</summary>
          <ul>{installation.endpoints.map(endpoint => <li key={endpoint.connection_point_id} data-connection-point-id={endpoint.connection_point_id}>
            {endpoint.contextual_display_name}
            {physicalTransceiver && endpoint.members?.length > 0 &&
              <div>{t('transceiver.members', { count: endpoint.cardinality })} · {endpoint.members.join(', ')}</div>}
          </li>)}</ul>
        </details>}
        {children.length > 0 && <details key={installation.id + ':places'}
          onToggle={event => {
            const open = event.currentTarget.open;
            setExpanded(current => {
              const next = new Set(current);
              if (open) next.add(installation.id);
              else next.delete(installation.id);
              return next;
            });
          }}>
          <summary>{t(children.every(place => place.mount_kind === 'MODULE_PORT') ? 'hardware.transceiverSockets' : 'hardware.nestedPlaces')}</summary>
          {expanded.has(installation.id) && mountKinds.map(kind => {
            const places = children.filter(place => place.mount_kind === kind);
            return places.length > 0 && <table key={kind} className="ports-table" aria-label={t(placeLabels[kind].group)}>
              <thead>{header(kind)}</thead>
              <tbody>{places.map(place => renderPlace(
                place, nested.get(place.installation_id ?? ''), installation.id, !parentId && bay.mount_kind === 'MODULE_BAY',
              ))}</tbody>
            </table>;
          })}
        </details>}
      </> : compatible.length ? <select aria-label={t(labels.select)} disabled={disabled} value={choice.module}
        onChange={e => setChoices(old => ({ ...old, [choiceKey]: { ...choice, module: e.target.value } }))}>
        <option value="">{t(labels.select)}</option>
        {compatible.map(m => <option key={m.template_id} value={m.template_id}>{m.name}</option>)}
      </select> : t(matches.length ? (bay.network_interface_id ? 'hardware.error.transceiverMember' : 'hardware.error.transceiver')
        : installable ? labels.empty : 'hardware.historicalPlace')}</td>
      {bay.mount_kind === 'MODULE_BAY' && <td>{installation ? t(installation.orientation === 'VERTICAL' ? 'hardware.vertical' : 'hardware.horizontal') :
        installable && <select aria-label={t('hardware.orientation')} disabled={disabled || !compatible.length} value={choice.orientation}
          onChange={e => setChoices(old => ({ ...old, [choiceKey]: { ...choice, orientation: e.target.value as ModuleInstallation['orientation'] } }))}>
          <option value="HORIZONTAL">{t('hardware.horizontal')}</option>
          <option value="VERTICAL">{t('hardware.vertical')}</option>
        </select>}</td>}
      <td>{installation ?
        hasPhysicalChild
          ? <span>{t('hardware.error.children')}</span>
          : <button type="button" className="text-action" disabled={disabled} onClick={() => void uninstall(installation.id, installation.name, bay)}>{t(physicalTransceiver ? 'hardware.extract' : 'hardware.uninstall')}</button> :
        installable && <button type="button" className="primary-action" disabled={disabled || !compatible.some(m => m.template_id === choice.module)} onClick={() => void install(bay, parentId)}>{t('hardware.install')}</button>}</td>
    </tr>;
  };
  return <section className="blueprint-editor-controls" aria-label={t('hardware.components')}><h2>{t('hardware.components')}</h2>
    {hasInstalledBoard && dataSource.saveLayout && <div className="module-installation-toolbar">
      <button className="secondary-action" disabled={pending || dirty || !image} onClick={() => { cancel(); setEditing(!editing); }}>{t(editing ? 'layout.done' : 'layout.edit')}</button>
      {editing && <><span>{t(dirty ? 'layout.unsaved' : 'layout.select')}</span>
        <button className="primary-action" disabled={!dirty || pending} onClick={() => void save()}>{t('layout.save')}</button>
        <button className="secondary-action" disabled={pending || !selected} onClick={cancel}>{t('layout.cancel')}</button>
        <button className="secondary-action" disabled={pending || !installed?.initial_layout} onClick={() => setDraft(installed!.initial_layout)}>{t('layout.reset')}</button></>}
    </div>}
    {error && <div role="alert">{error} {blockingCables.length > 0
      ? <ul>{blockingCables.map(cable => <li key={`${cable.cable_id}:${cable.connection_member_id}`}>
        {cable.label && <><strong>{cable.label}</strong> · </>}
        {cableEnd(cable.local)} ↔ {cableEnd(cable.remote)}
      </li>)}</ul>
      : !editing && <button type="button" className="secondary-action" onClick={() => setRetry(v => v + 1)}>{t('action.retry')}</button>}</div>}
    {refreshFailed && <p role="alert">{t('physical.loadFailed')} <button type="button" className="secondary-action"
      onClick={() => void refreshAfterRemoval()}>{t('action.retry')}</button></p>}
    {!config && !error && <p>{t('create.blueprintsLoading')}</p>}
    <div ref={viewport} style={{ width: '100%', height, minWidth: 0 }}>
    {config && !bounds && <p role="status">{t('layout.presentationUnavailable')}</p>}
    {image && bounds && height && width > 0 && <svg role="img" aria-label={t('blueprint.editor.preview')} width="100%" height="100%" viewBox={`${bounds.x - (width / scale - bounds.width) / 2} ${bounds.y - (height / scale - bounds.height) / 2} ${width / scale} ${height / scale}`} preserveAspectRatio="xMidYMid meet">
    {image.panels.map(panel => <svg key={panel.panel_key} role="img" aria-label={panel.display_name} viewBox={`0 0 ${panel.width} ${panel.height}`} x={panel.x} y={panel.y} width={panel.width} height={panel.height} overflow="visible" style={{ touchAction: editing ? 'none' : 'auto' }}
      onPointerMove={e => {
        const g = gesture.current; if (!g || !editing || pending) return;
        const svg = e.currentTarget; const matrix = svg.getScreenCTM(); if (!matrix) return;
        const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
        const dx = point.x / panel.width - g.x, dy = point.y / panel.height - g.y;
        const l = g.layout;
        if (g.resize) {
          const scale = Math.max(.01, Math.min(1 + (dx * l.width + dy * l.height) / (l.width ** 2 + l.height ** 2), (1-l.x)/l.width, (1-l.y)/l.height));
          setDraft({ ...l, width: l.width * scale, height: l.height * scale });
        } else setDraft({ ...l, x: Math.max(0, Math.min(1-l.width, l.x+dx)), y: Math.max(0, Math.min(1-l.height, l.y+dy)) });
      }} onPointerUp={() => { gesture.current = undefined; }} onPointerCancel={() => { gesture.current = undefined; }}>
      <rect data-panel-key={panel.panel_key} width={panel.width} height={panel.height} fill={image.body.fill_color ?? '#18383a'} stroke="#64748b" vectorEffect="non-scaling-stroke"><title>{panel.display_name}</title></rect>
      {image.slots.filter(s => s.panel_key === panel.panel_key && !s.installation_id && !modulePorts.has(s.connection_point_id)).map(s => <EndpointMarker key={s.connection_point_id} kind={s.kind} label={s.display_name} data-builtin-endpoint-id={s.connection_point_id} cx={s.panel_local_position.x * panel.width} cy={s.panel_local_position.y * panel.height} r={4 / scale} stroke="#0f172a" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
      {config!.bays.filter(b => b.panel_key === panel.panel_key).map(b => {
        const i = b.installation; const l = i?.id === selected && draft ? draft : i?.layout;
        if (b.mount_kind === 'MODULE_PORT') {
          const position = i?.endpoints[0] ?? (b.kind !== 'LOGICAL' ? modulePortPosition(b) :
            l && modulePortPosition(l));
          return position && <SocketMarker key={b.bay_key} name={b.display_name} installation={i ?? undefined}
            color={portTypes?.find(type => type.id === i?.endpoints[0]?.port_type_id)?.color}
            cx={position.x * panel.width} cy={position.y * panel.height} r={4 / scale} />;
        }
        const begin = (e: React.PointerEvent<SVGElement>, resize: boolean) => {
          if (!editing || pending || !i || !l || (dirty && selected !== i.id)) return;
          e.preventDefault();
          const svg = e.currentTarget.ownerSVGElement!; const matrix = svg.getScreenCTM(); if (!matrix) return;
          const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
          setSelected(i.id); setDraft(l); svg.setPointerCapture(e.pointerId);
          gesture.current = { x: point.x/panel.width, y: point.y/panel.height, layout: l, resize };
        };
        return <g key={b.bay_key}>
          {!i && b.kind !== "LOGICAL" && <EndpointMarker kind={b.mount_kind} label={b.display_name}
            cx={modulePortPosition(b).x * panel.width} cy={modulePortPosition(b).y * panel.height}
            r={4 / scale} stroke="#0f172a" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {i && l && <g>
            <rect data-installation-id={i.id} onPointerDown={e => begin(e, false)} x={l.x * panel.width} y={l.y * panel.height} width={l.width * panel.width} height={l.height * panel.height} fill={i.fill_color} stroke={editing && selected === i.id ? '#f59e0b' : 'none'} strokeWidth={1.5} vectorEffect="non-scaling-stroke"><title>{i.name}</title></rect>
            {i.module_places?.filter(place => place.mount_kind === 'MODULE_PORT').map(place => {
              // The configuration projects the pinned place through the installed orientation.
              const position = projectInstallationPosition(modulePortPosition(place.global_position), i.layout, l);
              const transceiver = nested.get(place.installation_id ?? '');
              return <SocketMarker key={place.bay_key} name={place.display_name} placeKey={place.bay_key}
                installation={transceiver} color={portTypes?.find(type => type.id === transceiver?.endpoints[0]?.port_type_id)?.color}
                cx={position.x * panel.width} cy={position.y * panel.height} r={4 / scale} />;
            })}
            {i.endpoints.map(e => {
              const position = projectInstallationPosition(e, i.layout, l);
              return <EndpointMarker key={e.connection_point_id} kind={e.kind} label={e.contextual_display_name}
                data-endpoint-id={e.connection_point_id} pointerEvents="none"
                cx={position.x * panel.width} cy={position.y * panel.height}
                r={4 / scale} stroke="#0f172a" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
            })}
            {editing && selected === i.id && <rect aria-label={t('layout.resize')} onPointerDown={e => begin(e, true)} x={(l.x+l.width)*panel.width-4/scale} y={(l.y+l.height)*panel.height-4/scale} width={8/scale} height={8/scale} fill="#f59e0b" style={{ cursor: 'nwse-resize' }} />}
          </g>}
        </g>;
      })}
    </svg>)}
    </svg>}
    </div>
    {mountKinds.map(kind => {
      const matches = Array.from(groups ?? []).filter(([, group]) => group.mount.mount_kind === kind);
      if (!matches.length) return null;
      const title = t(placeLabels[kind].group);
      return <div key={kind}>
        <h3>{title}</h3>
        <div className="ports-table-wrap module-installation-list" tabIndex={0} role="region" aria-label={title}>
          <table className="ports-table module-installation-table" aria-label={title}>
            <thead>{header(kind)}</thead>
            {matches.map(([key, group]) => <tbody key={key}>
              <tr><th className="module-installation-table__group" scope="rowgroup" colSpan={kind === 'MODULE_BAY' ? 4 : 3}>{group.panelName} · {mountTypeName(moduleTypes, group.mount)}</th></tr>
              {group.bays.map(bay => renderPlace(bay, bay.installation ?? undefined))}
            </tbody>)}
          </table>
        </div>
      </div>;
    })}
  </section>;
}
