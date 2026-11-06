import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePortTypes, type PortType } from '../components/PortTypeSelect';
import { BlueprintPreview } from '../components/BlueprintPreview';
import { PageHeader, PageShell } from '../components/PageChrome';
import { useI18n } from '../i18n';
import type { BaseTemplateDataSource, BaseTemplateListItem, BaseTemplateRevisionDocument } from '../topology/baseTemplateTypes';
import { hardwareModuleDataSource, type HardwareModuleDataSource, type ModuleTemplate } from '../topology/hardwareModules';

const tabs = ['objects', 'modules'] as const;
type Tab = typeof tabs[number];
type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'failed'; error: string };
type Publication = Pick<NonNullable<BaseTemplateListItem['publication_state']>, 'outdated_count' | 'awaiting_update_count' | 'requires_intervention_count'>;

function PublicationWarnings({ state }: { state?: Publication }) {
  const { t } = useI18n();
  if (!state) return null;
  const warnings = [
    ['publication.outdated', state.outdated_count],
    ['publication.awaiting', state.awaiting_update_count],
    ['publication.intervention', state.requires_intervention_count],
  ] as const;
  return warnings.filter(([, count]) => count > 0).map(([key, count]) =>
    <span className="template-library-warning" key={key}>{t(key, { count })}</span>);
}

function TemplateRow({ name, metadata, ports, publication, expanded, onToggle, children }: {
  name: string; metadata: string; ports: number; publication?: Publication;
  expanded: boolean; onToggle: () => void; children: ReactNode;
}) {
  const { t } = useI18n();
  const detailId = useId();
  return <li className="template-library-row">
    <button type="button" className="secondary-action template-library-summary"
      aria-expanded={expanded} aria-controls={detailId} onClick={onToggle}>
      <strong><span aria-hidden="true">{expanded ? '▾' : '▸'} </span>{name}</strong>
      <span>{metadata}</span>
      <span>{t('physical.portCount', { count: ports })}</span>
      <PublicationWarnings state={publication} />
    </button>
    <div id={detailId} hidden={!expanded} className="template-library-detail">
      {expanded && children}
    </div>
  </li>;
}

function ModulePreview({ module, portTypes }: { module: ModuleTemplate; portTypes?: PortType[] }) {
  const { geometry, endpoints, name } = module;
  const panel = { panel_key: 'body', panel_number: 1, display_name: name, x: 0, y: 0, width: geometry.width, height: geometry.height };
  const slots = endpoints.flatMap(endpoint => {
    const position = geometry.endpoints[endpoint.key];
    return position ? [{ ...endpoint, panel_key: panel.panel_key, rendered_position: position }] : [];
  });
  return <BlueprintPreview portTypes={portTypes} label={name} panels={[panel]} slots={slots}
    body={{ kind: 'RECTANGLE', width: geometry.width, height: geometry.height, fill_color: geometry.fill_color }} />;
}

