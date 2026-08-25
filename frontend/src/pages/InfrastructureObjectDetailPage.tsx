import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DeviceInterfacesSection } from '../components/DeviceInterfacesSection';
import { PhysicalObjectDetailsSection } from '../components/PhysicalObjectDetailsSection';
import { physicalClassPresentationForLocale } from '../topology/presentation';
import { PHYSICAL_PROJECTION_REQUEST } from '../topology/projection';
import type { ConnectionPointWriteDataSource } from '../topology/connectionPointWriteTypes';
import type {
  CatalogInventoryDataSource,
  CatalogInventoryDocument,
} from '../topology/catalogInventoryTypes';
import type { DeviceDetailsDataSource } from '../topology/deviceDetailsTypes';
import type { DeviceInterfaceWriteDataSource } from '../topology/deviceInterfaceWriteTypes';
import type { L2ForwardingContextWriteDataSource } from '../topology/l2ForwardingContextWriteTypes';
import type { SavedMapDataSource, SavedMapSummary } from '../topology/savedMapTypes';
import type { PhysicalEndpointConnectionWriteDataSource } from '../topology/physicalEndpointConnectionWriteTypes';
import type { PhysicalLinkWriteDataSource } from '../topology/physicalLinkWriteTypes';
import type { PhysicalObjectClassWriteDataSource } from '../topology/physicalObjectClassWriteTypes';
import type {
  PhysicalObjectDetailsDataSource,
  PhysicalObjectDetailsDocument,
} from '../topology/physicalObjectDetailsTypes';
import type { TopologyDataSource, TopologyProjectionDocument } from '../topology/types';
import { useI18n } from '../i18n';

interface InfrastructureObjectDetailPageProps {
  dataSource: TopologyDataSource;
  deviceDetailsDataSource: DeviceDetailsDataSource;
  physicalObjectDetailsDataSource?: PhysicalObjectDetailsDataSource;
  deviceInterfaceWriteDataSource?: DeviceInterfaceWriteDataSource;
  physicalLinkWriteDataSource?: PhysicalLinkWriteDataSource;
  physicalEndpointConnectionWriteDataSource?: PhysicalEndpointConnectionWriteDataSource;
  physicalObjectClassWriteDataSource?: PhysicalObjectClassWriteDataSource;
  connectionPointWriteDataSource?: ConnectionPointWriteDataSource;
  l2ForwardingContextWriteDataSource?: L2ForwardingContextWriteDataSource;
  catalogInventoryDataSource: CatalogInventoryDataSource;
  savedMapDataSource?: SavedMapDataSource;
}

const mapLink = (mapId: string, objectId: string) =>
  `/map?map=${encodeURIComponent(mapId)}&view=physical&focus=${encodeURIComponent(objectId)}`;
const addMapLink = (mapId: string, objectId: string) =>
  `/map?map=${encodeURIComponent(mapId)}&view=physical&add=${encodeURIComponent(objectId)}`;

