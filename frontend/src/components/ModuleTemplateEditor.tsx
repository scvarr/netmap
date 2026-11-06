import { useState } from 'react';
import { PortTypeNotice, PortTypeSelect, usePortTypes } from './PortTypeSelect';
import type { BlueprintSlotKind } from '../topology/baseTemplateTypes';
import { useI18n } from '../i18n';
import { ModuleGeometryEditor } from './ModuleGeometryEditor';
import { moduleEndpointPositions, type ModuleTemplateInput } from '../topology/hardwareModules';

function CoordinateInput({ value, label, onCommit }: { value: number; label: string; onCommit: (value: number) => void }) {
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
  const [portTypeId, setPortTypeId] = useState('');
  const [kind, setKind] = useState<BlueprintSlotKind>('NETWORK_PORT');
  const [count, setCount] = useState(1);
  const [selection, setSelection] = useState<Set<string>>(() => new Set(value.endpoints.slice(0, 1).map(e => e.key)));
  const selected = new Set(value.endpoints.filter(e => selection.has(e.key)).map(e => e.key));
  const active = value.endpoints.find(e => selected.has(e.key));
  const changeEndpoints = (endpoints: ModuleTemplateInput['endpoints']) => onChange({ ...value, endpoints,
    geometry: { ...value.geometry, endpoints: moduleEndpointPositions(endpoints, value.geometry.endpoints) } });
  return <fieldset disabled={disabled} className="module-template-editor">
    <aside className="blueprint-editor-controls module-template-editor__controls">
      <label>{t('hardware.name')}<input required value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} /></label>
      <label>{t('hardware.compatibility')}<input required value={value.compatibility} onChange={e => onChange({ ...value, compatibility: e.target.value })} /></label>
      <h2>{t('moduleReview.endpoints')}</h2>
      <p role="status">{t('blueprint.layout.selected', { count: selected.size })}</p>
      <PortTypeNotice {...catalog} />
      <label>{t('blueprint.endpoint.kind')}<select value={kind} onChange={event => setKind(event.target.value as BlueprintSlotKind)}>
        <option value="NETWORK_PORT">{t('blueprint.endpoint.networkPort')}</option>
        <option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option>
      </select></label>
      <PortTypeSelect types={catalog.types} value={portTypeId} onChange={setPortTypeId} />
      <label>{t('blueprint.endpoint.count')}<input type="number" min={1} max={256} value={count} onChange={event => setCount(Number(event.target.value))} /></label>
      <button type="button" className="secondary-action" disabled={
        !catalog.types?.some(type => type.id === portTypeId && type.is_active) || !Number.isInteger(count) || count < 1 || count > 256
      } onClick={() => {
        const added = Array.from({ length: count }, (_, index) => ({
          key: crypto.randomUUID(), display_name: count === 1 ? '' : String(value.endpoints.length + index + 1), kind, port_type_id: portTypeId,
        }));
        changeEndpoints([...value.endpoints, ...added]);
        setSelection(new Set(added.map(endpoint => endpoint.key)));
      }}>{t('hardware.addEndpoint')}</button>
      {selected.size > 1 && <PortTypeSelect bulk types={catalog.types} value="" onChange={id =>
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
      </div>
      {active && (() => { const endpoint = active; const index = value.endpoints.indexOf(endpoint); return <fieldset className="endpoint-group">
          <legend>{t('moduleGeometry.portDetails')}</legend>
          <label>{t('hardware.name')}<input required value={endpoint.display_name} onChange={e => changeEndpoints(value.endpoints.map(d => d.key === endpoint.key ? { ...d, display_name: e.target.value } : d))} /></label>
          <PortTypeSelect types={catalog.types} value={endpoint.port_type_id} onChange={id =>
            changeEndpoints(value.endpoints.map(item => item.key === endpoint.key ? { ...item, port_type_id: id } : item))
          } />
          <label>{t('blueprint.endpoint.kind')}<select value={endpoint.kind} onChange={e => changeEndpoints(value.endpoints.map(d => d.key === endpoint.key ? { ...d, kind: e.target.value as typeof d.kind } : d))}><option value="NETWORK_PORT">{t('blueprint.endpoint.networkPort')}</option><option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option></select></label>
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
    <ModuleGeometryEditor portTypes={catalog.types} geometry={value.geometry} endpoints={value.endpoints} selectedKeys={selected} onSelectionChange={setSelection} onChange={disabled ? undefined : geometry => onChange({ ...value, geometry })} />
  </fieldset>;
}
