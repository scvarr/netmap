import type { ELK, ElkExtendedEdge, ElkNode } from 'elkjs';
import type { Edge, Node } from '@xyflow/react';
import type {
  PhysicalEndpointPair,
  L1OffMapContinuation,
  TopologyProjectionEdge,
  TopologyProjectionNode,
} from './types';
import type { PresentationSceneDocument } from './presentationScene';
import type { MapCableRoute } from './savedMapTypes';
import type { MapCableRouteWaypoint } from './savedMapTypes';
import { blueprintNodeDisplayDimensions } from './blueprintDisplaySize';

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
  /** Temporary MapPage authoring state; deliberately separate from topology selection. */
  compositeMemberSelected?: boolean;
  traceHighlighted?: boolean;
  locationFocus?: 'match' | 'dim';
  traceHighlightedConnectionMemberIds?: ReadonlySet<string>;
  wiringHighlightedConnectionMemberIds?: ReadonlySet<string>;
  wiringContinuationConnectionPointIds?: ReadonlySet<string>;
  physicalPortStates?: Record<string, 'eligible' | 'source' | 'destination' | 'unavailable'>;
  onPhysicalPortClick?: (port: { physicalObjectId: string; connectionPointId: string; label: string }) => void;
  onPhysicalPortContextMenu?: (port: { physicalObjectId: string; connectionPointId: string; label: string }, screen: { x: number; y: number }) => void;
  onBlueprintDisplayResize?: (physicalObjectId: string, displayWidth: number) => void;
  blueprintResizeEnabled?: boolean;
  /** Bounded presentation control; never topology or persisted node data. */
  onCompositeToggle?: () => void;
}

export interface LogicalEdgeData extends Record<string, unknown> {
  projection?: TopologyProjectionEdge;
  endpointPair?: PhysicalEndpointPair;
  cableNode?: TopologyProjectionNode;
  supportingEdgeIds?: string[];
  /** Authoritative SavedMap state, enriched after topology-derived layout. */
  cableRoute?: MapCableRoute;
  cableRouteDraft?: {
    cableId: string;
    waypoints: readonly MapCableRouteWaypoint[];
    selectedWaypointIndex: number | null;
    onWaypointSelect: (index: number) => void;
    onWaypointMove: (index: number, waypoint: MapCableRouteWaypoint) => void;
    onWaypointInsert: (index: number, waypoint: MapCableRouteWaypoint) => void;
  };
  /** Route editing controls are rendered by the foreground cable overlay. */
  renderRouteEditorInForeground?: boolean;
  continuation?: L1OffMapContinuation;
}

export type DeviceFlowNode = Node<DeviceNodeData, 'device' | 'composite'>;
export type LogicalFlowEdge = Edge<LogicalEdgeData>;

export interface FlowProjection {
  nodes: DeviceFlowNode[];
  edges: LogicalFlowEdge[];
}

/** Presentation geometry only; never persisted as a PhysicalObject position. */
export const COMPOSITE_FRAME_HEADER_HEIGHT = 28;
export const COMPOSITE_FRAME_PADDING = 10;
export const COMPOSITE_FRAME_CONTENT_GAP = 6;
export const COMPOSITE_FRAME_MIN_WIDTH = 200;
export const COMPOSITE_FRAME_EMPTY_CONTENT_HEIGHT = 20;

const displayedDimensions = (node: DeviceFlowNode) => ({
  width: node.width ?? node.measured?.width ?? LAYOUT_NODE_WIDTH,
  height: node.height ?? node.measured?.height ?? LAYOUT_NODE_HEIGHT,
});

export interface CompositeFrameGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A derived presentation frame: it never changes its members' coordinates. */
export const compositeFrameGeometry = (
  rectangles: readonly { x: number; y: number; width: number; height: number }[],
): CompositeFrameGeometry => {
  if (!rectangles.length) {
    return {
      x: 0,
      y: 0,
      width: COMPOSITE_FRAME_MIN_WIDTH,
      height: COMPOSITE_FRAME_HEADER_HEIGHT + COMPOSITE_FRAME_CONTENT_GAP + COMPOSITE_FRAME_EMPTY_CONTENT_HEIGHT + COMPOSITE_FRAME_PADDING * 2,
    };
  }
  const left = Math.min(...rectangles.map((item) => item.x));
  const top = Math.min(...rectangles.map((item) => item.y));
  const right = Math.max(...rectangles.map((item) => item.x + item.width));
  const bottom = Math.max(...rectangles.map((item) => item.y + item.height));
  return {
    x: left - COMPOSITE_FRAME_PADDING,
    y: top - COMPOSITE_FRAME_HEADER_HEIGHT - COMPOSITE_FRAME_CONTENT_GAP - COMPOSITE_FRAME_PADDING,
    width: Math.max(COMPOSITE_FRAME_MIN_WIDTH, right - left + COMPOSITE_FRAME_PADDING * 2),
    height: bottom - top + COMPOSITE_FRAME_HEADER_HEIGHT + COMPOSITE_FRAME_CONTENT_GAP + COMPOSITE_FRAME_PADDING * 2,
  };
};

