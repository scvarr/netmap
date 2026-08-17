import type { Edge, Node } from '@xyflow/react';
import type {
  TopologyProjectionDocument,
  TopologyProjectionEdge,
  TopologyProjectionNode,
} from './types';

const POSITIONS: Record<string, { x: number; y: number }> = {
  'sw-a-f1': { x: 40, y: 80 },
  'sw-a-f2': { x: 40, y: 350 },
  'core-a': { x: 350, y: 215 },
  'edge-a': { x: 690, y: 215 },
  'core-b': { x: 1030, y: 215 },
  'sw-b-f1': { x: 750, y: 470 },
  'sw-b-f2': { x: 1120, y: 470 },
};

export interface DeviceNodeData extends Record<string, unknown> {
  projection: TopologyProjectionNode;
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

export const toFlowProjection = (document: TopologyProjectionDocument): FlowProjection => ({
  nodes: document.nodes.map((projection, index) => ({
    id: projection.id,
    type: 'device',
    position: POSITIONS[projection.id] ?? {
      x: 80 + (index % 4) * 300,
      y: 80 + Math.floor(index / 4) * 220,
    },
    data: { projection },
  })),
  edges: document.edges.map((projection) => ({
    id: projection.id,
    source: projection.from_node_id,
    target: projection.to_node_id,
    type: 'smoothstep',
    data: { projection },
  })),
});
