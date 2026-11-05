import { useState } from 'react';
import { useI18n } from '../i18n';
import { ModuleGeometryEditor } from './ModuleGeometryEditor';
import { moduleEndpointPositions, type ModuleTemplateInput } from '../topology/hardwareModules';

export function ModuleTemplateEditor({ value, onChange, disabled = false }: {
  value: ModuleTemplateInput; onChange: (value: ModuleTemplateInput) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const selected = new Set(value.endpoints.filter(e => selection.has(e.key)).map(e => e.key));
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
        {value.endpoints.map((endpoint, index) => <fieldset className="endpoint-group" key={endpoint.key} data-selected={selected.has(endpoint.key)}>
          <legend><label className="module-template-editor__selection"><input type="checkbox" checked={selected.has(endpoint.key)} aria-label={t('moduleGeometry.select', { name: endpoint.display_name || String(index + 1) })} onChange={() => {
            const next = new Set(selected); if (next.has(endpoint.key)) next.delete(endpoint.key); else next.add(endpoint.key); setSelection(next);
          }} />{index + 1}</label></legend>
          <label>{t('hardware.name')}<input required value={endpoint.display_name} onChange={e => changeEndpoints(value.endpoints.map(d => d.key === endpoint.key ? { ...d, display_name: e.target.value } : d))} /></label>
          <label>{t('blueprint.endpoint.kind')}<select value={endpoint.kind} onChange={e => changeEndpoints(value.endpoints.map(d => d.key === endpoint.key ? { ...d, kind: e.target.value as typeof d.kind } : d))}><option value="NETWORK_PORT">{t('blueprint.endpoint.networkPort')}</option><option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option></select></label>
          <div className="module-template-editor__actions">{([-1, 1] as const).map(delta => <button type="button" key={delta} disabled={index + delta < 0 || index + delta >= value.endpoints.length} onClick={() => {
            const endpoints = [...value.endpoints]; [endpoints[index], endpoints[index + delta]] = [endpoints[index + delta], endpoints[index]]; changeEndpoints(endpoints);
          }}>{t(delta < 0 ? 'moduleReview.up' : 'moduleReview.down')}</button>)}
          <button type="button" onClick={() => changeEndpoints(value.endpoints.filter(d => d.key !== endpoint.key))}>{t('hardware.remove')}</button></div>
        </fieldset>)}
      </div>
    </aside>
    <ModuleGeometryEditor geometry={value.geometry} endpoints={value.endpoints} selectedKeys={selected} onSelectionChange={setSelection} onChange={disabled ? undefined : geometry => onChange({ ...value, geometry })} />
  </fieldset>;
}
