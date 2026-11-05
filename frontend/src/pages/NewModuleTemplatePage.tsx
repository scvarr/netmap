import { moduleEndpointPositions } from '../topology/hardwareModules';
import { ModuleTemplateEditor } from '../components/ModuleTemplateEditor';
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
    <form className="module-template-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <ModuleTemplateEditor disabled={pending} value={{ name, compatibility, endpoints, geometry: { ...geometry, endpoints: moduleEndpointPositions(endpoints, geometry.endpoints) } }} onChange={value => { setName(value.name); setCompatibility(value.compatibility); setEndpoints(value.endpoints); setGeometry(value.geometry); }} />
      {error && <p role="alert">{error}</p>}<button type="submit" className="primary-action" disabled={pending || !name.trim() || !compatibility.trim() || endpoints.some(e => !e.display_name.trim())}>{t('hardware.save')}</button>
    </form>
  </PageShell>;
}
