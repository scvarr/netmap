import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  DeviceDetailsDataSource,
  DeviceDetailsDocument,
} from '../topology/deviceDetailsTypes';
import type {
  PhysicalEndpointConnectionWriteDataSource,
  PhysicalEndpointRequest,
} from '../topology/physicalEndpointConnectionWriteTypes';
import type {
  ConnectionPointDetails,
  PhysicalObjectDetailsDataSource,
  PhysicalObjectDetailsDocument,
} from '../topology/physicalObjectDetailsTypes';
import { displayNodeLabel, numericAttribute } from '../topology/presentation';
import type { TopologyProjectionNode } from '../topology/types';

interface ConnectPhysicalEndpointProps {
  sourcePoint: ConnectionPointDetails;
  topologyNodes: TopologyProjectionNode[];
  physicalDetailsDataSource: PhysicalObjectDetailsDataSource;
  deviceDetailsDataSource: DeviceDetailsDataSource;
  writeDataSource: PhysicalEndpointConnectionWriteDataSource;
  onConnected: () => void;
}

type TargetKind = PhysicalEndpointRequest['kind'];
type TargetState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'points'; document: PhysicalObjectDetailsDocument }
  | { kind: 'interfaces'; document: DeviceDetailsDocument }
  | { kind: 'error'; message: string };

const physicalObjectId = (node: TopologyProjectionNode): string | null => {
  const refs = node.source_refs.filter((ref) => (
    ref.ref_type === 'CANONICAL_FACT' && ref.entity_type === 'PhysicalObject'
  ));
  return refs.length === 1 ? refs[0].entity_id : null;
};

const interfaceLabel = (label: string, id: string): string => {
  const technical = /^NetworkInterface\s+(.+)$/i.exec(label.trim());
  return technical ? `Интерфейс ${(technical[1] || id).slice(0, 8)}` : label;
};

