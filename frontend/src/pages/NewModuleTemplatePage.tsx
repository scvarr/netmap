import { moduleMount, mountTypeId } from '../topology/hardwareModules';
import { moduleEndpointPositions } from '../topology/hardwareModules';
import { ModuleTemplateEditor } from '../components/ModuleTemplateEditor';
import { TransceiverTemplateForm } from '../components/TransceiverTemplateForm';
import { initialModuleGeometry } from '../topology/hardwareModules';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Breadcrumbs, PageHeader, PageShell } from '../components/PageChrome';
import { useI18n } from '../i18n';
import { hardwareModuleDataSource, type HardwareModuleDataSource, type ModuleTemplateInput } from '../topology/hardwareModules';

export function NewModuleTemplatePage({ dataSource = hardwareModuleDataSource, transceiver = false }: {
  dataSource?: HardwareModuleDataSource; transceiver?: boolean;
}) {
  const { t } = useI18n(); const navigate = useNavigate();
  const copy = useLocation().state?.moduleCopy as ModuleTemplateInput | undefined;
  const unsupportedCopy = Boolean(copy?.internal_links?.length);
  const kind = transceiver ? 'MODULE_PORT' : 'MODULE_BAY';
  const title = t(transceiver ? 'transceiver.new' : 'hardware.newModule');
  const library = '/library/base-templates?tab=' + (transceiver ? 'transceivers' : 'modules');
  const [definition, setDefinition] = useState<ModuleTemplateInput>(() => !unsupportedCopy && copy?.mount_kind === kind
    ? { ...copy, name: t('templateCopy.name', { name: copy.name }),
        module_places: copy.module_places?.map(port => port.hardware_interface_key
          ? { ...port, hardware_interface_key: crypto.randomUUID() } : port) }
    : { name: '', ...moduleMount(kind, ''), endpoints: [], geometry: initialModuleGeometry() });
  const { name, endpoints, geometry, module_places } = definition;
  const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  const save = async () => { setPending(true); setError(''); try { await dataSource.createModule({ ...definition, geometry: { ...geometry, endpoints: moduleEndpointPositions(endpoints, geometry.endpoints) } }); navigate(library); } catch (e) { setError(t('hardware.failed', { error: String(e) })); } finally { setPending(false); } };
  return <PageShell className="catalog-page">
    <Breadcrumbs label={t('blueprint.breadcrumb.library')} items={[{ label: t(transceiver ? 'transceiver.library' : 'templateLibrary.modules'), to: library }, { label: title }]} />
    <PageHeader title={title} />
    {unsupportedCopy ? <p role="alert">{t('templateCopy.moduleWiringUnsupported')}</p>
      : <form className="module-template-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      {transceiver ? <TransceiverTemplateForm creating disabled={pending} value={definition} onChange={setDefinition} />
        : <ModuleTemplateEditor disabled={pending} value={definition} onChange={setDefinition} />}
      {error && <p role="alert">{error}</p>}<button type="submit" className="primary-action" disabled={pending || !name.trim() || !mountTypeId(definition) || (transceiver && endpoints.length !== 1) || endpoints.some(e => !e.display_name.trim()) || module_places?.some(port => !port.display_name.trim() || !mountTypeId(port))}>{t('hardware.save')}</button>
    </form>}
  </PageShell>;
}
