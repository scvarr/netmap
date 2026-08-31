import { useEffect, useState } from 'react';
import type {
  DeviceDetailsDataSource,
  DeviceDetailsDocument,
  DeviceInterfaceDetails,
} from '../topology/deviceDetailsTypes';
import type { ProjectionSourceRef, TopologyProjectionNode } from '../topology/types';
import type { DeviceInterfaceWriteDataSource } from '../topology/deviceInterfaceWriteTypes';
import { CreateDeviceInterface } from './CreateDeviceInterface';
import { CreateUntaggedL2ForwardingContext } from './CreateUntaggedL2ForwardingContext';
import type { L2ForwardingContextWriteDataSource } from '../topology/l2ForwardingContextWriteTypes';
import type { PhysicalLinkWriteDataSource } from '../topology/physicalLinkWriteTypes';
import { displayNodeLabel } from '../topology/presentation';
import type { CableLabelDataSource } from '../topology/cableLabelTypes';
import {
  ConnectPhysicalInterface,
  type PhysicalLinkTargetDevice,
} from './ConnectPhysicalInterface';

interface DeviceInterfacesSectionProps {
  node: TopologyProjectionNode;
  dataSource: DeviceDetailsDataSource;
  writeDataSource?: DeviceInterfaceWriteDataSource;
  onInterfaceCreated?: (physicalObjectId: string) => void;
  topologyNodes?: TopologyProjectionNode[];
  physicalLinkWriteDataSource?: PhysicalLinkWriteDataSource;
  onPhysicalLinkCreated?: (physicalObjectId: string) => void;
  l2ForwardingContextWriteDataSource?: L2ForwardingContextWriteDataSource;
  cableLabelDataSource?: CableLabelDataSource;
}

type DetailsState =
  | { kind: 'loading' }
  | { kind: 'loaded'; document: DeviceDetailsDocument }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable'; message: string };

const shortId = (value: string) => value.replace(/[{}]/g, '').slice(0, 8);

