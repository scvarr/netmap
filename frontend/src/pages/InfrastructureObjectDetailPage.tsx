import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DeviceInterfacesSection } from '../components/DeviceInterfacesSection';
import { PhysicalObjectDetailsSection } from '../components/PhysicalObjectDetailsSection';
import { physicalClassPresentation } from '../topology/presentation';
import { PHYSICAL_PROJECTION_REQUEST } from '../topology/projection';
import type { ConnectionPointWriteDataSource } from '../topology/connectionPointWriteTypes';
import type { DeviceDetailsDataSource } from '../topology/deviceDetailsTypes';
import type { DeviceInterfaceWriteDataSource } from '../topology/deviceInterfaceWriteTypes';
import type { PhysicalEndpointConnectionWriteDataSource } from '../topology/physicalEndpointConnectionWriteTypes';
import type { PhysicalLinkWriteDataSource } from '../topology/physicalLinkWriteTypes';
import type { PhysicalObjectClassWriteDataSource } from '../topology/physicalObjectClassWriteTypes';
import type {
  PhysicalObjectDetailsDataSource,
  PhysicalObjectDetailsDocument,
} from '../topology/physicalObjectDetailsTypes';
import type { TopologyDataSource, TopologyProjectionDocument } from '../topology/types';

interface InfrastructureObjectDetailPageProps {
  dataSource: TopologyDataSource;
  deviceDetailsDataSource: DeviceDetailsDataSource;
  physicalObjectDetailsDataSource?: PhysicalObjectDetailsDataSource;
  deviceInterfaceWriteDataSource?: DeviceInterfaceWriteDataSource;
  physicalLinkWriteDataSource?: PhysicalLinkWriteDataSource;
  physicalEndpointConnectionWriteDataSource?: PhysicalEndpointConnectionWriteDataSource;
  physicalObjectClassWriteDataSource?: PhysicalObjectClassWriteDataSource;
  connectionPointWriteDataSource?: ConnectionPointWriteDataSource;
}

export function InfrastructureObjectDetailPage({
  dataSource,
  deviceDetailsDataSource,
  physicalObjectDetailsDataSource,
  deviceInterfaceWriteDataSource,
  physicalLinkWriteDataSource,
  physicalEndpointConnectionWriteDataSource,
  physicalObjectClassWriteDataSource,
  connectionPointWriteDataSource,
}: InfrastructureObjectDetailPageProps) {
  const { physicalObjectId = '' } = useParams();
  const [details, setDetails] = useState<PhysicalObjectDetailsDocument | null>(null);
  const [projection, setProjection] = useState<TopologyProjectionDocument | null>(null);
  const [projectionRevision, setProjectionRevision] = useState(0);

  useEffect(() => {
    let current = true;
    void dataSource.loadProjection(PHYSICAL_PROJECTION_REQUEST).then(
      (nextProjection) => { if (current) setProjection(nextProjection); },
      () => { if (current) setProjection(null); },
    );
    return () => { current = false; };
  }, [dataSource, projectionRevision]);

  const refreshProjection = useCallback(() => {
    setProjectionRevision((revision) => revision + 1);
  }, []);

  const node = useMemo(() => ({
    id: `catalog-physical-object-${physicalObjectId}`,
    kind: 'PHYSICAL_OBJECT',
    label: details?.physical_object.label ?? `PhysicalObject ${physicalObjectId}`,
    source_refs: [{
      ref_type: 'CANONICAL_FACT',
      entity_type: 'PhysicalObject',
      entity_id: physicalObjectId,
    }],
    attributes: {
      ...(details?.physical_object.class ? { class: details.physical_object.class } : {}),
      ...(details ? {
        connection_point_count: details.connection_points.length,
        owned_interface_count: details.owned_interface_count,
      } : {}),
    },
  }), [details, physicalObjectId]);

  if (!physicalObjectId) {
    return <main className="catalog-page"><p className="catalog-note catalog-note--gap">Не указан canonical ID объекта.</p></main>;
  }

  return (
    <main className="catalog-page object-detail-page">
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <Link to="/infrastructure/objects">Инфраструктура</Link><span>/</span>
        <Link to="/infrastructure/objects">Объекты</Link><span>/</span>
        <span>{details?.physical_object.label ?? 'Загрузка…'}</span>
      </nav>
      <header className="object-detail-page__header">
        <div>
          <span className="eyebrow">{details ? physicalClassPresentation(details.physical_object.class).label : 'ФИЗИЧЕСКИЙ ОБЪЕКТ'}</span>
          <h1>{details?.physical_object.label ?? 'Загружаем объект…'}</h1>
        </div>
        <Link className="secondary-action" to={`/map?view=physical&focus=${encodeURIComponent(physicalObjectId)}`}>
          Показать на карте
        </Link>
      </header>
      {details?.warnings.map((warning, index) => <p className="catalog-note" key={`warning-${index}-${warning}`}>{warning}</p>)}
      {details?.gaps.map((gap, index) => <p className="catalog-note catalog-note--gap" key={`gap-${index}-${gap}`}>{gap}</p>)}
      {details && (
        <section className="detail-section" aria-labelledby="object-main-heading">
          <h2 id="object-main-heading">Основное</h2>
          <dl className="detail-fields">
            <div><dt>Название</dt><dd>{details.physical_object.label}</dd></div>
            <div><dt>Класс</dt><dd>{details.physical_object.class ?? 'Не указан'}</dd></div>
          </dl>
        </section>
      )}
      <section className="detail-section detail-section--operations">
        <PhysicalObjectDetailsSection
          key={physicalObjectId}
          node={node}
          dataSource={physicalObjectDetailsDataSource ?? {
            loadPhysicalObjectDetails: () => Promise.reject(new Error('Источник PhysicalObject Details не настроен.')),
          }}
          topologyNodes={projection?.nodes ?? []}
          deviceDetailsDataSource={deviceDetailsDataSource}
          writeDataSource={physicalEndpointConnectionWriteDataSource}
          classWriteDataSource={physicalObjectClassWriteDataSource}
          connectionPointWriteDataSource={connectionPointWriteDataSource}
          onDocumentChange={setDetails}
          onConnected={refreshProjection}
          onClassUpdated={refreshProjection}
          onConnectionPointCreated={refreshProjection}
        />
      </section>
      {details && details.owned_interface_count > 0 && (
        <section className="detail-section detail-section--operations">
          <DeviceInterfacesSection
            key={`${physicalObjectId}-interfaces`}
            node={node}
            dataSource={deviceDetailsDataSource}
            writeDataSource={deviceInterfaceWriteDataSource}
            onInterfaceCreated={refreshProjection}
            topologyNodes={projection?.nodes ?? []}
            physicalLinkWriteDataSource={physicalLinkWriteDataSource}
            onPhysicalLinkCreated={refreshProjection}
          />
        </section>
      )}
    </main>
  );
}
