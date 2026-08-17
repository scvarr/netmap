import type {
  ProjectionSourceRef,
  TopologyDataSource,
  TopologyProjectionDocument,
  TopologyProjectionEdge,
  TopologyProjectionNode,
  TopologyProjectionRequest,
} from './types';

const deviceRef = (entityId: string): ProjectionSourceRef => ({
  ref_type: 'CANONICAL_FACT',
  entity_type: 'PhysicalObject',
  entity_id: entityId,
});

const connectionRef = (entityId: string): ProjectionSourceRef => ({
  ref_type: 'CANONICAL_FACT',
  entity_type: 'Connection',
  entity_id: entityId,
});

const device = (id: string, label: string, role: string, scope: string): TopologyProjectionNode => ({
  id,
  kind: 'NETWORK_DEVICE',
  label,
  status: 'CONFIGURED',
  source_refs: [deviceRef(`fixture-physical-object-${label.toLowerCase()}`)],
  attributes: { role, scope },
});

const link = (from: string, to: string): TopologyProjectionEdge => ({
  id: `link-${from}-${to}`,
  from_node_id: from,
  to_node_id: to,
  kind: 'LOGICAL_LINK',
  aggregate: true,
  status: 'CONFIGURED',
  source_refs: [connectionRef(`fixture-connection-${from}-${to}`)],
  attributes: { relation_count: 1 },
});

const FIXTURE_DOCUMENT: TopologyProjectionDocument = {
  schema_version: '1.0',
  layer: 'L2',
  detail_level: 'DEVICE',
  nodes: [
    device('sw-a-f1', 'SW-A-F1', 'ACCESS', 'Корпус A'),
    device('sw-a-f2', 'SW-A-F2', 'ACCESS', 'Корпус A'),
    device('core-a', 'CORE-A', 'CORE', 'Корпус A'),
    device('edge-a', 'EDGE-A', 'EDGE', 'Межкорпусная сеть'),
    device('core-b', 'CORE-B', 'CORE', 'Корпус B'),
    device('sw-b-f1', 'SW-B-F1', 'ACCESS', 'Корпус B'),
    device('sw-b-f2', 'SW-B-F2', 'ACCESS', 'Корпус B'),
  ],
  edges: [
    link('sw-a-f1', 'core-a'),
    link('sw-a-f2', 'core-a'),
    link('core-a', 'edge-a'),
    link('edge-a', 'core-b'),
    link('edge-a', 'sw-b-f1'),
    link('core-b', 'sw-b-f2'),
  ],
  gaps: [],
  warnings: ['Локальная демонстрационная projection: canonical backend topology API пока не подключён.'],
};

const cloneDocument = (): TopologyProjectionDocument => structuredClone(FIXTURE_DOCUMENT);

export class FixtureTopologyDataSource implements TopologyDataSource {
  async loadProjection(request: TopologyProjectionRequest): Promise<TopologyProjectionDocument> {
    if (request.detail_level !== 'DEVICE') {
      throw new Error('Fixture поддерживает только detail_level DEVICE.');
    }
    return cloneDocument();
  }
}
