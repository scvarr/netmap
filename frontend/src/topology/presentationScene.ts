import type {
  L1OffMapContinuation,
  PhysicalEndpointPair,
  TopologyProjectionDocument,
  TopologyProjectionEdge,
  TopologyProjectionNode,
} from './types';

/**
 * Ephemeral, read-only input to presentation geometry.  It is deliberately
 * not a SavedMap or a topology DTO: every edge retains the projection or
 * canonical evidence from which it was displayed.
 */
export interface PresentationSceneDocument {
  layer: TopologyProjectionDocument['layer'];
  detail_level: TopologyProjectionDocument['detail_level'];
  nodes: TopologyProjectionNode[];
  edges: PresentationSceneEdge[];
}

export interface PresentationSceneEdge {
  id: string;
  source: string;
  target: string;
  kind: 'projection' | 'cable' | 'off-map-continuation';
  /** The exact projection relation shown by a normal or Cable-backed edge. */
  projectionEdge?: TopologyProjectionEdge;
  endpointPair?: PhysicalEndpointPair;
  /** A display node which carries the exact canonical Cable reference. */
  cableNode?: TopologyProjectionNode;
  continuation?: L1OffMapContinuation;
}

const cableNodeFor = (pair: PhysicalEndpointPair): TopologyProjectionNode => {
  const cable = pair.cable_ref!;
  return {
    id: `cable:${cable.entity_id}`,
    kind: 'CABLE',
    label: pair.cable_display_name ?? `Cable ${cable.entity_id.slice(0, 8)}`,
    source_refs: [cable],
    attributes: {},
    status: 'CONFIGURED',
  };
};

const sceneEdgesForProjection = (edge: TopologyProjectionEdge): PresentationSceneEdge[] => {
  const pairs = edge.attributes.endpoint_pairs;
  if (!pairs?.length) {
    return [{ id: edge.id, source: edge.from_node_id, target: edge.to_node_id, kind: 'projection', projectionEdge: edge }];
  }
  return pairs.map((endpointPair) => {
    const cable = endpointPair.cable_ref;
    const isCable = cable?.ref_type === 'CANONICAL_FACT' && cable.entity_type === 'Cable';
    return {
      id: isCable
        ? `collapsed-cable:${cable.entity_id}`
        : `${edge.id}::member::${endpointPair.connection_member_id}`,
      source: edge.from_node_id,
      target: edge.to_node_id,
      kind: isCable ? 'cable' : 'projection',
      projectionEdge: edge,
      endpointPair,
      ...(isCable ? { cableNode: cableNodeFor(endpointPair) } : {}),
    };
  });
};

/** Form all display semantics before coordinates and edge geometry are computed. */
export const presentationSceneDocument = (
  document: TopologyProjectionDocument,
): PresentationSceneDocument => ({
  layer: document.layer,
  detail_level: document.detail_level,
  nodes: [...document.nodes],
  edges: [
    ...document.edges.flatMap(sceneEdgesForProjection),
    ...(document.l1_off_map_continuations ?? []).map((continuation) => ({
      id: `off-map-continuation:${continuation.id}`,
      source: continuation.local_node_id,
      target: continuation.local_node_id,
      kind: 'off-map-continuation' as const,
      continuation,
    })),
  ],
});
