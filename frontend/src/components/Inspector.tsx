import {
  displayCount,
  displayNodeLabel,
  displayStatus,
  numericAttribute,
} from '../topology/presentation';
import type {
  ProjectionSourceRef,
  TopologyProjectionDocument,
  TopologyProjectionEdge,
  TopologyProjectionNode,
  TopologySelection,
} from '../topology/types';
import type { DeviceDetailsDataSource } from '../topology/deviceDetailsTypes';
import type { DeviceInterfaceWriteDataSource } from '../topology/deviceInterfaceWriteTypes';
import type { PhysicalLinkWriteDataSource } from '../topology/physicalLinkWriteTypes';
import type { PhysicalEndpointConnectionWriteDataSource } from '../topology/physicalEndpointConnectionWriteTypes';
import { DeviceInterfacesSection } from './DeviceInterfacesSection';
import type { PhysicalObjectDetailsDataSource } from '../topology/physicalObjectDetailsTypes';
import { PhysicalObjectDetailsSection } from './PhysicalObjectDetailsSection';

interface InspectorProps {
  document: TopologyProjectionDocument | null;
  selection: TopologySelection;
  deviceDetailsDataSource: DeviceDetailsDataSource;
  deviceInterfaceWriteDataSource?: DeviceInterfaceWriteDataSource;
  onInterfaceCreated?: (physicalObjectId: string) => void;
  physicalLinkWriteDataSource?: PhysicalLinkWriteDataSource;
  physicalObjectDetailsDataSource?: PhysicalObjectDetailsDataSource;
  physicalEndpointConnectionWriteDataSource?: PhysicalEndpointConnectionWriteDataSource;
  onPhysicalEndpointConnected?: (physicalObjectId: string) => void;
  onPhysicalLinkCreated?: (physicalObjectId: string) => void;
  onSelectNode: (node: TopologyProjectionNode) => void;
  onClose: () => void;
}

const SourceRef = ({ sourceRef }: { sourceRef: ProjectionSourceRef }) => (
  <li>
    <span>{sourceRef.entity_type}</span>
    <code>{sourceRef.entity_id}</code>
    <small>{sourceRef.ref_type}</small>
  </li>
);

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div><span>{label}</span><strong>{value}</strong></div>
);

const EdgeCounts = ({ edge }: { edge: TopologyProjectionEdge }) => (
  <span className="neighbor-link__counts">
    Физических путей: {displayCount(numericAttribute(edge, 'supporting_path_count'))}
    {' · '}
    Пар интерфейсов: {displayCount(numericAttribute(edge, 'supporting_interface_pair_count'))}
  </span>
);

const PhysicalEdgeCounts = ({ edge }: { edge: TopologyProjectionEdge }) => (
  <span className="neighbor-link__counts">
    Соединений: {displayCount(numericAttribute(edge, 'supporting_connection_count'))}
    {' · '}
    Пар members: {displayCount(numericAttribute(edge, 'supporting_member_pair_count'))}
  </span>
);

const TechnicalDetails = ({ selection }: { selection: Exclude<TopologySelection, null> }) => {
  const item = selection.item;
  return (
    <details className="technical-details">
      <summary>Технические детали</summary>
      <div className="inspector__facts technical-details__facts">
        <Metric label="Kind" value={item.kind} />
        <Metric label="Raw status" value={item.status ?? 'UNKNOWN'} />
      </div>
      <section>
        <h3>Projection IDs</h3>
        <dl className="attribute-list">
          <div><dt>id</dt><dd>{item.id}</dd></div>
          {selection.type === 'edge' && (
            <>
              <div><dt>from_node_id</dt><dd>{selection.item.from_node_id}</dd></div>
              <div><dt>to_node_id</dt><dd>{selection.item.to_node_id}</dd></div>
            </>
          )}
        </dl>
      </section>
      <section>
        <h3>Raw attributes</h3>
        {Object.keys(item.attributes).length ? (
          <dl className="attribute-list">
            {Object.entries(item.attributes).map(([key, value]) => (
              <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>
            ))}
          </dl>
        ) : <p className="muted">Нет атрибутов</p>}
      </section>
      <section>
        <h3>Source refs <span>{item.source_refs.length}</span></h3>
        <ul className="source-refs">
          {item.source_refs.map((sourceRef) => (
            <SourceRef
              key={`${sourceRef.ref_type}-${sourceRef.entity_type}-${sourceRef.entity_id}`}
              sourceRef={sourceRef}
            />
          ))}
        </ul>
      </section>
    </details>
  );
};

