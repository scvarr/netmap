import { moduleEndpointPositions } from '../topology/hardwareModules';
import { ModuleGeometryEditor } from '../components/ModuleGeometryEditor';
import { initialModuleGeometry } from '../topology/hardwareModules';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, PageShell } from '../components/PageChrome';
import { useI18n } from '../i18n';
import { hardwareModuleDataSource, type HardwareModuleDataSource, type ModuleEndpoint } from '../topology/hardwareModules';

export function NewModuleTemplatePage({ dataSource = hardwareModuleDataSource }: { dataSource?: HardwareModuleDataSource }) {
  const { t } = useI18n(); const navigate = useNavigate();
  const [geometry, setGeometry] = useState(initialModuleGeometry);
  const [name, setName] = useState(''); const [compatibility, setCompatibility] = useState('');
  const [endpoints, setEndpoints] = useState<ModuleEndpoint[]>([]); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  useEffect(() => { setGeometry(g => ({ ...g, endpoints: moduleEndpointPositions(endpoints, g.endpoints) })); }, [endpoints]);
  const save = async () => { setPending(true); setError(''); try { await dataSource.createModule({ name, compatibility, endpoints, geometry: { ...geometry, endpoints: moduleEndpointPositions(endpoints, geometry.endpoints) } }); navigate('/library/base-templates'); } catch (e) { setError(t('hardware.failed', { error: String(e) })); } finally { setPending(false); } };
  return <PageShell className="catalog-page"><PageHeader title={t('hardware.newModule')} eyebrow={t('hardware.templates')} />
    <form className="blueprint-editor-controls" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>{t('hardware.name')}<input required value={name} onChange={e => setName(e.target.value)} /></label>
      <label>{t('hardware.compatibility')}<input required value={compatibility} onChange={e => setCompatibility(e.target.value)} /></label>
      <ModuleGeometryEditor geometry={{ ...geometry, endpoints: moduleEndpointPositions(endpoints, geometry.endpoints) }} endpoints={endpoints} onChange={setGeometry} />
      {endpoints.map((endpoint, index) => <fieldset className="endpoint-group" key={endpoint.key}><legend>{index + 1}</legend>
        <label>{t('hardware.name')}<input required value={endpoint.display_name} onChange={e => setEndpoints(old => old.map(d => d.key === endpoint.key ? { ...d, display_name: e.target.value } : d))} /></label>
        <label>{t('blueprint.endpoint.kind')}<select value={endpoint.kind} onChange={e => setEndpoints(old => old.map(d => d.key === endpoint.key ? { ...d, kind: e.target.value as ModuleEndpoint['kind'] } : d))}><option value="NETWORK_PORT">{t('blueprint.endpoint.networkPort')}</option><option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option></select></label>
        {([-1, 1] as const).map(delta => <button type="button" key={delta} disabled={index + delta < 0 || index + delta >= endpoints.length} onClick={() => setEndpoints(old => { const next = [...old]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next; })}>{t(delta < 0 ? 'moduleReview.up' : 'moduleReview.down')}</button>)}
        <button type="button" className="text-action" onClick={() => setEndpoints(old => old.filter(d => d.key !== endpoint.key))}>{t('hardware.remove')}</button>
      </fieldset>)}
      <button type="button" className="secondary-action" onClick={() => setEndpoints(old => [...old, { key: crypto.randomUUID(), display_name: '', kind: 'NETWORK_PORT' }])}>{t('hardware.addEndpoint')}</button>
      {error && <p role="alert">{error}</p>}<button type="submit" className="primary-action" disabled={pending || !name.trim() || !compatibility.trim() || endpoints.some(e => !e.display_name.trim())}>{t('hardware.save')}</button>
    </form>
  </PageShell>;
}
