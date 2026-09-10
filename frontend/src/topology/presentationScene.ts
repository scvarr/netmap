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
  composites: PresentationSceneComposite[];
  /** Exact visible-side ConnectionPoints whose peer is hidden in a collapsed composite. */
  hiddenCompositeConnectionPointIds?: string[];
}

/** Scene-only future composition boundary; it never replaces topology nodes. */
export interface PresentationSceneComposite {
  id: string;
  displayName: string;
  memberNodeIds: string[];
  boundaryNodeIds: string[];
  explicitVisibleNodeIds?: string[];
  visibleNodeIds?: string[];
  compositionBasis: string;
}

/** Persisted B.3 composite input, consumed before any layout is attempted. */
export interface MapCompositeSceneInput {
  id: string;
  displayName: string;
  memberNodeIds: string[];
  explicitVisibleNodeIds?: string[];
  collapsed: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CableSceneEvidence {
  endpointPair: PhysicalEndpointPair;
  projectionEdge: TopologyProjectionEdge;
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
  /** All members and projection edges represented by a deduplicated Cable. */
  cableEvidence?: CableSceneEvidence[];
  supportingProjectionEdgeIds?: string[];
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

const isPhysicalProjection = (document: TopologyProjectionDocument): boolean => (
  document.layer === 'L1' && document.detail_level === 'PHYSICAL_OBJECT'
);

const projectionSceneEdge = (edge: TopologyProjectionEdge): PresentationSceneEdge => ({
  id: edge.id,
  source: edge.from_node_id,
  target: edge.to_node_id,
  kind: 'projection',
  projectionEdge: edge,
});

/** Form all display semantics before coordinates and edge geometry are computed. */
export const presentationSceneDocument = (
  document: TopologyProjectionDocument,
  compositeInputs: readonly MapCompositeSceneInput[] = [],
): PresentationSceneDocument => {
  if (!isPhysicalProjection(document)) {
    return {
      layer: document.layer,
      detail_level: document.detail_level,
      nodes: [...document.nodes],
      edges: document.edges.map(projectionSceneEdge),
      composites: [],
      hiddenCompositeConnectionPointIds: [],
    };
  }

  const edges: PresentationSceneEdge[] = [];
  const cables = new Map<string, PresentationSceneEdge>();
  for (const projectionEdge of document.edges) {
    const pairs = projectionEdge.attributes.endpoint_pairs;
    if (!pairs?.length) {
      edges.push(projectionSceneEdge(projectionEdge));
      continue;
    }
    for (const endpointPair of pairs) {
      const cable = endpointPair.cable_ref;
      const isCable = cable?.ref_type === 'CANONICAL_FACT' && cable.entity_type === 'Cable';
      if (!isCable) {
        edges.push({
          id: `${projectionEdge.id}::member::${endpointPair.connection_member_id}`,
          source: projectionEdge.from_node_id,
          target: projectionEdge.to_node_id,
          kind: 'projection',
          projectionEdge,
          endpointPair,
        });
        continue;
      }

      const evidence: CableSceneEvidence = { endpointPair, projectionEdge };
      const existing = cables.get(cable.entity_id);
      if (existing) {
        existing.cableEvidence!.push(evidence);
        if (!existing.supportingProjectionEdgeIds!.includes(projectionEdge.id)) {
          existing.supportingProjectionEdgeIds!.push(projectionEdge.id);
        }
        continue;
      }
      const sceneEdge: PresentationSceneEdge = {
        id: `collapsed-cable:${cable.entity_id}`,
        source: projectionEdge.from_node_id,
        target: projectionEdge.to_node_id,
        kind: 'cable',
        projectionEdge,
        endpointPair,
        cableNode: cableNodeFor(endpointPair),
        cableEvidence: [evidence],
        supportingProjectionEdgeIds: [projectionEdge.id],
      };
      cables.set(cable.entity_id, sceneEdge);
      edges.push(sceneEdge);
    }
  }

  const collapsed = compositeInputs.filter((item) => item.collapsed);
  const hiddenNodeIds = new Set<string>();
  const composites: PresentationSceneComposite[] = collapsed.map((item) => {
    const members = new Set(item.memberNodeIds);
    const boundary = new Set<string>();
    for (const edge of edges) {
      const sourceMember = members.has(edge.source);
      const targetMember = members.has(edge.target);
      if (sourceMember !== targetMember) {
        if (sourceMember) boundary.add(edge.source);
        if (targetMember) boundary.add(edge.target);
      }
    }
    const explicitVisible = new Set((item.explicitVisibleNodeIds ?? []).filter((id) => members.has(id)));
    const visible = new Set([...boundary, ...explicitVisible]);
    for (const member of members) if (!visible.has(member)) hiddenNodeIds.add(member);
    return { id: item.id, displayName: item.displayName, memberNodeIds: [...members], boundaryNodeIds: [...boundary], explicitVisibleNodeIds: [...explicitVisible], visibleNodeIds: [...visible], compositionBasis: "MapComposite placement membership" };
  });
  const hiddenCompositeConnectionPointIds = new Set<string>();
  for (const composite of composites) {
    const members = new Set(composite.memberNodeIds);
    const visible = new Set(composite.visibleNodeIds ?? []);
    for (const edge of edges) {
      const evidence = edge.cableEvidence ?? (edge.endpointPair && edge.projectionEdge ? [{ endpointPair: edge.endpointPair, projectionEdge: edge.projectionEdge }] : []);
      for (const item of evidence) {
        const sourceVisible = members.has(item.projectionEdge.from_node_id) && visible.has(item.projectionEdge.from_node_id);
        const targetVisible = members.has(item.projectionEdge.to_node_id) && visible.has(item.projectionEdge.to_node_id);
        const sourceHidden = members.has(item.projectionEdge.from_node_id) && hiddenNodeIds.has(item.projectionEdge.from_node_id);
        const targetHidden = members.has(item.projectionEdge.to_node_id) && hiddenNodeIds.has(item.projectionEdge.to_node_id);
        if (sourceVisible && targetHidden) hiddenCompositeConnectionPointIds.add(item.endpointPair.from_connection_point_id);
        if (targetVisible && sourceHidden) hiddenCompositeConnectionPointIds.add(item.endpointPair.to_connection_point_id);
      }
    }
  }
  const visibleEdges = edges.filter((edge) => !hiddenNodeIds.has(edge.source) && !hiddenNodeIds.has(edge.target));
  return {
    layer: document.layer,
    detail_level: document.detail_level,
    nodes: [
      ...document.nodes.filter((node) => !hiddenNodeIds.has(node.id)),
      ...collapsed.map((item) => ({ id: `map-composite:${item.id}`, kind: 'MAP_COMPOSITE', label: item.displayName, source_refs: [], attributes: { presentation_only: true, composite_id: item.id, collapsed: true, x: item.x, y: item.y, width: item.width, height: item.height }, status: 'CONFIGURED' })),
    ],
    edges: [
      ...visibleEdges,
      ...(document.l1_off_map_continuations ?? []).map((continuation) => ({
      id: `off-map-continuation:${continuation.id}`,
      source: continuation.local_node_id,
      target: continuation.local_node_id,
      kind: 'off-map-continuation' as const,
      continuation,
    })),
    ],
    composites,
    hiddenCompositeConnectionPointIds: [...hiddenCompositeConnectionPointIds],
  };
};