export function Inspector({
  document,
  selection,
  deviceDetailsDataSource,
  deviceInterfaceWriteDataSource,
  onInterfaceCreated,
  physicalLinkWriteDataSource,
  physicalObjectDetailsDataSource,
  physicalEndpointConnectionWriteDataSource,
  onPhysicalEndpointConnected,
  onPhysicalLinkCreated,
  onSelectNode,
  onClose,
}: InspectorProps) {
  if (!selection) {
    return (
      <aside className="inspector inspector--empty" aria-label="Инспектор">
        <div className="inspector__empty-icon">↖</div>
        <h2>Инспектор</h2>
        <p>Выберите устройство или связь на схеме, чтобы увидеть projection-данные и исходные ссылки.</p>
      </aside>
    );
  }

  const nodesById = new Map(document?.nodes.map((node) => [node.id, node]) ?? []);

  if (selection.type === 'node') {
    const node = selection.item;
    const incidentEdges = document?.edges.filter(
      (edge) => edge.from_node_id === node.id || edge.to_node_id === node.id,
    ) ?? [];
    const neighbors = incidentEdges.flatMap((edge) => {
      const neighborId = edge.from_node_id === node.id ? edge.to_node_id : edge.from_node_id;
      const neighbor = nodesById.get(neighborId);
      return neighbor ? [{ edge, neighbor }] : [];
    });

    if (document?.layer === 'L1' && document.detail_level === 'PHYSICAL_OBJECT') {
      return (
        <aside className="inspector" aria-label="Инспектор">
          <button className="inspector__close" onClick={onClose} aria-label="Закрыть инспектор">×</button>
          <span className="eyebrow">Физический объект</span>
          <h2>{displayNodeLabel(node)}</h2>
          <p className="inspector__status"><i /> {displayStatus(node.status)}</p>
          <div className="inspector__facts">
            <Metric
              label="Точек подключения"
              value={displayCount(numericAttribute(node, 'connection_point_count'))}
            />
            <Metric
              label="Интерфейсов"
              value={displayCount(numericAttribute(node, 'owned_interface_count'))}
            />
            <Metric label="Физических связей" value={String(incidentEdges.length)} />
          </div>
          <section>
            <h3>Соседние физические объекты <span>{neighbors.length}</span></h3>
            {neighbors.length ? (
              <ul className="neighbor-list">
                {neighbors.map(({ edge, neighbor }) => (
                  <li key={edge.id}>
                    <button onClick={() => onSelectNode(neighbor)}>
                      <strong>{displayNodeLabel(neighbor)}</strong>
                      <PhysicalEdgeCounts edge={edge} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">В текущей физической проекции соседей нет.</p>}
          </section>
          {physicalObjectDetailsDataSource && (
            <PhysicalObjectDetailsSection
              key={node.id}
              node={node}
              dataSource={physicalObjectDetailsDataSource}
              topologyNodes={document.nodes}
              deviceDetailsDataSource={deviceDetailsDataSource}
              writeDataSource={physicalEndpointConnectionWriteDataSource}
              onConnected={() => {
                const id = node.source_refs.find((ref) => (
                  ref.ref_type === 'CANONICAL_FACT'
                  && ref.entity_type === 'PhysicalObject'
                ))?.entity_id;
                if (id) onPhysicalEndpointConnected?.(id);
              }}
            />
          )}
          <TechnicalDetails selection={selection} />
        </aside>
      );
    }

    return (
      <aside className="inspector" aria-label="Инспектор">
        <button className="inspector__close" onClick={onClose} aria-label="Закрыть инспектор">×</button>
        <span className="eyebrow">Устройство</span>
        <h2>{displayNodeLabel(node)}</h2>
        <p className="inspector__status"><i /> {displayStatus(node.status)}</p>
        <div className="inspector__facts">
          <Metric
            label="Интерфейсов"
            value={displayCount(numericAttribute(node, 'owned_interface_count'))}
          />
          <Metric label="Связей" value={String(incidentEdges.length)} />
        </div>
        <section>
          <h3>Соседние устройства <span>{neighbors.length}</span></h3>
          {neighbors.length ? (
            <ul className="neighbor-list">
              {neighbors.map(({ edge, neighbor }) => (
                <li key={edge.id}>
                  <button onClick={() => onSelectNode(neighbor)}>
                    <strong>{displayNodeLabel(neighbor)}</strong>
                    <EdgeCounts edge={edge} />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="muted">В текущей проекции соседей нет.</p>}
        </section>
        <DeviceInterfacesSection
          key={node.id}
          node={node}
          dataSource={deviceDetailsDataSource}
          writeDataSource={deviceInterfaceWriteDataSource}
          onInterfaceCreated={onInterfaceCreated}
          topologyNodes={document?.nodes ?? []}
          physicalLinkWriteDataSource={physicalLinkWriteDataSource}
          onPhysicalLinkCreated={onPhysicalLinkCreated}
        />
        <TechnicalDetails selection={selection} />
      </aside>
    );
  }

  const edge = selection.item;
  const source = nodesById.get(edge.from_node_id);
  const target = nodesById.get(edge.to_node_id);
  const sourceLabel = source ? displayNodeLabel(source) : 'Неизвестное устройство';
  const targetLabel = target ? displayNodeLabel(target) : 'Неизвестное устройство';

  if (document?.layer === 'L1' && document.detail_level === 'PHYSICAL_OBJECT') {
    return (
      <aside className="inspector" aria-label="Инспектор">
        <button className="inspector__close" onClick={onClose} aria-label="Закрыть инспектор">×</button>
        <span className="eyebrow">Физическая связь</span>
        <h2>{sourceLabel} ↔ {targetLabel}</h2>
        <p className="inspector__status"><i /> {displayStatus(edge.status)}</p>
        <div className="inspector__facts">
          <Metric
            label="Соединений"
            value={displayCount(numericAttribute(edge, 'supporting_connection_count'))}
          />
          <Metric
            label="Пар members"
            value={displayCount(numericAttribute(edge, 'supporting_member_pair_count'))}
          />
          <Metric label="Агрегированная" value={edge.aggregate ? 'Да' : 'Нет'} />
        </div>
        <p className="aggregate-explanation">
          Эта линия агрегирует canonical Connection/ConnectionMember между физическими объектами.
        </p>
        <section className="edge-endpoints">
          <h3>Физические объекты</h3>
          <div>
            {source && <button onClick={() => onSelectNode(source)}>{sourceLabel}</button>}
            <span aria-hidden="true">↔</span>
            {target && <button onClick={() => onSelectNode(target)}>{targetLabel}</button>}
          </div>
        </section>
        <TechnicalDetails selection={selection} />
      </aside>
    );
  }

  return (
    <aside className="inspector" aria-label="Инспектор">
      <button className="inspector__close" onClick={onClose} aria-label="Закрыть инспектор">×</button>
      <span className="eyebrow">Связь</span>
      <h2>{sourceLabel} ↔ {targetLabel}</h2>
      <p className="inspector__status"><i /> {displayStatus(edge.status)}</p>
      <div className="inspector__facts">
        <Metric
          label="Физических путей"
          value={displayCount(numericAttribute(edge, 'supporting_path_count'))}
        />
        <Metric
          label="Пар интерфейсов"
          value={displayCount(numericAttribute(edge, 'supporting_interface_pair_count'))}
        />
        <Metric label="Агрегированная" value={edge.aggregate ? 'Да' : 'Нет'} />
      </div>
      <p className="aggregate-explanation">
        {edge.aggregate
          ? 'Эта линия объединяет физические пути между устройствами и не означает одно отдельное соединение в модели.'
          : 'Эта линия представляет отдельную связь в текущей проекции.'}
      </p>
      <section className="edge-endpoints">
        <h3>Устройства</h3>
        <div>
          {source && <button onClick={() => onSelectNode(source)}>{sourceLabel}</button>}
          <span aria-hidden="true">↔</span>
          {target && <button onClick={() => onSelectNode(target)}>{targetLabel}</button>}
        </div>
      </section>
      <TechnicalDetails selection={selection} />
    </aside>
  );
}
