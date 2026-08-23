import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CreateNetworkDevice } from '../components/CreateNetworkDevice';
import { CreatePhysicalObject } from '../components/CreatePhysicalObject';
import type { DeviceWriteDataSource } from '../topology/deviceWriteTypes';
import type { PhysicalObjectWriteDataSource } from '../topology/physicalObjectWriteTypes';

interface NewInfrastructureObjectPageProps {
  deviceWriteDataSource?: DeviceWriteDataSource;
  physicalObjectWriteDataSource?: PhysicalObjectWriteDataSource;
}

type CreationIntent = 'device' | 'physical';

export function NewInfrastructureObjectPage({
  deviceWriteDataSource,
  physicalObjectWriteDataSource,
}: NewInfrastructureObjectPageProps) {
  const navigate = useNavigate();
  const [intent, setIntent] = useState<CreationIntent>('device');

  return (
    <main className="catalog-page create-object-page">
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <Link to="/infrastructure/objects">Инфраструктура</Link><span>/</span>
        <Link to="/infrastructure/objects">Объекты</Link><span>/</span>
        <span>Создать</span>
      </nav>
      <header className="catalog-page__header">
        <div><span className="eyebrow">Новый canonical объект</span><h1>Создать</h1></div>
      </header>
      <section className="creation-intents" aria-label="Тип создания">
        <button type="button" aria-pressed={intent === 'device'} onClick={() => setIntent('device')}>
          <strong>Сетевое устройство</strong>
          <span>PhysicalObject, первый NetworkInterface и explicit owner relation</span>
        </button>
        <button type="button" aria-pressed={intent === 'physical'} onClick={() => setIntent('physical')}>
          <strong>Физический объект</strong>
          <span>PhysicalObject, optional class и первая ConnectionPoint</span>
        </button>
      </section>
      <section className="creation-form-surface">
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
      </section>
    </main>
  );
}
