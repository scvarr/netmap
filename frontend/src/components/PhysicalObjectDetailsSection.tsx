import { useEffect, useState } from 'react';
import type {
  ConnectionPointDetails,
  PhysicalObjectDetailsDataSource,
  PhysicalObjectDetailsDocument,
} from '../topology/physicalObjectDetailsTypes';
import type { DeviceDetailsDataSource } from '../topology/deviceDetailsTypes';
import type { PhysicalEndpointConnectionWriteDataSource } from '../topology/physicalEndpointConnectionWriteTypes';
import type { ProjectionSourceRef, TopologyProjectionNode } from '../topology/types';
import { ConnectPhysicalEndpoint } from './ConnectPhysicalEndpoint';

interface PhysicalObjectDetailsSectionProps {
  node: TopologyProjectionNode;
  dataSource: PhysicalObjectDetailsDataSource;
  topologyNodes?: TopologyProjectionNode[];
  deviceDetailsDataSource?: DeviceDetailsDataSource;
  writeDataSource?: PhysicalEndpointConnectionWriteDataSource;
  onConnected?: () => void;
}

type DetailsState =
  | { kind: 'loading' }
  | { kind: 'loaded'; document: PhysicalObjectDetailsDocument }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable'; message: string };

const shortId = (value: string) => value.replace(/[{}]/g, '').slice(0, 8);

const physicalObjectIdentity = (node: TopologyProjectionNode): string | null => {
  const refs = node.source_refs.filter((ref) => (
    ref.ref_type === 'CANONICAL_FACT' && ref.entity_type === 'PhysicalObject'
  ));
  return refs.length === 1 ? refs[0].entity_id : null;
};

const displayPointLabel = (point: ConnectionPointDetails): string => {
  const technical = /^ConnectionPoint\s+(.+)$/i.exec(point.label.trim());
  if (point.label_source !== 'TECHNICAL_FALLBACK' && !technical) return point.label;
  return `Точка ${shortId(technical?.[1] ?? point.connection_point_ref.entity_id)}`;
};

const SourceRefs = ({ refs }: { refs: ProjectionSourceRef[] }) => (
  <ul className="source-refs">
    {refs.map((ref) => (
      <li key={`${ref.ref_type}-${ref.entity_type}-${ref.entity_id}`}>
        <span>{ref.entity_type}</span>
        <code>{ref.entity_id}</code>
        <small>{ref.ref_type}</small>
      </li>
    ))}
  </ul>
);

interface PointCardProps {
  point: ConnectionPointDetails;
  topologyNodes: TopologyProjectionNode[];
  physicalDetailsDataSource: PhysicalObjectDetailsDataSource;
  deviceDetailsDataSource?: DeviceDetailsDataSource;
  writeDataSource?: PhysicalEndpointConnectionWriteDataSource;
  onConnected: () => void;
}

const PointCard = ({
  point,
  topologyNodes,
  physicalDetailsDataSource,
  deviceDetailsDataSource,
  writeDataSource,
  onConnected,
}: PointCardProps) => (
  <article className="connection-point-card">
    <h4>{displayPointLabel(point)}</h4>
    <div className="connection-point-card__metrics">
      <span>Cardinality: <strong>{point.cardinality}</strong></span>
      <span>Связей: <strong>{point.incident_connection_count}</strong></span>
      <span>Прямых привязок интерфейсов: <strong>{point.direct_interface_binding_count}</strong></span>
    </div>
    {point.cardinality === 1 && deviceDetailsDataSource && writeDataSource && (
      <ConnectPhysicalEndpoint
        sourcePoint={point}
        topologyNodes={topologyNodes}
        physicalDetailsDataSource={physicalDetailsDataSource}
        deviceDetailsDataSource={deviceDetailsDataSource}
        writeDataSource={writeDataSource}
        onConnected={onConnected}
      />
    )}
    <details className="interface-technical-details">
      <summary>Технические данные</summary>
      <SourceRefs refs={[point.connection_point_ref, ...point.source_refs]} />
    </details>
  </article>
);

export function PhysicalObjectDetailsSection({
  node,
  dataSource,
  topologyNodes = [],
  deviceDetailsDataSource,
  writeDataSource,
  onConnected = () => undefined,
}: PhysicalObjectDetailsSectionProps) {
  const physicalObjectId = physicalObjectIdentity(node);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<DetailsState>(() => (
    physicalObjectId
      ? { kind: 'loading' }
      : { kind: 'unavailable', message: 'Детали недоступны: нет однозначной ссылки на PhysicalObject.' }
  ));

  useEffect(() => {
    if (!physicalObjectId) {
      setState({
        kind: 'unavailable',
        message: 'Детали недоступны: нет однозначной ссылки на PhysicalObject.',
      });
      return undefined;
    }
    let current = true;
    setState({ kind: 'loading' });
    void dataSource.loadPhysicalObjectDetails(physicalObjectId).then(
      (document) => { if (current) setState({ kind: 'loaded', document }); },
      (reason: unknown) => {
        if (current) {
          setState({
            kind: 'error',
            message: reason instanceof Error ? reason.message : 'Неизвестная ошибка',
          });
        }
      },
    );
    return () => { current = false; };
  }, [dataSource, physicalObjectId, retryKey]);

  return (
    <section className="physical-object-details" aria-labelledby="connection-points-heading">
      {state.kind === 'loading' && <p className="device-details-state">Загружаем точки подключения…</p>}
      {state.kind === 'unavailable' && <p className="device-details-state">{state.message}</p>}
      {state.kind === 'error' && (
        <div className="device-details-state device-details-state--error">
          <p>Не удалось загрузить физический объект. {state.message}</p>
          <button onClick={() => setRetryKey((key) => key + 1)}>Повторить</button>
        </div>
      )}
      {state.kind === 'loaded' && (
        <>
          <div className="physical-object-details__summary">
            <span>Интерфейсов: <strong>{state.document.owned_interface_count}</strong></span>
          </div>
          <h3 id="connection-points-heading">
            Точки подключения <span>{state.document.connection_points.length}</span>
          </h3>
          {state.document.connection_points.length ? (
            <div className="connection-point-list">
              {state.document.connection_points.map((point) => (
                <PointCard
                  key={point.connection_point_ref.entity_id}
                  point={point}
                  topologyNodes={topologyNodes}
                  physicalDetailsDataSource={dataSource}
                  deviceDetailsDataSource={deviceDetailsDataSource}
                  writeDataSource={writeDataSource}
                  onConnected={() => {
                    setRetryKey((key) => key + 1);
                    onConnected();
                  }}
                />
              ))}
            </div>
          ) : <p className="device-details-state">Точки подключения не заданы.</p>}
          <details className="technical-details physical-object-details__technical">
            <summary>Технические данные объекта</summary>
            <SourceRefs refs={[state.document.physical_object.source_ref]} />
          </details>
        </>
      )}
    </section>
  );
}
