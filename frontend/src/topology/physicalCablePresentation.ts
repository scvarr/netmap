import type {
  PhysicalEndpointPair,
  TopologyProjectionDocument,
  TopologyProjectionEdge,
  TopologyProjectionNode,
} from './types';

export interface CollapsedCable {
  cable: TopologyProjectionNode;
  source: string;
  target: string;
  endpointPair: PhysicalEndpointPair;
  supportingEdgeIds: string[];
}

export interface PhysicalCablePresentation {
  nodes: TopologyProjectionNode[];
  edges: TopologyProjectionEdge[];
  cables: CollapsedCable[];
}

/** Split canonical cable-backed endpoint pairs from ordinary Connection edges. */
export const physicalCablePresentation = (
  document: TopologyProjectionDocument,
): PhysicalCablePresentation => {
  if (document.layer !== 'L1' || document.detail_level !== 'PHYSICAL_OBJECT') {
    return { nodes: [...document.nodes], edges: [...document.edges], cables: [] };
  }

  const cables = new Map<string, CollapsedCable>();
  const edges: TopologyProjectionEdge[] = [];
  for (const edge of document.edges) {
    const pairs = edge.attributes.endpoint_pairs ?? [];
    const directPairs: PhysicalEndpointPair[] = [];
    for (const pair of pairs) {
      const ref = pair.cable_ref;
      if (!ref || ref.ref_type !== 'CANONICAL_FACT' || ref.entity_type !== 'Cable') {
        directPairs.push(pair);
        continue;
      }
      if (!cables.has(ref.entity_id)) {
        cables.set(ref.entity_id, {
          cable: {
            id: `cable:${ref.entity_id}`,
            kind: 'CABLE',
            label: pair.cable_display_name ?? `Cable ${ref.entity_id.slice(0, 8)}`,
            source_refs: [ref],
            attributes: {},
            status: 'CONFIGURED',
          },
          source: edge.from_node_id,
          target: edge.to_node_id,
          endpointPair: pair,
          supportingEdgeIds: [edge.id],
        });
      }
    }
    if (pairs.length === 0 || directPairs.length > 0) {
      edges.push(
        directPairs.length === pairs.length
          ? edge
          : { ...edge, attributes: { ...edge.attributes, endpoint_pairs: directPairs } },
      );
    }
  }
  return { nodes: [...document.nodes], edges, cables: [...cables.values()] };
};