export function BaseTemplateLibraryPage({ dataSource, moduleDataSource = hardwareModuleDataSource }: {
  dataSource: BaseTemplateDataSource; moduleDataSource?: HardwareModuleDataSource;
}) {
  const { t } = useI18n();
  const id = useId();
  const { types: portTypes } = usePortTypes();
  const [tab, setTab] = useState<Tab>('objects');
  const [expanded, setExpanded] = useState<Partial<Record<Tab, string>>>({});
  const [bases, setBases] = useState<Load<BaseTemplateListItem[]>>({ status: 'loading' });
  const [modules, setModules] = useState<Load<ModuleTemplate[]>>({ status: 'loading' });
  const [deleteError, setDeleteError] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const [previews, setPreviews] = useState<Record<string, Load<BaseTemplateRevisionDocument>>>({});

  useEffect(() => {
    let active = true;
    setBases({ status: 'loading' });
    setModules({ status: 'loading' });
    setExpanded(previous => ({ modules: previous.modules }));
    setPreviews({});
    void dataSource.loadBaseTemplates().then(
      result => { if (active) setBases({ status: 'ready', data: result.blueprints }); },
      error => { if (active) setBases({ status: 'failed', error: String(error) }); },
    );
    void moduleDataSource.listModules().then(
      result => { if (active) setModules({ status: 'ready', data: result.modules }); },
      error => { if (active) setModules({ status: 'failed', error: String(error) }); },
    );
    return () => {
      active = false;
      generation.current += 1;
    };
  }, [dataSource, moduleDataSource, reload]);

  function loadPreview(base: BaseTemplateListItem, key: string) {
    const requestedGeneration = generation.current;
    const save = (result: Load<BaseTemplateRevisionDocument>) => {
      if (generation.current === requestedGeneration) {
        setPreviews(previous => ({ ...previous, [key]: result }));
      }
    };
    save({ status: 'loading' });
    void dataSource.loadBaseTemplateRevision(base.blueprint_ref.entity_id, base.version_ref.entity_id).then(
      data => save({ status: 'ready', data }),
      error => save({ status: 'failed', error: String(error) }),
    );
  }

  async function remove(confirmMessage: string, action: () => Promise<unknown>) {
    if (!window.confirm(confirmMessage)) return;
    setDeleteError('');
    try {
      await action();
      setReload(value => value + 1);
    } catch (error) {
      setDeleteError(String(error));
    }
  }

  const isObjects = tab === 'objects';
  const list = isObjects ? bases : modules;
  return <PageShell className="catalog-page blueprint-library-page">
    <PageHeader title={t('hardware.templates')} eyebrow={t('blueprint.library.section')} actions={
      <Link className="primary-action" to={isObjects ? '/library/base-templates/new' : '/library/module-templates/new'}>
        {t(isObjects ? 'hardware.newBase' : 'hardware.newModule')}
      </Link>
    } />
    <div className="catalog-tabs" role="tablist" aria-label={t('hardware.templates')}>
      {tabs.map(item => <button key={item} type="button" className="secondary-action" role="tab" id={`${id}-${item}`}
        aria-controls={`${id}-${item}-panel`} aria-selected={tab === item} tabIndex={tab === item ? 0 : -1}
        onClick={() => setTab(item)} onKeyDown={event => {
          const next = event.key === 'Home' ? 'objects' : event.key === 'End' ? 'modules'
            : ['ArrowLeft', 'ArrowRight'].includes(event.key) ? (item === 'objects' ? 'modules' : 'objects') : undefined;
          if (!next) return;
          event.preventDefault();
          setTab(next);
          document.getElementById(`${id}-${next}`)?.focus();
        }}>{t(item === 'objects' ? 'templateLibrary.objects' : 'templateLibrary.modules')}</button>)}
    </div>
    {deleteError && <p role="alert">{t('hardware.failed', { error: deleteError })}</p>}
    {tabs.map(item => <section key={item} role="tabpanel" id={`${id}-${item}-panel`}
      aria-labelledby={`${id}-${item}`} hidden={item !== tab}>
      {item === tab && <>
        {list.status === 'loading' && <p role="status">{t('templateLibrary.loading')}</p>}
        {list.status === 'failed' && <p role="alert">{t('hardware.failed', { error: list.error })}{' '}
          <button type="button" className="secondary-action" onClick={() => setReload(value => value + 1)}>{t('action.retry')}</button>
        </p>}
        {list.status === 'ready' && (list.data.length === 0 ? <p>{t('blueprint.library.empty')}</p> :
          <ul className="template-library-list">
            {isObjects && bases.status === 'ready' && bases.data.map(base => {
              const templateId = base.blueprint_ref.entity_id;
              const key = JSON.stringify([templateId, base.version_ref.entity_id]);
              const open = expanded.objects === key;
              const preview = previews[key];
              const revision = preview?.status === 'ready' ? preview.data : undefined;
              const type = base.default_physical_object_class?.trim();
              const unspecified = !type || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(type);
              return <TemplateRow key={key} name={base.name} ports={base.slot_count} publication={base.publication_state}
                metadata={unspecified ? t('blueprint.library.notSpecified') : type}
                expanded={open} onToggle={() => {
                  setExpanded({ ...expanded, objects: open ? undefined : key });
                  if (!open && !preview) loadPreview(base, key);
                }}>
                {preview?.status === 'loading' && <p role="status">{t('templateLibrary.previewLoading')}</p>}
                {preview?.status === 'failed' && <p role="alert">{t('templateLibrary.previewFailed', { error: preview.error })}{' '}
                  <button type="button" className="secondary-action" onClick={() => loadPreview(base, key)}>{t('action.retry')}</button>
                </p>}
                {revision && <BlueprintPreview portTypes={portTypes} label={base.name} body={revision.body} panels={revision.panels}
                  slots={revision.slots} internalLinks={revision.internal_links} bays={revision.bays} />}
                <div className="template-library-facts">
                  <span>{t('publication.revision', { number: base.version_number })}</span>
                  {revision && <span>{t('templateLibrary.places', { count: revision.bays?.length ?? 0 })}</span>}
                </div>
                <div className="template-library-actions">
                  {dataSource.loadDraft && <Link className="secondary-action" to={`/library/base-templates/${templateId}/edit`}>{t('review.edit')}</Link>}
                  <Link className="secondary-action" to={`/infrastructure/objects/new?blueprint=${encodeURIComponent(templateId)}`}>{t('blueprint.library.createObject')}</Link>
                  {dataSource.deleteBaseTemplate && <button type="button" className="text-action"
                    onClick={() => void remove(t('blueprint.library.deleteConfirm', { name: base.name }), () => dataSource.deleteBaseTemplate!(templateId))}>{t('hardware.remove')}</button>}
                </div>
              </TemplateRow>;
            })}
            {!isObjects && modules.status === 'ready' && modules.data.map(module => {
              const open = expanded.modules === module.template_id;
              return <TemplateRow key={module.template_id} name={module.name} metadata={module.compatibility}
                ports={module.endpoints.length} publication={module.publication_state} expanded={open}
                onToggle={() => setExpanded({ ...expanded, modules: open ? undefined : module.template_id })}>
                <ModulePreview portTypes={portTypes} module={module} />
                <div className="template-library-facts">
                  <span>{t('templateLibrary.compatibility', { value: module.compatibility })}</span>
                  <span>{t('physical.portCount', { count: module.endpoints.length })}</span>
                  {module.publication_state && <span>{t('publication.revision', { number: module.publication_state.version_number })}</span>}
                </div>
                <div className="template-library-actions">
                  <Link className="secondary-action" to={`/library/module-templates/${module.template_id}/edit`}>{t('review.edit')}</Link>
                  <button type="button" className="text-action"
                    onClick={() => void remove(t('hardware.deleteModuleConfirm', { name: module.name }), () => moduleDataSource.deleteModule(module.template_id))}>{t('hardware.remove')}</button>
                </div>
              </TemplateRow>;
            })}
          </ul>)}
      </>}
    </section>)}
  </PageShell>;
}
