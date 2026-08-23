import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BlueprintPreview } from '../components/BlueprintPreview';
import { ViewState } from '../components/ViewState';
import type { ObjectBlueprintDataSource, ObjectBlueprintListDocument, ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';

export function ObjectBlueprintLibraryPage({ dataSource }: { dataSource: ObjectBlueprintDataSource }) {
  const [document, setDocument] = useState<ObjectBlueprintListDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, ObjectBlueprintVersionDocument>>({});
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => { let current = true; setDocument(null); setVersions({}); setError(null); void dataSource.loadObjectBlueprints().then(async (next) => { const details = await Promise.all(next.blueprints.map((item) => dataSource.loadObjectBlueprintVersion(item.blueprint_ref.entity_id, item.version_ref.entity_id))); if (current) { setDocument(next); setVersions(Object.fromEntries(details.map((detail) => [detail.version_ref.entity_id, detail]))); } }, (reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка'); }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка'); }); return () => { current = false; }; }, [dataSource, retryKey]);
  return <main className="catalog-page blueprint-library-page">
    <header className="catalog-page__header"><div><span className="shell-nav__group-label">Библиотека</span><h1>Шаблоны объектов</h1><p>Authoring records: без topology facts до явной materialization.</p></div><Link className="primary-action" to="/library/object-blueprints/new">Создать шаблон</Link></header>
    <section className="blueprint-library-page__surface">
      {!document && !error && <ViewState kind="loading" />}
      {error && <ViewState kind="error" message={error} onRetry={() => setRetryKey((value) => value + 1)} />}
      {document?.blueprints.length === 0 && <ViewState kind="empty" message="Создайте первый шаблон в визуальном редакторе." />}
      {document && document.blueprints.length > 0 && <div className="blueprint-library-grid">{document.blueprints.map((blueprint) => { const version = versions[blueprint.version_ref.entity_id]; return <article className="blueprint-card" key={blueprint.blueprint_ref.entity_id}><BlueprintPreview body={blueprint.body} slots={version?.slots ?? []} internalLinks={version?.internal_links ?? []} label={`Preview ${blueprint.name}`} /><div><h2>{blueprint.name}</h2><p>v{blueprint.version_number}{blueprint.default_physical_object_class ? ` · ${blueprint.default_physical_object_class}` : ''}</p><dl><div><dt>Размер</dt><dd>{blueprint.body.width} × {blueprint.body.height}</dd></div><div><dt>Endpoints</dt><dd>{blueprint.slot_count}</dd></div><div><dt>Internal links</dt><dd>{blueprint.internal_link_count}</dd></div></dl></div></article>; })}</div>}
    </section>
  </main>;
}
