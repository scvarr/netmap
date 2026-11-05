import { useState } from 'react';
import { useI18n } from '../i18n';
import { ModuleGeometryEditor } from './ModuleGeometryEditor';
import { moduleEndpointPositions, type ModuleTemplateInput } from '../topology/hardwareModules';

export function ModuleTemplateEditor({ value, onChange, disabled = false }: {
  value: ModuleTemplateInput; onChange: (value: ModuleTemplateInput) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
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
      <button type="button" className="secondary-action" onClick={() => {
        const key = crypto.randomUUID(); changeEndpoints([...value.endpoints, { key, display_name: '', kind: 'NETWORK_PORT' }]); setSelection(new Set([key]));
      }}>{t('hardware.addEndpoint')}</button>
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
          <label>{t('blueprint.endpoint.kind')}<select value={endpoint.kind} onChange={e => changeEndpoints(value.endpoints.map(d => d.key === endpoint.key ? { ...d, kind: e.target.value as typeof d.kind } : d))}><option value="NETWORK_PORT">{t('blueprint.endpoint.networkPort')}</option><option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option></select></label>
          <div className="blueprint-editor-controls__row">{(['x', 'y'] as const).map(axis => <label key={axis}>{t(axis === 'x' ? 'moduleGeometry.x' : 'moduleGeometry.y')}<input type="number" min="0" max="1" step="0.01" value={value.geometry.endpoints[endpoint.key][axis].toFixed(2)} onChange={event => {
            if (!event.target.value.trim()) return;
            const coordinate = Number(event.target.value);
            if (!Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1) return;
            onChange({ ...value, geometry: { ...value.geometry, endpoints: { ...value.geometry.endpoints,
              [endpoint.key]: { ...value.geometry.endpoints[endpoint.key], [axis]: Math.round(coordinate * 100) / 100 } } } });
          }} /></label>)}</div>
          <div className="module-template-editor__actions">{([-1, 1] as const).map(delta => <button type="button" key={delta} disabled={index + delta < 0 || index + delta >= value.endpoints.length} onClick={() => {
            const endpoints = [...value.endpoints]; [endpoints[index], endpoints[index + delta]] = [endpoints[index + delta], endpoints[index]]; changeEndpoints(endpoints);
          }}>{t(delta < 0 ? 'moduleReview.up' : 'moduleReview.down')}</button>)}
          <button type="button" onClick={() => changeEndpoints(value.endpoints.filter(d => d.key !== endpoint.key))}>{t('hardware.remove')}</button></div>
        </fieldset>; })()}
    </aside>
    <ModuleGeometryEditor geometry={value.geometry} endpoints={value.endpoints} selectedKeys={selected} onSelectionChange={setSelection} onChange={disabled ? undefined : geometry => onChange({ ...value, geometry })} />
  </fieldset>;
}
