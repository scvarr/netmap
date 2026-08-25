import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BlueprintPreview } from '../components/BlueprintPreview';
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
      {document && document.blueprints.length > 0 && <div className="blueprint-library-grid">{document.blueprints.map((blueprint) => { const version = versions[blueprint.version_ref.entity_id]; return <article className="blueprint-card" key={blueprint.blueprint_ref.entity_id}><BlueprintPreview body={blueprint.body} slots={version?.slots ?? []} internalLinks={version?.internal_links ?? []} label={t('blueprint.library.preview', { name: blueprint.name })} /><div><h2>{blueprint.name}</h2><p>{t('blueprint.library.versionSummary', { version: blueprint.version_number, count: blueprint.version_count })}{blueprint.default_physical_object_class ? ` · ${blueprint.default_physical_object_class}` : ''}</p><dl><div><dt>{t('blueprint.library.size')}</dt><dd>{blueprint.body.width} × {blueprint.body.height}</dd></div><div><dt>{t('blueprint.library.endpoints')}</dt><dd>{blueprint.slot_count}</dd></div><div><dt>{t('blueprint.library.internalLinks')}</dt><dd>{blueprint.internal_link_count}</dd></div></dl><div className="blueprint-card__actions"><Link className="secondary-action" to={`/infrastructure/objects/new?blueprint=${encodeURIComponent(blueprint.blueprint_ref.entity_id)}&version=${encodeURIComponent(blueprint.version_ref.entity_id)}`}>{t('blueprint.library.createObject')}</Link><Link className="secondary-action" to={`/library/object-blueprints/${blueprint.blueprint_ref.entity_id}/versions/${blueprint.version_ref.entity_id}/edit`}>{t('blueprint.library.edit')}</Link><button type="button" className="secondary-action" onClick={() => void remove(blueprint.blueprint_ref.entity_id, blueprint.name)}>{t('blueprint.library.delete')}</button></div></div></article>; })}</div>}
    </section>
  </main>;
}