/**
 * Turns collapsed composite boundary members into React Flow children. Their
 * relative positions are derived from the authoritative expanded geometry.
 */
export const applyCollapsedCompositePresentation = (
  projection: FlowProjection,
  scene: PresentationSceneDocument,
): FlowProjection => {
  const nodes = projection.nodes.map((node) => ({ ...node, data: { ...node.data } }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const composite of scene.composites) {
    const frameId = `map-composite:${composite.id}`;
    const frame = nodesById.get(frameId);
    const members = composite.boundaryNodeIds
      .map((id) => nodesById.get(id))
      .filter((node): node is DeviceFlowNode => Boolean(node))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!frame) continue;

    if (members.length === 0) {
      const fallback = compositeFrameGeometry([]);
      frame.width = fallback.width;
      frame.height = fallback.height;
      frame.zIndex = 0;
      frame.data.projection = {
        ...frame.data.projection,
        attributes: { ...frame.data.projection.attributes, width: fallback.width, height: fallback.height },
      };
      continue;
    }

    const rectangles = members.map((node) => ({ ...node.position, ...displayedDimensions(node) }));
    const left = Math.min(...rectangles.map((item) => item.x));
    const top = Math.min(...rectangles.map((item) => item.y));
    const right = Math.max(...rectangles.map((item) => item.x + item.width));
    const groupWidth = right - left;
    const frameGeometry = compositeFrameGeometry(rectangles);
    const effectiveWidth = frameGeometry.width;
    const effectiveHeight = frameGeometry.height;
    const contentWidth = effectiveWidth - COMPOSITE_FRAME_PADDING * 2;
    const offsetX = COMPOSITE_FRAME_PADDING + (contentWidth - groupWidth) / 2;
    const offsetY = COMPOSITE_FRAME_HEADER_HEIGHT + COMPOSITE_FRAME_CONTENT_GAP + COMPOSITE_FRAME_PADDING;

    frame.width = effectiveWidth;
    frame.height = effectiveHeight;
    frame.zIndex = 0;
    frame.data.projection = {
      ...frame.data.projection,
      attributes: {
        ...frame.data.projection.attributes,
        width: effectiveWidth,
        height: effectiveHeight,
      },
    };

    for (const member of members) {
      member.parentId = frameId;
      member.extent = 'parent';
      member.expandParent = false;
      member.zIndex = 1;
      member.position = {
        x: offsetX + member.position.x - left,
        y: offsetY + member.position.y - top,
      };
    }
  }

  const frameIds = new Set(scene.composites.map((composite) => `map-composite:${composite.id}`));
  return {
    ...projection,
    // React Flow requires parent nodes to precede their children in the node array.
    nodes: [...nodes.filter((node) => frameIds.has(node.id)), ...nodes.filter((node) => !frameIds.has(node.id))],
  };
};

export type TopologyLayoutEngine = (
  scene: PresentationSceneDocument,
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

export const toFlowProjection: TopologyLayoutEngine = async (scene) => {
  const orderedNodes = [...scene.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const orderedEdges = [...scene.edges]
    .filter((edge) => edge.kind !== 'off-map-continuation')
    .sort((left, right) => left.id.localeCompare(right.id));
  const layoutEdges: ElkExtendedEdge[] = orientLayoutEdges(
    orderedNodes,
    orderedEdges.map((edge) => ({ id: edge.id, from_node_id: edge.source, to_node_id: edge.target } as TopologyProjectionEdge)),
  ).map((edge) => ({
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
      ...(node.kind === 'MAP_COMPOSITE'
        ? { width: Number(node.attributes.width), height: Number(node.attributes.height) }
        : node.attributes.blueprint_presentation
        ? blueprintNodeDisplayDimensions(node.attributes.blueprint_presentation, undefined)
        : { width: LAYOUT_NODE_WIDTH, height: LAYOUT_NODE_HEIGHT }),
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
      type: (projection.kind === 'MAP_COMPOSITE' ? 'composite' : 'device') as DeviceFlowNode['type'],
      ...(projection.kind === 'MAP_COMPOSITE'
        ? { width: Number(projection.attributes.width), height: Number(projection.attributes.height) }
        : projection.attributes.blueprint_presentation
        ? blueprintNodeDisplayDimensions(projection.attributes.blueprint_presentation, undefined)
        : { width: undefined, height: undefined }),
      position: projection.kind === 'MAP_COMPOSITE'
        ? { x: Number(projection.attributes.x), y: Number(projection.attributes.y) }
        : positions.get(projection.id) ?? { x: 0, y: 0 },
      data: { projection },
    })),
    edges: scene.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.kind === 'off-map-continuation' ? 'continuation' as const : 'floating' as const,
      data: {
        projection: edge.projectionEdge,
        endpointPair: edge.endpointPair,
        cableNode: edge.cableNode,
        continuation: edge.continuation,
      },
    })),
  };
};
