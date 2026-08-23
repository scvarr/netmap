import { useEffect, useRef, useState } from 'react';
import type {
  ConnectionPointDetails,
  PhysicalObjectDetailsDataSource,
  PhysicalObjectDetailsDocument,
} from '../topology/physicalObjectDetailsTypes';
import type { DeviceDetailsDataSource } from '../topology/deviceDetailsTypes';
import type { PhysicalEndpointConnectionWriteDataSource } from '../topology/physicalEndpointConnectionWriteTypes';
import type { PhysicalObjectClassWriteDataSource } from '../topology/physicalObjectClassWriteTypes';
import type { ProjectionSourceRef, TopologyProjectionNode } from '../topology/types';
import { physicalClassPresentation } from '../topology/presentation';
import { ConnectPhysicalEndpoint } from './ConnectPhysicalEndpoint';
import type { ConnectionPointWriteDataSource } from '../topology/connectionPointWriteTypes';
import { CreateConnectionPoint } from './CreateConnectionPoint';

interface PhysicalObjectDetailsSectionProps {
  node: TopologyProjectionNode;
  dataSource: PhysicalObjectDetailsDataSource;
  topologyNodes?: TopologyProjectionNode[];
  deviceDetailsDataSource?: DeviceDetailsDataSource;
  writeDataSource?: PhysicalEndpointConnectionWriteDataSource;
  classWriteDataSource?: PhysicalObjectClassWriteDataSource;
  connectionPointWriteDataSource?: ConnectionPointWriteDataSource;
  onConnected?: () => void;
  onClassUpdated?: () => void;
  onConnectionPointCreated?: () => void;
  onDocumentChange?: (document: PhysicalObjectDetailsDocument) => void;
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

const KNOWN_CLASSES = new Set(['workstation', 'switch', 'cable', 'outlet', 'patch_panel']);

interface PhysicalObjectClassEditorProps {
  physicalObjectId: string;
  currentClass?: string;
  dataSource: PhysicalObjectClassWriteDataSource;
  onUpdated: (document: PhysicalObjectDetailsDocument) => void;
}

const PhysicalObjectClassEditor = ({
  physicalObjectId,
  currentClass,
  dataSource,
  onUpdated,
}: PhysicalObjectClassEditorProps) => {
  const initialPreset = currentClass && KNOWN_CLASSES.has(currentClass) ? currentClass : '__custom__';
  const [preset, setPreset] = useState(initialPreset);
  const [customValue, setCustomValue] = useState(
    currentClass && !KNOWN_CLASSES.has(currentClass) ? currentClass : '',
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = preset === '__custom__' ? customValue.trim() : preset;
  const unchanged = value === (currentClass ?? '');

  const submit = async () => {
    if (!value || pending || unchanged) return;
    setPending(true);
    setError(null);
    try {
      onUpdated(await dataSource.setPhysicalObjectClass(physicalObjectId, value));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="physical-class-editor" aria-label="Тип объекта">
      <h3>Тип объекта</h3>
      <p className="physical-class-editor__current">
        {physicalClassPresentation(currentClass).label}
        {currentClass && !KNOWN_CLASSES.has(currentClass) ? ` · ${currentClass}` : ''}
      </p>
      <label>
        <span>Классификация</span>
        <select
          value={preset}
          onChange={(event) => setPreset(event.target.value)}
          disabled={pending}
        >
          <option value="workstation">ПК</option>
          <option value="switch">Коммутатор</option>
          <option value="cable">Кабель</option>
          <option value="outlet">Розетка</option>
          <option value="patch_panel">Патч-панель</option>
          <option value="__custom__">Другое</option>
        </select>
      </label>
      {preset === '__custom__' && (
        <label>
          <span>Значение</span>
          <input
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            disabled={pending}
            placeholder="Например: ups"
          />
        </label>
      )}
      {error && <p className="physical-class-editor__error" role="alert">{error}</p>}
      <button type="button" onClick={() => void submit()} disabled={!value || pending || unchanged}>
        {pending ? 'Сохраняем…' : 'Сохранить тип'}
      </button>
    </section>
  );
};

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
  classWriteDataSource,
  connectionPointWriteDataSource,
  onConnected = () => undefined,
  onClassUpdated = () => undefined,
  onConnectionPointCreated = () => undefined,
  onDocumentChange = () => undefined,
}: PhysicalObjectDetailsSectionProps) {
  const physicalObjectId = physicalObjectIdentity(node);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<DetailsState>(() => (
    physicalObjectId
      ? { kind: 'loading' }
      : { kind: 'unavailable', message: 'Детали недоступны: нет однозначной ссылки на PhysicalObject.' }
  ));
  const onDocumentChangeRef = useRef(onDocumentChange);
  onDocumentChangeRef.current = onDocumentChange;

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
      (document) => {
        if (current) {
          setState({ kind: 'loaded', document });
          onDocumentChangeRef.current(document);
        }
      },
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
          {classWriteDataSource && physicalObjectId && (
            <PhysicalObjectClassEditor
              key={state.document.physical_object.class ?? 'unclassified'}
              physicalObjectId={physicalObjectId}
              currentClass={state.document.physical_object.class}
              dataSource={classWriteDataSource}
              onUpdated={(document) => {
                setState({ kind: 'loaded', document });
                onDocumentChange(document);
                onClassUpdated();
              }}
            />
          )}
          <h3 id="connection-points-heading">
            Точки подключения <span>{state.document.connection_points.length}</span>
          </h3>
          {connectionPointWriteDataSource && physicalObjectId && (
            <CreateConnectionPoint
              physicalObjectId={physicalObjectId}
              dataSource={connectionPointWriteDataSource}
              onCreated={(document) => {
                setState({ kind: 'loaded', document });
                onDocumentChange(document);
                onConnectionPointCreated();
              }}
            />
          )}
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
