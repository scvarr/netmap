import { isModulePlaceMarker, isMountKind, moduleMount, mountTypeId, type ModuleMount, type ModulePlaceDefinition } from '../topology/hardwareModules';
import { ModuleMountFields, MountTypeSelect, mountKindLabels, useMountTypes } from './ModulePortTypeSelect';
import { useState } from 'react';
import { PortTypeSelect, usePortTypes } from './PortTypeSelect';
import { TemplateElementCreator } from './TemplateElementKindSelect';
import { useI18n } from '../i18n';
import { ModuleGeometryEditor } from './ModuleGeometryEditor';
import { moduleEndpointPositions, modulePortPosition, positionModulePort, type ModuleGeometry, type ModulePortMarker, type ModuleTemplateInput } from '../topology/hardwareModules';

function CoordinateInput({ value, label, onCommit }: {
  value: number; label: string; onCommit: (value: number) => void;
}) {
  const [text, setText] = useState<string>();
  const commit = () => {
    if (text !== undefined && text.trim()) {
      const number = Number(text);
      if (Number.isFinite(number) && number >= 0 && number <= 1) onCommit(Math.round(number * 100) / 100);
    }
    setText(undefined);
  };
  return <label>{label}<input type="number" min="0" max="1" step="0.01" value={text ?? value.toFixed(2)} onChange={event => setText(event.target.value)} onBlur={commit} onKeyDown={event => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { event.preventDefault(); setText(undefined); }
  }} /></label>;
}

