import { useState } from 'react';
import { PortTypeSelect, usePortTypes } from './PortTypeSelect';
import { TemplateElementCreator } from './TemplateElementKindSelect';
import { bayNumericGeometry, minimumBaySize } from '../blueprints/moduleBayGeometry';
import { placeModulePorts } from '../blueprints/modulePortPlacement';
import { useI18n } from '../i18n';
import { ModuleGeometryEditor } from './ModuleGeometryEditor';
import { moduleEndpointPositions, type ModulePortDefinition, type ModuleTemplateInput } from '../topology/hardwareModules';

function CoordinateInput({ value, label, rectangle = false, min = 0, onCommit }: {
  value: number; label: string; rectangle?: boolean; min?: number; onCommit: (value: number) => void;
}) {
  const [text, setText] = useState<string>();
  const commit = () => {
    if (text !== undefined && text.trim()) {
      const number = Number(text);
      if (Number.isFinite(number) && number >= min && number <= 1) onCommit(Math.round(number * 100) / 100);
    }
    setText(undefined);
  };
  return <label>{label}<input type="number" min={Math.min(min, value)} max="1" step={rectangle ? 'any' : '0.01'} value={text ?? (rectangle ? value : value.toFixed(2))} onChange={event => setText(event.target.value)} onBlur={commit} onKeyDown={event => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { event.preventDefault(); setText(undefined); }
  }} /></label>;
}