export function InfrastructureObjectDetailPage({
  dataSource,
  deviceDetailsDataSource,
  physicalObjectDetailsDataSource,
  deviceInterfaceWriteDataSource,
  physicalLinkWriteDataSource,
  physicalEndpointConnectionWriteDataSource,
  physicalObjectClassWriteDataSource,
  connectionPointWriteDataSource,
  l2ForwardingContextWriteDataSource,
  catalogInventoryDataSource,
  savedMapDataSource,
}: InfrastructureObjectDetailPageProps) {
  const { collator, locale, t } = useI18n();
  const { physicalObjectId = '' } = useParams();
  const [details, setDetails] = useState<PhysicalObjectDetailsDocument | null>(null);
  const [projection, setProjection] = useState<TopologyProjectionDocument | null>(null);
  const [projectionRevision, setProjectionRevision] = useState(0);
  const [inventory, setInventory] = useState<CatalogInventoryDocument | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryRevision, setInventoryRevision] = useState(0);
  const [mapChooser, setMapChooser] = useState<{ status: 'loading' | 'ready' | 'error'; maps: SavedMapSummary[]; error: string | null } | null>(null);

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

  useEffect(() => {
    let current = true;
    setInventoryError(null);
    void catalogInventoryDataSource.loadCatalogInventory().then(
      (document) => { if (current) setInventory(document); },
      (reason) => {
        if (current) {
          setInventoryError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
        }
      },
    );
    return () => { current = false; };
  }, [catalogInventoryDataSource, inventoryRevision, physicalObjectId]);

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
  const cable = details?.physical_object.class === 'cable';
  const inventoryItem = inventory?.equipment.find(
    (item) => item.physical_object_ref.entity_id === physicalObjectId,
  );
  const openMapChooser = () => {
    if (!savedMapDataSource) return;
    setMapChooser({ status: 'loading', maps: [], error: null });
    void savedMapDataSource.listMaps().then(
      (maps) => setMapChooser({ status: 'ready', maps, error: null }),
      (reason) => setMapChooser({ status: 'error', maps: [], error: reason instanceof Error ? reason.message : 'Неизвестная ошибка' }),
    );
  };

  if (!physicalObjectId) {
    return <main className="catalog-page"><p className="catalog-note catalog-note--gap">Не указан canonical ID объекта.</p></main>;
  }

  return (
    <main className="catalog-page object-detail-page">
      <nav className="breadcrumbs" aria-label={t('object.breadcrumbs')}>
        <Link to="/infrastructure/objects">{t('catalog.infrastructure')}</Link><span>/</span>
        <Link to="/infrastructure/objects">{t('nav.objects')}</Link><span>/</span>
        <span>{details?.physical_object.label ?? t('object.loading')}</span>
      </nav>
      <header className="object-detail-page__header">
        <div>
          <span className="eyebrow">{physicalClassPresentationForLocale(details?.physical_object.class, locale).label}</span>
          <h1>{details?.physical_object.label ?? t('object.loadingTitle')}</h1>
        </div>
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
      {details && (
        <section className="detail-section" aria-labelledby="object-maps-heading">
          <h2 id="object-maps-heading">Карты</h2>
          {cable ? (
            <p>Кабель отображается на физических картах через свои подключения и отдельно на карту не размещается.</p>
          ) : inventoryError ? (
            <>
              <p role="alert">Не удалось загрузить данные о размещении на картах: {inventoryError}</p>
              <button onClick={() => setInventoryRevision((revision) => revision + 1)}>Повторить</button>
            </>
          ) : !inventory ? (
            <p>Загружаем данные о размещении на картах…</p>
          ) : !inventoryItem ? (
            <p>Данные о размещении на картах недоступны.</p>
          ) : inventoryItem.map_memberships.length === 0 ? (
            <p>На картах: нет</p>
          ) : (
            <>
              <p>На картах:</p>
              <ul>
                {[...inventoryItem.map_memberships]
                  .sort((left, right) => collator.compare(left.name, right.name))
                  .map((membership) => (
                    <li key={membership.map_ref.entity_id}>
                      <Link to={mapLink(membership.map_ref.entity_id, physicalObjectId)}>{membership.name}</Link>
                    </li>
                  ))}
              </ul>
            </>
          )}
          {!cable && inventoryItem && savedMapDataSource && (
            <button type="button" onClick={openMapChooser}>Добавить на карту</button>
          )}
        </section>
      )}
      {mapChooser && (
        <section className="map-dialog" role="dialog" aria-modal="true" aria-label="Добавить на карту">
          <div className="map-dialog__surface">
            <h2>Добавить на карту</h2>
            {mapChooser.status === 'loading' && <p role="status">Загружаем карты…</p>}
            {mapChooser.status === 'error' && (
              <>
                <p role="alert">{mapChooser.error}</p>
                <button type="button" onClick={openMapChooser}>Повторить</button>
              </>
            )}
            {mapChooser.status === 'ready' && (() => {
              const placed = new Set(inventoryItem?.map_memberships.map((membership) => membership.map_ref.entity_id));
              const available = mapChooser.maps
                .filter((map) => !placed.has(map.map_ref.entity_id))
                .sort((left, right) => collator.compare(left.name, right.name));
              if (mapChooser.maps.length === 0) return <p>Карты пока не созданы.</p>;
              if (available.length === 0) return <p>Объект уже размещён на всех доступных картах.</p>;
              return <ul>{available.map((map) => <li key={map.map_ref.entity_id}><Link to={addMapLink(map.map_ref.entity_id, physicalObjectId)}>{map.name}</Link></li>)}</ul>;
            })()}
            <button type="button" onClick={() => setMapChooser(null)}>Закрыть</button>
          </div>
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
            l2ForwardingContextWriteDataSource={l2ForwardingContextWriteDataSource}
          />
        </section>
      )}
    </main>
  );
}
