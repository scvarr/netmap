import type { ELK, ElkExtendedEdge, ElkNode } from 'elkjs';
import type { Edge, Node } from '@xyflow/react';
import type {
  PhysicalEndpointPair,
  L1OffMapContinuation,
  TopologyProjectionDocument,
  TopologyProjectionEdge,
  TopologyProjectionNode,
} from './types';
import { physicalCablePresentation } from './physicalCablePresentation';

export const LAYOUT_NODE_WIDTH = 212;
export const LAYOUT_NODE_HEIGHT = 144;

let elkPromise: Promise<ELK> | null = null;

const loadElk = (): Promise<ELK> => {
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then(
    ({ default: ElkConstructor }) => new ElkConstructor(),
  );
  return elkPromise;
};

export interface DeviceNodeData extends Record<string, unknown> {
  projection: TopologyProjectionNode;
  traceHighlighted?: boolean;
}

export interface LogicalEdgeData extends Record<string, unknown> {
  projection: TopologyProjectionEdge;
  endpointPair?: PhysicalEndpointPair;
  cableNode?: TopologyProjectionNode;
  supportingEdgeIds?: [string, string];
  continuation?: L1OffMapContinuation;
}

export type DeviceFlowNode = Node<DeviceNodeData, 'device'>;
export type LogicalFlowEdge = Edge<LogicalEdgeData>;

export interface FlowProjection {
  nodes: DeviceFlowNode[];
  edges: LogicalFlowEdge[];
}

export type TopologyLayoutEngine = (
  document: TopologyProjectionDocument,
) => Promise<FlowProjection>;

interface OrientedEdge {
  id: string;
  source: string;
  target: string;
}

const orientLayoutEdges = (
  nodes: TopologyProjectionNode[],
  edges: TopologyProjectionEdge[],
): OrientedEdge[] => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map([...nodeIds].map((id) => [id, new Set<string>()]));
  const validEdges = edges
    .filter((edge) => nodeIds.has(edge.from_node_id) && nodeIds.has(edge.to_node_id))
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const edge of validEdges) {
    adjacency.get(edge.from_node_id)?.add(edge.to_node_id);
    adjacency.get(edge.to_node_id)?.add(edge.from_node_id);
  }

  const depth = new Map<string, number>();
  const remaining = new Set(nodeIds);
  while (remaining.size > 0) {
    const component: string[] = [];
    const seed = [...remaining].sort()[0];
    const pending = [seed];
    remaining.delete(seed);
    while (pending.length > 0) {
      const current = pending.shift()!;
      component.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (!remaining.delete(neighbor)) continue;
        pending.push(neighbor);
      }
    }

    const root = component.sort((left, right) => {
      const degreeDifference = (adjacency.get(left)?.size ?? 0) - (adjacency.get(right)?.size ?? 0);
      return degreeDifference || left.localeCompare(right);
    })[0];
    const breadthFirst = [root];
    depth.set(root, 0);
    while (breadthFirst.length > 0) {
      const current = breadthFirst.shift()!;
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (depth.has(neighbor)) continue;
        depth.set(neighbor, (depth.get(current) ?? 0) + 1);
        breadthFirst.push(neighbor);
      }
    }
  }

  return validEdges.map((edge) => {
    const fromDepth = depth.get(edge.from_node_id) ?? 0;
    const toDepth = depth.get(edge.to_node_id) ?? 0;
    const keepDirection = fromDepth < toDepth
      || (fromDepth === toDepth && edge.from_node_id.localeCompare(edge.to_node_id) <= 0);
    return {
      id: edge.id,
      source: keepDirection ? edge.from_node_id : edge.to_node_id,
      target: keepDirection ? edge.to_node_id : edge.from_node_id,
    };
  });
};

export const toFlowProjection: TopologyLayoutEngine = async (document) => {
  const presentation = physicalCablePresentation(document);
  const orderedNodes = [...presentation.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const orderedEdges = [...presentation.edges].sort((left, right) => left.id.localeCompare(right.id));
  const synthetic = presentation.cables.map((cable) => ({ id: `layout:${cable.cable.id}`, from_node_id: cable.source, to_node_id: cable.target } as TopologyProjectionEdge));
  const layoutEdges: ElkExtendedEdge[] = orientLayoutEdges(orderedNodes, [...orderedEdges, ...synthetic]).map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));
  const graph: ElkNode = {
    id: 'topology-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.nodeNode': '80',
      'elk.spacing.componentComponent': '160',
      'elk.layered.spacing.nodeNodeBetweenLayers': '140',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
      'elk.randomSeed': '1',
    },
    children: orderedNodes.map((node) => ({
      id: node.id,
      width: node.attributes.blueprint_presentation?.body.width ?? LAYOUT_NODE_WIDTH,
      height: node.attributes.blueprint_presentation?.body.height ?? LAYOUT_NODE_HEIGHT,
    })),
    edges: layoutEdges,
  };

  const layoutEngine = await loadElk();
  const result = await layoutEngine.layout(graph);
  const positions = new Map(
    (result.children ?? []).map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]),
  );

  return {
    nodes: orderedNodes.map((projection) => ({
      id: projection.id,
      type: 'device',
      width: projection.attributes.blueprint_presentation?.body.width,
      height: projection.attributes.blueprint_presentation?.body.height,
      position: positions.get(projection.id) ?? { x: 0, y: 0 },
      data: { projection },
    })),
    edges: [...orderedEdges.flatMap((projection) => {
      const pairs = projection.attributes.endpoint_pairs;
      return pairs?.length ? pairs.map((endpointPair) => ({ id: `${projection.id}::member::${endpointPair.connection_member_id}`, source: projection.from_node_id, target: projection.to_node_id, type: 'floating' as const, data: { projection, endpointPair } })) : [{ id: projection.id, source: projection.from_node_id, target: projection.to_node_id, type: 'floating' as const, data: { projection } }];
    }), ...presentation.cables.map((cable) => ({ id: `collapsed-cable:${cable.cable.id}`, source: cable.source, target: cable.target, type: 'floating' as const, data: { projection: { id: `presentation:${cable.cable.id}`, from_node_id: cable.source, to_node_id: cable.target, kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: {} }, endpointPair: cable.endpointPair, cableNode: cable.cable, supportingEdgeIds: cable.supportingEdgeIds } })), ...(document.l1_off_map_continuations ?? []).map((continuation) => ({ id: `off-map-continuation:${continuation.id}`, source: continuation.local_node_id, target: continuation.local_node_id, type: 'continuation' as const, data: { projection: { id: `presentation:${continuation.id}`, from_node_id: continuation.local_node_id, to_node_id: continuation.local_node_id, kind: 'L1_OFF_MAP_CONTINUATION', aggregate: false, source_refs: continuation.source_refs, attributes: {} }, continuation } }))],
  };
};
