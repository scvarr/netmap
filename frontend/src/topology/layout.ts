import type { ELK, ElkExtendedEdge, ElkNode } from 'elkjs';
import type { Edge, Node } from '@xyflow/react';
import type {
  TopologyProjectionDocument,
  TopologyProjectionEdge,
  TopologyProjectionNode,
} from './types';

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
  const orderedNodes = [...document.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const orderedEdges = [...document.edges].sort((left, right) => left.id.localeCompare(right.id));
  const layoutEdges: ElkExtendedEdge[] = orientLayoutEdges(orderedNodes, orderedEdges).map((edge) => ({
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
      width: LAYOUT_NODE_WIDTH,
      height: LAYOUT_NODE_HEIGHT,
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
      position: positions.get(projection.id) ?? { x: 0, y: 0 },
      data: { projection },
    })),
    edges: orderedEdges.map((projection) => ({
      id: projection.id,
      source: projection.from_node_id,
      target: projection.to_node_id,
      type: 'floating',
      data: { projection },
    })),
  };
};
