import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BlueprintInstantiationDialog, type BlueprintInstantiationTarget } from '../components/BlueprintInstantiationDialog';
import { CreateNetworkDevice } from '../components/CreateNetworkDevice';
import { CreatePhysicalObject } from '../components/CreatePhysicalObject';
import type { DeviceWriteDataSource } from '../topology/deviceWriteTypes';
import type { ObjectBlueprintDataSource, ObjectBlueprintListDocument } from '../topology/objectBlueprintTypes';
import type { PhysicalObjectWriteDataSource } from '../topology/physicalObjectWriteTypes';

interface NewInfrastructureObjectPageProps {
  deviceWriteDataSource?: DeviceWriteDataSource;
  physicalObjectWriteDataSource?: PhysicalObjectWriteDataSource;
  objectBlueprintDataSource?: ObjectBlueprintDataSource;
}

type CreationIntent = 'device' | 'physical';

export function NewInfrastructureObjectPage({
  deviceWriteDataSource,
  physicalObjectWriteDataSource,
  objectBlueprintDataSource,
}: NewInfrastructureObjectPageProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [intent, setIntent] = useState<CreationIntent>('device');
  const [blueprints, setBlueprints] = useState<ObjectBlueprintListDocument | null>(null);
  const [blueprintError, setBlueprintError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [target, setTarget] = useState<BlueprintInstantiationTarget | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => { if (!objectBlueprintDataSource) { setBlueprints(null); return; } let active = true; setBlueprints(null); setBlueprintError(null); void objectBlueprintDataSource.loadObjectBlueprints().then((next) => { if (active) setBlueprints(next); }, (reason: unknown) => { if (active) setBlueprintError(reason instanceof Error ? reason.message : 'Не удалось загрузить шаблоны.'); }); return () => { active = false; }; }, [objectBlueprintDataSource, retryKey]);
  useEffect(() => { if (!blueprints || target || !params.get('blueprint')) return; const item = blueprints.blueprints.find((blueprint) => blueprint.blueprint_ref.entity_id === params.get('blueprint') && blueprint.version_ref.entity_id === params.get('version')); if (item) setTarget({ id: item.blueprint_ref.entity_id, versionId: item.version_ref.entity_id, name: item.name, versionNumber: item.version_number }); }, [blueprints, params, target]);

  return (
    <main className="catalog-page create-object-page">
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <Link to="/infrastructure/objects">Инфраструктура</Link><span>/</span>
        <Link to="/infrastructure/objects">Объекты</Link><span>/</span>
        <span>Создать</span>
      </nav>
      <header className="catalog-page__header">
        <div><span className="eyebrow">Инфраструктура</span><h1>Создать объект</h1><p>Выберите шаблон, затем задайте имя экземпляра.</p></div>
      </header>
      <section className="creation-form-surface" aria-label="Шаблоны объектов">
        {!objectBlueprintDataSource && <p className="catalog-note catalog-note--gap">Библиотека шаблонов не настроена.</p>}
        {objectBlueprintDataSource && !blueprints && !blueprintError && <p>Загружаем шаблоны…</p>}
        {blueprintError && <p role="alert" className="catalog-note catalog-note--gap">{blueprintError} <button type="button" onClick={() => setRetryKey((value) => value + 1)}>Повторить</button></p>}
        {blueprints?.blueprints.length === 0 && <div className="catalog-note"><h2>Сначала создайте шаблон</h2><p>Обычный объект создаётся из Object Blueprint. Шаблон задаёт его структуру и версию materialization.</p><Link className="primary-action" to="/library/object-blueprints/new">Создать первый шаблон</Link></div>}
        {blueprints && blueprints.blueprints.length > 0 && <div className="blueprint-library-grid">{blueprints.blueprints.map((blueprint) => <article className="blueprint-card" key={blueprint.blueprint_ref.entity_id}><h2>{blueprint.name}</h2><p>Версия: v{blueprint.version_number}{blueprint.default_physical_object_class ? ` · ${blueprint.default_physical_object_class}` : ''}</p><p>Портов: {blueprint.slot_count} · внутренних связей: {blueprint.internal_link_count}</p><button type="button" className="primary-action" onClick={() => setTarget({ id: blueprint.blueprint_ref.entity_id, versionId: blueprint.version_ref.entity_id, name: blueprint.name, versionNumber: blueprint.version_number })}>Выбрать шаблон</button></article>)}</div>}
      </section>
      <section className="creation-form-surface" aria-label="Создать вручную">
        {!manualOpen && <button type="button" className="secondary-action" onClick={() => setManualOpen(true)}>Создать вручную</button>}
        {manualOpen && <><h2>Создать вручную</h2><p className="catalog-note">Расширенный путь для объектов без шаблона.</p><section className="creation-intents" aria-label="Тип ручного создания"><button type="button" aria-pressed={intent === 'device'} onClick={() => setIntent('device')}><strong>Сетевое устройство</strong><span>PhysicalObject, первый NetworkInterface и explicit owner relation</span></button><button type="button" aria-pressed={intent === 'physical'} onClick={() => setIntent('physical')}><strong>Физический объект</strong><span>PhysicalObject, optional class и первая ConnectionPoint</span></button></section>
        {intent === 'device' && deviceWriteDataSource && (
          <CreateNetworkDevice
            variant="page"
            dataSource={deviceWriteDataSource}
            onCreated={(document) => navigate(`/infrastructure/objects/${encodeURIComponent(document.device.source_ref.entity_id)}`)}
          />
        )}
        {intent === 'physical' && physicalObjectWriteDataSource && (
          <CreatePhysicalObject
            variant="page"
            dataSource={physicalObjectWriteDataSource}
            onCreated={(document) => navigate(`/infrastructure/objects/${encodeURIComponent(document.physical_object.source_ref.entity_id)}`)}
          />
        )}
        {((intent === 'device' && !deviceWriteDataSource) || (intent === 'physical' && !physicalObjectWriteDataSource)) && (
          <p className="catalog-note catalog-note--gap">Public write datasource для выбранной операции не настроен.</p>
        )}
        </>}
      </section>
      {target && objectBlueprintDataSource && <BlueprintInstantiationDialog dataSource={objectBlueprintDataSource} target={target} onClose={() => setTarget(null)} />}
    </main>
  );
}
