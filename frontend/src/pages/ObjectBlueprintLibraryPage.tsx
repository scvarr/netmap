import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BlueprintPreview } from '../components/BlueprintPreview';
import { ViewState } from '../components/ViewState';
import type { ObjectBlueprintDataSource, ObjectBlueprintListDocument, ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';

export function ObjectBlueprintLibraryPage({ dataSource }: { dataSource: ObjectBlueprintDataSource }) {
  const navigate = useNavigate();
  const [document, setDocument] = useState<ObjectBlueprintListDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, ObjectBlueprintVersionDocument>>({});
  const [retryKey, setRetryKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [instantiateTarget, setInstantiateTarget] = useState<{ id: string; versionId: string; name: string; versionNumber: number } | null>(null);
  const [instanceName, setInstanceName] = useState('');
  const [instantiateError, setInstantiateError] = useState<string | null>(null);
  const [instantiating, setInstantiating] = useState(false);
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Удалить шаблон «${name}»? Это возможно только пока нет materialized instances.`)) return;
    setActionError(null);
    try { if (!dataSource.deleteObjectBlueprint) throw new Error('Удаление шаблона не поддерживается datasource.'); await dataSource.deleteObjectBlueprint(id); setRetryKey((value) => value + 1); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Не удалось удалить шаблон.'); }
  };
  const instantiate = async () => {
    if (!instantiateTarget || !instanceName.trim()) { setInstantiateError('Введите имя экземпляра.'); return; }
    if (!dataSource.instantiateObjectBlueprint) { setInstantiateError('Создание экземпляра не поддерживается datasource.'); return; }
    setInstantiateError(null); setInstantiating(true);
    try { const created = await dataSource.instantiateObjectBlueprint(instantiateTarget.id, instantiateTarget.versionId, { display_name: instanceName.trim() }); navigate(`/infrastructure/objects/${created.physical_object_ref.entity_id}`); }
    catch (reason) { setInstantiateError(reason instanceof Error ? reason.message : 'Не удалось создать объект.'); }
    finally { setInstantiating(false); }
  };
  useEffect(() => { let current = true; setDocument(null); setVersions({}); setError(null); void dataSource.loadObjectBlueprints().then(async (next) => { const details = await Promise.all(next.blueprints.map((item) => dataSource.loadObjectBlueprintVersion(item.blueprint_ref.entity_id, item.version_ref.entity_id))); if (current) { setDocument(next); setVersions(Object.fromEntries(details.map((detail) => [detail.version_ref.entity_id, detail]))); } }, (reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка'); }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка'); }); return () => { current = false; }; }, [dataSource, retryKey]);
  return <main className="catalog-page blueprint-library-page">
    <header className="catalog-page__header"><div><span className="shell-nav__group-label">Библиотека</span><h1>Шаблоны объектов</h1><p>Authoring records: без topology facts до явной materialization.</p></div><Link className="primary-action" to="/library/object-blueprints/new">Создать шаблон</Link></header>
    <section className="blueprint-library-page__surface">
      {!document && !error && <ViewState kind="loading" />}
      {error && <ViewState kind="error" message={error} onRetry={() => setRetryKey((value) => value + 1)} />}
      {actionError && <p role="alert" className="blueprint-editor__error">{actionError}</p>}
      {document?.blueprints.length === 0 && <ViewState kind="empty" message="Создайте первый шаблон в визуальном редакторе." />}
      {document && document.blueprints.length > 0 && <div className="blueprint-library-grid">{document.blueprints.map((blueprint) => { const version = versions[blueprint.version_ref.entity_id]; return <article className="blueprint-card" key={blueprint.blueprint_ref.entity_id}><BlueprintPreview body={blueprint.body} slots={version?.slots ?? []} internalLinks={version?.internal_links ?? []} label={`Preview ${blueprint.name}`} /><div><h2>{blueprint.name}</h2><p>v{blueprint.version_number} · versions: {blueprint.version_count}{blueprint.default_physical_object_class ? ` · ${blueprint.default_physical_object_class}` : ''}</p><dl><div><dt>Размер</dt><dd>{blueprint.body.width} × {blueprint.body.height}</dd></div><div><dt>Endpoints</dt><dd>{blueprint.slot_count}</dd></div><div><dt>Internal links</dt><dd>{blueprint.internal_link_count}</dd></div></dl><div className="blueprint-card__actions"><button type="button" className="secondary-action" onClick={() => { setInstantiateError(null); setInstanceName(''); setInstantiateTarget({ id: blueprint.blueprint_ref.entity_id, versionId: blueprint.version_ref.entity_id, name: blueprint.name, versionNumber: blueprint.version_number }); }}>Создать объект</button><Link className="secondary-action" to={`/library/object-blueprints/${blueprint.blueprint_ref.entity_id}/versions/${blueprint.version_ref.entity_id}/edit`}>Редактировать</Link><button type="button" className="secondary-action" onClick={() => void remove(blueprint.blueprint_ref.entity_id, blueprint.name)}>Удалить</button></div></div></article>; })}</div>}
      {instantiateTarget && <div className="blueprint-dialog" role="dialog" aria-modal="true" aria-label="Создать объект"><div className="blueprint-dialog__surface"><h2>Создать объект из «{instantiateTarget.name}»</h2><p>Версия: v{instantiateTarget.versionNumber}</p><label>Имя экземпляра<input aria-label="Имя экземпляра" value={instanceName} onChange={(event) => setInstanceName(event.target.value)} /></label>{instantiateError && <p role="alert" className="blueprint-editor__error">{instantiateError}</p>}<div className="blueprint-card__actions"><button type="button" className="secondary-action" disabled={instantiating} onClick={() => setInstantiateTarget(null)}>Отмена</button><button type="button" className="primary-action" disabled={instantiating || !instanceName.trim()} onClick={() => void instantiate()}>{instantiating ? 'Создаём…' : 'Создать'}</button></div></div></div>}
    </section>
  </main>;
}