export function ConnectPhysicalEndpoint({
  sourcePoint,
  topologyNodes,
  physicalDetailsDataSource,
  deviceDetailsDataSource,
  writeDataSource,
  onConnected,
}: ConnectPhysicalEndpointProps) {
  const [open, setOpen] = useState(false);
  const [targetKind, setTargetKind] = useState<TargetKind>('CONNECTION_POINT');
  const [targetObjectId, setTargetObjectId] = useState('');
  const [targetEntityId, setTargetEntityId] = useState('');
  const [cableName, setCableName] = useState('');
  const [targetState, setTargetState] = useState<TargetState>({ kind: 'idle' });
  const [targetRetryKey, setTargetRetryKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetObjects = useMemo(() => topologyNodes.flatMap((node) => {
    const id = physicalObjectId(node);
    if (!id) return [];
    if (
      targetKind === 'NETWORK_INTERFACE'
      && (numericAttribute(node, 'owned_interface_count') ?? 0) < 1
    ) {
      return [];
    }
    return [{ id, label: displayNodeLabel(node) }];
  }), [targetKind, topologyNodes]);

  useEffect(() => {
    setTargetEntityId('');
    if (!targetObjectId) {
      setTargetState({ kind: 'idle' });
      return undefined;
    }
    let current = true;
    setTargetState({ kind: 'loading' });
    const request = targetKind === 'CONNECTION_POINT'
      ? physicalDetailsDataSource.loadPhysicalObjectDetails(targetObjectId)
      : deviceDetailsDataSource.loadDeviceDetails(targetObjectId);
    void request.then(
      (document) => {
        if (!current) return;
        setTargetState(targetKind === 'CONNECTION_POINT'
          ? { kind: 'points', document: document as PhysicalObjectDetailsDocument }
          : { kind: 'interfaces', document: document as DeviceDetailsDocument });
      },
      (reason: unknown) => {
        if (current) {
          setTargetState({
            kind: 'error',
            message: reason instanceof Error ? reason.message : 'Неизвестная ошибка',
          });
        }
      },
    );
    return () => { current = false; };
  }, [
    deviceDetailsDataSource,
    physicalDetailsDataSource,
    targetKind,
    targetObjectId,
    targetRetryKey,
  ]);

  const pointTargets = targetState.kind === 'points'
    ? targetState.document.connection_points.filter((point) => (
      point.cardinality === 1
      && point.incident_connection_count < point.cardinality
      && point.connection_point_ref.entity_id !== sourcePoint.connection_point_ref.entity_id
    ))
    : [];
  const interfaceTargets = targetState.kind === 'interfaces'
    ? targetState.document.interfaces.filter((item) => item.direct_physical_bindings.length === 0)
    : [];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!targetEntityId || submitting) return;
    setSubmitting(true);
    setError(null);
    const target: PhysicalEndpointRequest = targetKind === 'CONNECTION_POINT'
      ? { kind: 'CONNECTION_POINT', connection_point_id: targetEntityId, member_index: 1 }
      : { kind: 'NETWORK_INTERFACE', network_interface_id: targetEntityId };
    try {
      const trimmedCableName = cableName.trim();
      await writeDataSource.createPhysicalEndpointConnection({
        source: {
          kind: 'CONNECTION_POINT',
          connection_point_id: sourcePoint.connection_point_ref.entity_id,
          member_index: 1,
        },
        target,
        ...(trimmedCableName ? { cable_display_name: trimmedCableName } : {}),
      });
      setOpen(false);
      setTargetObjectId('');
      setTargetEntityId('');
      setCableName('');
      onConnected();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="connect-interface connect-endpoint">
      <button
        type="button"
        className="connect-interface__trigger"
        aria-expanded={open}
        disabled={sourcePoint.incident_connection_count >= sourcePoint.cardinality}
        onClick={() => {
          setOpen((value) => !value);
          setError(null);
        }}
      >
        {sourcePoint.incident_connection_count >= sourcePoint.cardinality ? 'Точка уже подключена' : 'Подключить'}
      </button>
      {open && (
        <form className="connect-interface__form" onSubmit={submit} noValidate>
          <strong>Подключить точку кабелем</strong>
          <label>
            <span>Куда</span>
            <select
              aria-label="Тип конечной точки"
              value={targetKind}
              disabled={submitting}
              onChange={(event) => {
                setTargetKind(event.target.value as TargetKind);
                setTargetObjectId('');
              }}
            >
              <option value="CONNECTION_POINT">Точка подключения</option>
              <option value="NETWORK_INTERFACE">Интерфейс устройства</option>
            </select>
          </label>
          <label>
            <span>Физический объект</span>
            <select
              aria-label="Целевой физический объект"
              value={targetObjectId}
              disabled={submitting}
              onChange={(event) => setTargetObjectId(event.target.value)}
            >
              <option value="">Выберите объект</option>
              {targetObjects.map((object) => (
                <option key={object.id} value={object.id}>{object.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{targetKind === 'CONNECTION_POINT' ? 'Точка подключения' : 'Интерфейс'}</span>
            <select
              aria-label="Целевая конечная точка"
              value={targetEntityId}
              disabled={submitting || !['points', 'interfaces'].includes(targetState.kind)}
              onChange={(event) => setTargetEntityId(event.target.value)}
            >
              <option value="">Выберите endpoint</option>
              {pointTargets.map((point) => (
                <option
                  key={point.connection_point_ref.entity_id}
                  value={point.connection_point_ref.entity_id}
                >
                  {point.label} · связей: {point.incident_connection_count}
                </option>
              ))}
              {interfaceTargets.map((item) => (
                <option key={item.interface_ref.entity_id} value={item.interface_ref.entity_id}>
                  {interfaceLabel(item.label, item.interface_ref.entity_id)}
                </option>
              ))}
            </select>
          </label>
          {targetState.kind === 'loading' && <p className="muted">Загружаем endpoints…</p>}
          {targetState.kind === 'points' && pointTargets.length === 0 && (
            <p className="muted">Нет подходящих точек cardinality=1.</p>
          )}
          {targetState.kind === 'interfaces' && interfaceTargets.length === 0 && (
            <p className="muted">Нет интерфейсов без прямой физической привязки.</p>
          )}
          {targetState.kind === 'error' && (
            <div className="connect-interface__target-error">
              <p>Не удалось загрузить endpoints. {targetState.message}</p>
              <button type="button" onClick={() => setTargetRetryKey((key) => key + 1)}>
                Повторить загрузку
              </button>
            </div>
          )}
          <label>
            <span>Кабель</span>
            <input
              value={cableName}
              disabled={submitting}
              placeholder="Необязательное название"
              onChange={(event) => setCableName(event.target.value)}
            />
          </label>
          {error && (
            <p className="connect-interface__error" role="alert">
              Не удалось создать соединение. {error}
            </p>
          )}
          <div className="connect-interface__actions">
            <button type="button" disabled={submitting} onClick={() => setOpen(false)}>
              Отмена
            </button>
            <button type="submit" disabled={!targetEntityId || submitting}>
              {submitting ? 'Подключаем…' : error ? 'Повторить' : 'Подключить'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
