import { moduleEndpointPositions } from '../topology/hardwareModules';
import { ModuleTemplateEditor } from '../components/ModuleTemplateEditor';
import { initialModuleGeometry } from '../topology/hardwareModules';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader, PageShell } from '../components/PageChrome';
import { useI18n } from '../i18n';
import { hardwareModuleDataSource, type HardwareModuleDataSource, type ModuleTemplateInput } from '../topology/hardwareModules';

export function NewModuleTemplatePage({ dataSource = hardwareModuleDataSource }: { dataSource?: HardwareModuleDataSource }) {
  const { t } = useI18n(); const navigate = useNavigate();
  const copy = useLocation().state?.moduleCopy as ModuleTemplateInput | undefined;
  const [definition, setDefinition] = useState<ModuleTemplateInput>(() => copy
    ? { ...copy, name: t('templateCopy.name', { name: copy.name }) }
    : { name: '', module_port_type_id: '', endpoints: [], geometry: initialModuleGeometry() });
  const { name, module_port_type_id, endpoints, geometry, module_ports } = definition;
  const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  const save = async () => { setPending(true); setError(''); try { await dataSource.createModule({ ...definition, geometry: { ...geometry, endpoints: moduleEndpointPositions(endpoints, geometry.endpoints) } }); navigate('/library/base-templates'); } catch (e) { setError(t('hardware.failed', { error: String(e) })); } finally { setPending(false); } };
  return <PageShell className="catalog-page"><PageHeader title={t('hardware.newModule')} eyebrow={t('hardware.templates')} />
    <form className="module-template-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <ModuleTemplateEditor disabled={pending} value={definition} onChange={setDefinition} />
      {error && <p role="alert">{error}</p>}<button type="submit" className="primary-action" disabled={pending || !name.trim() || !module_port_type_id.trim() || endpoints.some(e => !e.display_name.trim()) || module_ports?.some(port => !port.display_name.trim() || !port.module_port_type_id.trim())}>{t('hardware.save')}</button>
    </form>
  </PageShell>;
}