export function ModuleTemplateEditor({ value, onChange, disabled = false }: {
  value: ModuleTemplateInput; onChange: (value: ModuleTemplateInput) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const catalog = usePortTypes();
  const moduleCatalog = useMountTypes();
  const places = value.module_places ?? [];
  const modulePorts = places.filter(port => port.mount_kind === 'MODULE_PORT' && value.mount_kind === 'MODULE_BAY');
  const unsupportedPlaces = places.filter(port => !modulePorts.includes(port));
  const moduleMarkers: ModulePortMarker[] = modulePorts.map(({ key, display_name, mount_kind }) => ({ key, display_name, kind: mount_kind }));
  const markers = [...value.endpoints, ...moduleMarkers];
  const [selection, setSelection] = useState<Set<string>>(() => new Set(markers.slice(0, 1).map(marker => marker.key)));
  const selected = new Set(markers.filter(marker => selection.has(marker.key)).map(marker => marker.key));
  const active = markers.find(marker => selected.has(marker.key));
  const physicalSelected = value.endpoints.filter(endpoint => selected.has(endpoint.key));
  const markerGeometry = { ...value.geometry, endpoints: {
    ...value.geometry.endpoints, ...Object.fromEntries(modulePorts.map(port => [port.key, modulePortPosition(port)])),
  } };
  const changeGeometry = (geometry: ModuleGeometry) => {
    onChange({ ...value,
      geometry: { ...geometry, endpoints: Object.fromEntries(value.endpoints.map(endpoint => [endpoint.key, geometry.endpoints[endpoint.key]])) },
      ...(value.module_places && { module_places: places.map(port => geometry.endpoints[port.key] ? positionModulePort(port, geometry.endpoints[port.key]) : port) }),
    });
  };
  const changeEndpoints = (endpoints: ModuleTemplateInput['endpoints']) => {
    const positions = moduleEndpointPositions([...endpoints, ...moduleMarkers], markerGeometry.endpoints);
    onChange({ ...value, endpoints, geometry: { ...value.geometry,
      endpoints: Object.fromEntries(endpoints.map(endpoint => [endpoint.key, positions[endpoint.key]])),
    } });
  };
  const addModuleBatch = (count: number, mount: ModuleMount) => {
    const names = new Set(markers.map(marker => marker.display_name));
    const prefix = t(mountKindLabels[mount.mount_kind]);
    let number = 1;
    const added = Array.from({ length: count }, () => {
      while (names.has(`${prefix} ${number}`)) number++;
      return { key: crypto.randomUUID(), display_name: `${prefix} ${number++}`, ...mount };
    });
    const positions = moduleEndpointPositions([...markers, ...added], markerGeometry.endpoints);
    onChange({ ...value, module_places: [...places, ...added.map(port => ({ ...port, ...positions[port.key] }))] });
    setSelection(new Set(added.map(port => port.key)));
    return true;
  };
  const updateModulePort = (key: string, patch: Partial<ModulePlaceDefinition>) =>
    onChange({ ...value, module_places: places.map(port => port.key === key ? { ...port, ...patch } as ModulePlaceDefinition : port) });
  const removeDefinitions = (keys: ReadonlySet<string>) => {
    const endpoints = value.endpoints.filter(endpoint => !keys.has(endpoint.key));
    onChange({ ...value, endpoints, geometry: { ...value.geometry, endpoints: moduleEndpointPositions(endpoints, value.geometry.endpoints) },
      ...(value.module_places && { module_places: places.filter(port => !keys.has(port.key)) }),
    });
    setSelection(old => new Set([...old].filter(key => !keys.has(key))));
  };
  return <fieldset disabled={disabled} className="module-template-editor">
    <aside className="blueprint-editor-controls module-template-editor__controls">
      <label>{t('hardware.name')}<input required value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} /></label>
      <ModuleMountFields catalogs={moduleCatalog} mount={value} onChange={mount => onChange({ ...value, ...mount })} />
      <h2>{t('blueprint.endpoint.elements')}</h2>
      <p role="status">{t('blueprint.layout.selected', { count: selected.size })}</p>
      <TemplateElementCreator moduleCatalog={moduleCatalog} catalog={catalog} allowModulePorts={value.mount_kind === 'MODULE_BAY'}
        onAddModulePlaces={addModuleBatch}
        onAddEndpoints={(kind, count, portTypeId) => {
          const added = Array.from({ length: count }, (_, index) => ({
            key: crypto.randomUUID(), display_name: count === 1 ? '' : String(value.endpoints.length + index + 1), kind, port_type_id: portTypeId,
          }));
          changeEndpoints([...value.endpoints, ...added]);
          setSelection(new Set(added.map(endpoint => endpoint.key)));
        }} />
      {unsupportedPlaces.length > 0 && <div>
        <p role="status">{t('moduleMount.removeUnsupportedPlaces')}</p>
        <ul>{unsupportedPlaces.map(place => <li key={place.key}>{place.display_name}{' '}
          <button type="button" onClick={() => removeDefinitions(new Set([place.key]))}>{t('hardware.remove')}</button>
        </li>)}</ul>
      </div>}
      {selected.size > 1 && physicalSelected.length > 0 && <PortTypeSelect bulk types={catalog.types} value=""
        singleMember={physicalSelected.some(endpoint => endpoint.kind === 'NETWORK_PORT')} onChange={id =>
        changeEndpoints(value.endpoints.map(endpoint => selected.has(endpoint.key) ? { ...endpoint, port_type_id: id } : endpoint))
      } />}
      <div className="module-template-editor__ports">
        {markers.map((marker, index) => <div className="module-template-editor__port-row" key={marker.key} data-selected={selected.has(marker.key)}>
          <input type="checkbox" checked={selected.has(marker.key)} aria-label={t('moduleGeometry.select', { name: marker.display_name || String(index + 1) })} onChange={() => {
            const next = new Set(selected);
            if (next.has(marker.key)) next.delete(marker.key); else next.add(marker.key);
            setSelection(next);
          }} />
          <button type="button" className="module-template-editor__port-name" onClick={() => setSelection(new Set([marker.key]))}>{marker.display_name || `#${index + 1}`}</button>
          <span>{t(isMountKind(marker.kind) ? mountKindLabels[marker.kind] : marker.kind === 'NETWORK_PORT' ? 'blueprint.endpoint.networkPort' : 'blueprint.endpoint.connectionPoint')}</span>
        </div>)}
      </div>
      {active && (() => {
        const isModulePort = isModulePlaceMarker(active);
        const definitions = isModulePort ? modulePorts : value.endpoints;
        const index = definitions.findIndex(item => item.key === active.key);
        const changeEndpoint = (patch: Partial<ModuleTemplateInput['endpoints'][number]>) =>
          changeEndpoints(value.endpoints.map(item => item.key === active.key ? { ...item, ...patch } : item));
        return <fieldset className="endpoint-group">
          <legend>{t(isMountKind(active.kind) ? mountKindLabels[active.kind] : 'moduleGeometry.portDetails')}</legend>
          <label>{t('hardware.name')}<input required value={active.display_name} onChange={event => {
            if (isModulePort) updateModulePort(active.key, { display_name: event.target.value });
            else changeEndpoint({ display_name: event.target.value });
          }} /></label>
          {isModulePort
            ? <MountTypeSelect types={moduleCatalog.MODULE_PORT.types} value={mountTypeId(modulePorts[index])}
                onChange={id => updateModulePort(active.key, moduleMount('MODULE_PORT', id))} />
            : <>
              <PortTypeSelect types={catalog.types} value={active.port_type_id} singleMember={active.kind === 'NETWORK_PORT'}
                onChange={port_type_id => changeEndpoint({ port_type_id })} />
              <label>{t('blueprint.endpoint.kind')}<select value={active.kind} onChange={event => changeEndpoint({ kind: event.target.value as typeof active.kind })}>
                <option value="NETWORK_PORT" disabled={(catalog.types?.find(type => type.id === active.port_type_id)?.cardinality ?? 1) > 1}>{t('blueprint.endpoint.networkPort')}</option>
                <option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option>
              </select></label>
            </>}
          <div className="blueprint-editor-controls__row">{(['x', 'y'] as const).map(axis => <CoordinateInput key={`${active.key}:${axis}`}
            label={t(`moduleGeometry.${axis}`)} value={markerGeometry.endpoints[active.key][axis]} onCommit={coordinate =>
              changeGeometry({ ...markerGeometry, endpoints: { ...markerGeometry.endpoints,
                [active.key]: { ...markerGeometry.endpoints[active.key], [axis]: coordinate },
              } })
            } />)}</div>
          <div className="module-template-editor__actions">{([-1, 1] as const).map(delta => <button type="button" key={delta}
            disabled={index + delta < 0 || index + delta >= definitions.length} onClick={() => {
              const order = [index, index + delta];
              const swap = <T,>(items: T[]) => items.map((item, i) => i === order[0] ? items[order[1]] : i === order[1] ? items[order[0]] : item);
              if (isModulePort) onChange({ ...value, module_places: swap(modulePorts).concat(unsupportedPlaces) });
              else changeEndpoints(swap(value.endpoints));
            }}>{t(delta < 0 ? 'moduleReview.up' : 'moduleReview.down')}</button>)}
            <button type="button" onClick={() => removeDefinitions(new Set([active.key]))}>{t('hardware.remove')}</button>
            {selected.size > 1 && <button type="button" onClick={() => removeDefinitions(selected)}>{t('blueprint.layout.deleteSelected')}</button>}
          </div>
        </fieldset>;
      })()}
    </aside>
    <ModuleGeometryEditor portTypes={catalog.types} geometry={markerGeometry} endpoints={markers}
      selectedKeys={selected} onSelectionChange={setSelection} onChange={disabled ? undefined : changeGeometry} />
  </fieldset>;
}