const displayInterfaceLabel = (item: DeviceInterfaceDetails): string => {
  const technical = /^NetworkInterface\s+(.+)$/i.exec(item.label.trim());
  if (item.label_source !== 'TECHNICAL_FALLBACK' && !technical) return item.label;
  return `Интерфейс ${shortId(technical?.[1] ?? item.interface_ref.entity_id)}`;
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

const InterfaceTechnicalDetails = ({ item }: { item: DeviceInterfaceDetails }) => (
  <details className="interface-technical-details">
    <summary>Технические данные</summary>
    <dl className="attribute-list">
      <div><dt>interface_ref</dt><dd>{item.interface_ref.entity_id}</dd></div>
      <div><dt>realization_down_count</dt><dd>{item.realization_down_count}</dd></div>
      <div><dt>realization_up_count</dt><dd>{item.realization_up_count}</dd></div>
    </dl>
    <h4>Interface ref и source refs</h4>
    <SourceRefs refs={[item.interface_ref, ...item.source_refs]} />
    {item.addresses.map((address) => (
      <section key={`${address.address}/${address.prefix_length}`}>
        <h4>{address.address}/{address.prefix_length}</h4>
        <SourceRefs refs={address.source_refs} />
      </section>
    ))}
    {item.direct_physical_bindings.map((binding) => (
      <section key={`${binding.connection_point_ref.entity_id}-${binding.member_index}`}>
        <h4>ConnectionPoint {binding.connection_point_ref.entity_id} · member {binding.member_index}</h4>
        <SourceRefs refs={[binding.connection_point_ref, ...binding.source_refs]} />
      </section>
    ))}
  </details>
);

const InterfaceCard = ({
  item,
  targetDevices,
  detailsDataSource,
  physicalLinkWriteDataSource,
  onConnected,
  cableLabelDataSource,
}: {
  item: DeviceInterfaceDetails;
  targetDevices: PhysicalLinkTargetDevice[];
  detailsDataSource: DeviceDetailsDataSource;
  physicalLinkWriteDataSource?: PhysicalLinkWriteDataSource;
  onConnected: () => void;
  cableLabelDataSource?: CableLabelDataSource;
}) => (
  <article className="interface-card">
    <h4>{displayInterfaceLabel(item)}</h4>
    <div className="interface-card__addresses">
      <strong>IP-адреса</strong>
      {item.addresses.length ? (
        <ul>{item.addresses.map((address) => (
          <li key={`${address.address}/${address.prefix_length}`}>
            <code>{address.address}/{address.prefix_length}</code>
          </li>
        ))}</ul>
      ) : <p>IP-адреса не назначены</p>}
    </div>
    <div className="interface-card__metrics">
      <span>Привязок L2: <strong>{item.l2_binding_count}</strong></span>
      <span>Привязок L3: <strong>{item.l3_binding_count}</strong></span>
      <span>Прямых физических привязок: <strong>{item.direct_physical_bindings.length}</strong></span>
    </div>
    <div className="interface-card__physical">
      {item.direct_physical_bindings.length ? (
        <>
          <p>Прямые физические привязки:</p>
          <ul>{item.direct_physical_bindings.map((binding) => (
            <li key={`${binding.connection_point_ref.entity_id}-${binding.member_index}`}>
              Точка {shortId(binding.connection_point_ref.entity_id)}, member {binding.member_index}
            </li>
          ))}</ul>
        </>
      ) : <p>Прямой физической привязки нет.</p>}
      {item.realization_down_count > 0 && (
        <p>Реализован через нижележащие интерфейсы: {item.realization_down_count}.</p>
      )}
      {item.realization_up_count > 0 && (
        <p>Используется вышележащими интерфейсами: {item.realization_up_count}.</p>
      )}
      {!item.direct_physical_bindings.length && item.realization_down_count === 0 && (
        <p className="muted">Сведения о физической реализации не заданы.</p>
      )}
    </div>
    {item.direct_physical_bindings.length === 0 && physicalLinkWriteDataSource && (
      <ConnectPhysicalInterface
        sourceInterface={item}
        targetDevices={targetDevices}
        detailsDataSource={detailsDataSource}
        writeDataSource={physicalLinkWriteDataSource}
        onConnected={onConnected}
      />
    )}
    <InterfaceTechnicalDetails item={item} />
  </article>
);

const physicalObjectIdentity = (node: TopologyProjectionNode): string | null => {
  const refs = node.source_refs.filter((ref) => (
    ref.ref_type === 'CANONICAL_FACT' && ref.entity_type === 'PhysicalObject'
  ));
  return refs.length === 1 ? refs[0].entity_id : null;
};

export function DeviceInterfacesSection({
  node,
  dataSource,
  writeDataSource,
  onInterfaceCreated,
  topologyNodes = [],
  physicalLinkWriteDataSource,
  onPhysicalLinkCreated,
  l2ForwardingContextWriteDataSource,
  cableLabelDataSource,
}: DeviceInterfacesSectionProps) {
  const physicalObjectId = physicalObjectIdentity(node);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<DetailsState>(() => (
    physicalObjectId
      ? { kind: 'loading' }
      : { kind: 'unavailable', message: 'Детали интерфейсов недоступны: нет однозначной ссылки на PhysicalObject.' }
  ));
  const targetDevices = topologyNodes.flatMap((candidate) => {
    const candidateId = physicalObjectIdentity(candidate);
    return candidateId && candidateId !== physicalObjectId
      ? [{ physicalObjectId: candidateId, label: displayNodeLabel(candidate) }]
      : [];
  });

  useEffect(() => {
    if (!physicalObjectId) {
      setState({
        kind: 'unavailable',
        message: 'Детали интерфейсов недоступны: нет однозначной ссылки на PhysicalObject.',
      });
      return undefined;
    }

    let current = true;
    setState({ kind: 'loading' });
    void dataSource.loadDeviceDetails(physicalObjectId).then(
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
    <section className="device-interfaces" aria-labelledby="device-interfaces-heading">
      <div className="device-interfaces__heading">
        <h3 id="device-interfaces-heading">Интерфейсы</h3>
        {physicalObjectId && writeDataSource && (
          <CreateDeviceInterface
            physicalObjectId={physicalObjectId}
            dataSource={writeDataSource}
            onCreated={(document) => {
              setState({ kind: 'loaded', document });
              onInterfaceCreated?.(physicalObjectId);
            }}
          />
        )}
      </div>
      {state.kind === 'loading' && <p className="device-details-state">Загружаем интерфейсы…</p>}
      {state.kind === 'unavailable' && <p className="device-details-state">{state.message}</p>}
      {state.kind === 'error' && (
        <div className="device-details-state device-details-state--error">
          <p>Не удалось загрузить интерфейсы. {state.message}</p>
          <button onClick={() => setRetryKey((key) => key + 1)}>Повторить</button>
        </div>
      )}
      {state.kind === 'loaded' && (
        state.document.interfaces.length ? <>
          {l2ForwardingContextWriteDataSource && state.document.interfaces.length >= 2 && (
            <CreateUntaggedL2ForwardingContext
              interfaces={state.document.interfaces}
              dataSource={l2ForwardingContextWriteDataSource}
              onCreated={() => setRetryKey((key) => key + 1)}
            />
          )}
          <div className="interface-list">{state.document.interfaces.map((item) => (
            <InterfaceCard
              key={item.interface_ref.entity_id}
              item={item}
              targetDevices={targetDevices}
              detailsDataSource={dataSource}
              physicalLinkWriteDataSource={physicalLinkWriteDataSource}
              cableLabelDataSource={cableLabelDataSource}
              onConnected={() => {
                setRetryKey((key) => key + 1);
                if (physicalObjectId) onPhysicalLinkCreated?.(physicalObjectId);
              }}
            />
          ))}</div>
        </> : <p className="device-details-state">У устройства нет owned interfaces.</p>
      )}
    </section>
  );
}
