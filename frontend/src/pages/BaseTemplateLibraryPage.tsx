import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BlueprintPreview } from '../components/BlueprintPreview';
import { PageHeader, PageShell } from '../components/PageChrome';
import { useI18n } from '../i18n';
import type { BaseTemplateDataSource, BaseTemplateListDocument, BaseTemplateRevisionDocument } from '../topology/baseTemplateTypes';
import { hardwareModuleDataSource, type HardwareModuleDataSource, type ModuleTemplate } from '../topology/hardwareModules';

export function BaseTemplateLibraryPage({ dataSource, moduleDataSource = hardwareModuleDataSource }: { dataSource: BaseTemplateDataSource; moduleDataSource?: HardwareModuleDataSource }) {
  const { t } = useI18n(); const [bases, setBases] = useState<BaseTemplateListDocument>(); const [modules, setModules] = useState<ModuleTemplate[]>(); const [details, setDetails] = useState<Record<string, BaseTemplateRevisionDocument>>({}); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; setError(''); setBases(undefined); setModules(undefined); void Promise.all([dataSource.loadBaseTemplates(), moduleDataSource.listModules()]).then(async ([b, m]) => { const d = await Promise.all(b.blueprints.map(i => dataSource.loadBaseTemplateRevision(i.blueprint_ref.entity_id, i.version_ref.entity_id))); if(active) { setBases(b); setModules(m.modules); setDetails(Object.fromEntries(d.map(i => [i.blueprint_ref.entity_id, i]))); } }).catch(e => { if(active) setError(t('hardware.failed', { error: String(e) })); }); return () => { active = false; }; }, [dataSource, moduleDataSource, retry, t]);
  const remove = async (id: string, name: string) => { if(!window.confirm(t('blueprint.library.deleteConfirm', { name }))) return; try { await dataSource.deleteBaseTemplate?.(id); setRetry(v => v + 1); } catch(e) { setError(t('hardware.failed', { error: String(e) })); } };
  return <PageShell className="catalog-page blueprint-library-page"><PageHeader title={t('hardware.templates')} eyebrow={t('blueprint.library.section')} actions={<><Link className="primary-action" to="/library/base-templates/new">{t('hardware.newBase')}</Link><Link className="secondary-action" to="/library/module-templates/new">{t('hardware.newModule')}</Link></>} />
    {error && <p role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>{t('action.retry')}</button></p>}
    {!bases && !error && <p>{t('create.blueprintsLoading')}</p>}
    <section aria-label={t('hardware.base')}><h2>{t('hardware.base')}</h2>{bases?.blueprints.length === 0 && <p>{t('blueprint.library.empty')}</p>}<table className="blueprint-library-table"><thead><tr><th>{t('hardware.name')}</th><th>{t('hardware.base')}</th><th>{t('blueprint.library.actions')}</th></tr></thead><tbody>
      {bases?.blueprints.map(b => { const d = details[b.blueprint_ref.entity_id]; return <tr key={b.blueprint_ref.entity_id}><th scope="row">{b.name}</th><td>{d && <BlueprintPreview body={d.body} panels={d.panels} slots={d.slots} internalLinks={d.internal_links} label={b.name} viewportWidth={140} viewportHeight={70} />}{b.slot_count} · {t('physical.ports')}; {d?.bays?.length ?? 0} · {t('hardware.bays')}</td><td><Link to={`/infrastructure/objects/new?blueprint=${encodeURIComponent(b.blueprint_ref.entity_id)}`}>{t('blueprint.library.createObject')}</Link>{dataSource.deleteBaseTemplate && <button onClick={() => void remove(b.blueprint_ref.entity_id, b.name)}>{t('hardware.remove')}</button>}</td></tr>; })}
    </tbody></table></section>
    <section aria-label={t('hardware.module')}><h2>{t('hardware.module')}</h2><table className="blueprint-library-table"><thead><tr><th>{t('hardware.name')}</th><th>{t('hardware.compatibility')}</th><th>{t('physical.ports')}</th></tr></thead><tbody>{modules?.map(m => <tr key={m.template_id}><th scope="row">{m.name}</th><td>{m.compatibility}</td><td>{m.endpoints.length}</td></tr>)}</tbody></table></section>
  </PageShell>;
}