export function ModuleTemplateEditor({ value, onChange, disabled = false }: {
  value: ModuleTemplateInput; onChange: (value: ModuleTemplateInput) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const catalog = usePortTypes();
  const modulePorts = value.module_ports ?? [];
  const [selection, setSelection] = useState<Set<string>>(() => new Set([...value.endpoints, ...modulePorts].slice(0, 1).map(e => e.key)));
  const selected = new Set(value.endpoints.filter(e => selection.has(e.key)).map(e => e.key));
  const active = value.endpoints.find(e => selected.has(e.key));
  const activeModulePort = modulePorts.find(port => selection.has(port.key));
  const updateModulePort = (key: string, patch: Partial<ModulePortDefinition>) =>
    onChange({ ...value, module_ports: modulePorts.map(port => port.key === key ? { ...port, ...patch } : port) });
  const changeEndpoints = (endpoints: ModuleTemplateInput['endpoints']) => onChange({ ...value, endpoints,
    geometry: { ...value.geometry, endpoints: moduleEndpointPositions(endpoints, value.geometry.endpoints) } });
  return <fieldset disabled={disabled} className="module-template-editor">
    <aside className="blueprint-editor-controls module-template-editor__controls">
      <label>{t('hardware.name')}<input required value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} /></label>
      <label>{t('hardware.compatibility')}<input required value={value.compatibility} onChange={e => onChange({ ...value, compatibility: e.target.value })} /></label>
      <h2>{t('blueprint.endpoint.elements')}</h2>
      <p role="status">{t('blueprint.layout.selected', { count: activeModulePort ? 1 : selected.size })}</p>
      <TemplateElementCreator catalog={catalog}
        onAddModulePorts={(count, compatibility) => {
          const added = placeModulePorts(count, compatibility, t('blueprint.endpoint.modulePort'),
            modulePorts.map(port => port.display_name), modulePorts, Object.values(value.geometry.endpoints));
          if (!added) return false;
          onChange({ ...value, module_ports: [...modulePorts, ...added] });
          setSelection(new Set([added[0].key]));
          return true;
        }}
        onAddEndpoints={(kind, count, portTypeId) => {
          const added = Array.from({ length: count }, (_, index) => ({
            key: crypto.randomUUID(), display_name: count === 1 ? '' : String(value.endpoints.length + index + 1), kind, port_type_id: portTypeId,
          }));
          changeEndpoints([...value.endpoints, ...added]);
          setSelection(new Set(added.map(endpoint => endpoint.key)));
        }} />
      {selected.size > 1 && <PortTypeSelect bulk types={catalog.types} value=""
        singleMember={value.endpoints.some(endpoint => selected.has(endpoint.key) && endpoint.kind === 'NETWORK_PORT')} onChange={id =>
        changeEndpoints(value.endpoints.map(endpoint => selected.has(endpoint.key) ? { ...endpoint, port_type_id: id } : endpoint))
      } />}
      <div className="module-template-editor__ports">
        {value.endpoints.map((endpoint, index) => <div className="module-template-editor__port-row" key={endpoint.key} data-selected={selected.has(endpoint.key)}>
          <input type="checkbox" checked={selected.has(endpoint.key)} aria-label={t('moduleGeometry.select', { name: endpoint.display_name || String(index + 1) })} onChange={() => {
            const next = new Set(selected); if (next.has(endpoint.key)) next.delete(endpoint.key); else next.add(endpoint.key); setSelection(next);
          }} />
          <button type="button" className="module-template-editor__port-name" onClick={() => setSelection(new Set([endpoint.key]))}>{endpoint.display_name || `#${index + 1}`}</button>
          <span>{t(endpoint.kind === 'NETWORK_PORT' ? 'blueprint.endpoint.networkPort' : 'blueprint.endpoint.connectionPoint')}</span>
        </div>)}
        {modulePorts.map(port => <div className="module-template-editor__port-row" key={port.key} data-selected={port.key === activeModulePort?.key}>
          <input type="checkbox" checked={port.key === activeModulePort?.key} aria-label={t('moduleGeometry.select', { name: port.display_name })} onChange={event => setSelection(new Set(event.target.checked ? [port.key] : []))} />
          <button type="button" className="module-template-editor__port-name" onClick={() => setSelection(new Set([port.key]))}>{port.display_name}</button>
          <span>{t('blueprint.endpoint.modulePort')}</span>
        </div>)}
      </div>
      {activeModulePort && <fieldset key={activeModulePort.key} className="endpoint-group">
        <legend>{t('blueprint.endpoint.modulePort')}</legend>
        <label>{t('hardware.name')}<input required value={activeModulePort.display_name} onChange={event => updateModulePort(activeModulePort.key, { display_name: event.target.value })} /></label>
        <label>{t('hardware.compatibility')}<input required value={activeModulePort.compatibility} onChange={event => updateModulePort(activeModulePort.key, { compatibility: event.target.value })} /></label>
        <div className="blueprint-editor-controls__row">
          {(['x', 'y', 'width', 'height'] as const).map(axis => <CoordinateInput key={axis} rectangle
            label={t(`moduleGeometry.${axis}`)} value={activeModulePort[axis]} min={axis === 'width' || axis === 'height' ? minimumBaySize : 0}
            onCommit={coordinate => updateModulePort(activeModulePort.key, bayNumericGeometry(activeModulePort, axis, coordinate))} />)}
        </div>
        <button type="button" onClick={() => {
          onChange({ ...value, module_ports: modulePorts.filter(port => port.key !== activeModulePort.key) });
          setSelection(new Set());
        }}>{t('hardware.remove')}</button>
      </fieldset>}
      {active && (() => { const endpoint = active; const index = value.endpoints.indexOf(endpoint); return <fieldset className="endpoint-group">
          <legend>{t('moduleGeometry.portDetails')}</legend>
          <label>{t('hardware.name')}<input required value={endpoint.display_name} onChange={e => changeEndpoints(value.endpoints.map(d => d.key === endpoint.key ? { ...d, display_name: e.target.value } : d))} /></label>
          <PortTypeSelect types={catalog.types} value={endpoint.port_type_id} singleMember={endpoint.kind === 'NETWORK_PORT'} onChange={id =>
            changeEndpoints(value.endpoints.map(item => item.key === endpoint.key ? { ...item, port_type_id: id } : item))
          } />
          <label>{t('blueprint.endpoint.kind')}<select value={endpoint.kind} onChange={e => changeEndpoints(value.endpoints.map(d => d.key === endpoint.key ? { ...d, kind: e.target.value as typeof d.kind } : d))}><option value="NETWORK_PORT" disabled={(catalog.types?.find(type => type.id === endpoint.port_type_id)?.cardinality ?? 1) > 1}>{t('blueprint.endpoint.networkPort')}</option><option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option></select></label>
          <div className="blueprint-editor-controls__row">{(['x', 'y'] as const).map(axis => <CoordinateInput key={`${endpoint.key}:${axis}`} label={t(axis === 'x' ? 'moduleGeometry.x' : 'moduleGeometry.y')} value={value.geometry.endpoints[endpoint.key][axis]} onCommit={coordinate => {
            onChange({ ...value, geometry: { ...value.geometry, endpoints: { ...value.geometry.endpoints,
              [endpoint.key]: { ...value.geometry.endpoints[endpoint.key], [axis]: coordinate } } } });
          }} />)}</div>
          <div className="module-template-editor__actions">{([-1, 1] as const).map(delta => <button type="button" key={delta} disabled={index + delta < 0 || index + delta >= value.endpoints.length} onClick={() => {
            const endpoints = [...value.endpoints]; [endpoints[index], endpoints[index + delta]] = [endpoints[index + delta], endpoints[index]]; changeEndpoints(endpoints);
          }}>{t(delta < 0 ? 'moduleReview.up' : 'moduleReview.down')}</button>)}
          <button type="button" onClick={() => changeEndpoints(value.endpoints.filter(d => d.key !== endpoint.key))}>{t('hardware.remove')}</button></div>
        </fieldset>; })()}
    </aside>
    <ModuleGeometryEditor portTypes={catalog.types} geometry={value.geometry} endpoints={value.endpoints}
      modulePorts={modulePorts} selectedKeys={selection} onSelectionChange={setSelection}
      onChange={disabled ? undefined : geometry => onChange({ ...value, geometry })} />
  </fieldset>;
}
