import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ViewState } from '../components/ViewState';
import { useI18n } from '../i18n';
import type { ObjectBlueprintDataSource, ObjectBlueprintListDocument, ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';

export function ObjectBlueprintLibraryPage({ dataSource }: { dataSource: ObjectBlueprintDataSource }) {
  const { t } = useI18n();
  const [document, setDocument] = useState<ObjectBlueprintListDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, ObjectBlueprintVersionDocument>>({});
  const [retryKey, setRetryKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const remove = async (id: string, name: string) => {
    if (!window.confirm(t('blueprint.library.deleteConfirm', { name }))) return;
    setActionError(null);
    try { if (!dataSource.deleteObjectBlueprint) throw new Error(t('blueprint.library.deleteUnsupported')); await dataSource.deleteObjectBlueprint(id); setRetryKey((value) => value + 1); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : t('blueprint.library.deleteFailed')); }
  };
  useEffect(() => { let current = true; setDocument(null); setVersions({}); setError(null); void dataSource.loadObjectBlueprints().then(async (next) => { const details = await Promise.allSettled(next.blueprints.map((item) => dataSource.loadObjectBlueprintVersion(item.blueprint_ref.entity_id, item.version_ref.entity_id))); if (current) { setDocument(next); setVersions(Object.fromEntries(details.flatMap((detail) => detail.status === 'fulfilled' ? [[detail.value.version_ref.entity_id, detail.value]] : []))); } }, (reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : t('blueprint.library.unknownError')); }); return () => { current = false; }; }, [dataSource, retryKey, t]);
  return <main className="catalog-page blueprint-library-page">
    <header className="catalog-page__header"><div><span className="shell-nav__group-label">{t('blueprint.library.section')}</span><h1>{t('blueprint.library.title')}</h1><p>{t('blueprint.library.description')}</p></div><Link className="primary-action" to="/library/object-blueprints/new">{t('blueprint.library.create')}</Link></header>
    <section className="blueprint-library-page__surface">
      {!document && !error && <ViewState kind="loading" />}
      {error && <ViewState kind="error" message={error} onRetry={() => setRetryKey((value) => value + 1)} />}
      {actionError && <p role="alert" className="blueprint-editor__error">{actionError}</p>}
      {document?.blueprints.length === 0 && <ViewState kind="empty" message={t('blueprint.library.empty')} />}
      {document && document.blueprints.length > 0 && <div className="blueprint-library-table-wrap"><table className="blueprint-library-table"><thead><tr><th scope="col">{t('blueprint.library.name')}</th><th scope="col">{t('blueprint.library.objectType')}</th><th scope="col">{t('blueprint.library.version')}</th><th scope="col">{t('blueprint.library.proportions')}</th><th scope="col">{t('blueprint.library.endpoints')}</th><th scope="col">{t('blueprint.library.portComposition')}</th><th scope="col">{t('blueprint.library.internalLinks')}</th><th scope="col">{t('blueprint.library.actions')}</th></tr></thead><tbody>{document.blueprints.map((blueprint) => {
        const version = versions[blueprint.version_ref.entity_id];
        const connectionPoints = version?.slots.filter((slot) => slot.kind === 'CONNECTION_POINT').length;
        const networkPorts = version?.slots.filter((slot) => slot.kind === 'NETWORK_PORT').length;
        const portComposition = version ? [connectionPoints ? t('blueprint.library.connectionPoints', { count: connectionPoints }) : null, networkPorts ? t('blueprint.library.networkPorts', { count: networkPorts }) : null].filter(Boolean).join(' · ') || t('blueprint.library.noPorts') : t('blueprint.library.portCompositionUnavailable');
        return <tr key={blueprint.blueprint_ref.entity_id}><th scope="row">{blueprint.name}</th><td>{blueprint.default_physical_object_class || t('blueprint.library.notSpecified')}</td><td>{t('blueprint.library.versionSummary', { version: blueprint.version_number, count: blueprint.version_count })}</td><td className="blueprint-library-table__numeric">{blueprint.body.width} × {blueprint.body.height}</td><td className="blueprint-library-table__numeric">{blueprint.slot_count}</td><td>{portComposition}</td><td className="blueprint-library-table__numeric">{blueprint.internal_link_count}</td><td><div className="blueprint-card__actions"><Link className="secondary-action" to={`/infrastructure/objects/new?blueprint=${encodeURIComponent(blueprint.blueprint_ref.entity_id)}&version=${encodeURIComponent(blueprint.version_ref.entity_id)}`}>{t('blueprint.library.createObject')}</Link><Link className="secondary-action" to={`/library/object-blueprints/${blueprint.blueprint_ref.entity_id}/versions/${blueprint.version_ref.entity_id}/edit`}>{t('blueprint.library.edit')}</Link><button type="button" className="secondary-action" onClick={() => void remove(blueprint.blueprint_ref.entity_id, blueprint.name)}>{t('blueprint.library.delete')}</button></div></td></tr>;
      })}</tbody></table></div>}
    </section>
  </main>;
}
