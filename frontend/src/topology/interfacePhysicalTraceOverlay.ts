import type { PhysicalObjectL1TraceArtifact, PhysicalTraceEvidenceRef } from './physicalObjectL1TraceTypes';
import type { TopologyProjectionDocument } from './types';

export interface PhysicalTraceOverlay {
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
  highlightedConnectionMemberIds: Set<string>;
  /** Exact canonical Cable identities evidenced by the selected branch. */
  highlightedCableIds: Set<string>;
}

const emptyOverlay = (): PhysicalTraceOverlay => ({ highlightedNodeIds: new Set(), highlightedEdgeIds: new Set(), highlightedConnectionMemberIds: new Set(), highlightedCableIds: new Set() });

const sameEvidence = (left: PhysicalTraceEvidenceRef, right: { entity_type: string; entity_id: string }): boolean => (
  left.entity_type === right.entity_type && left.entity_id === right.entity_id
);

export const physicalTraceOverlayFor = (
  artifact: PhysicalObjectL1TraceArtifact | null,
  document: TopologyProjectionDocument | null,
  selectedBranchId: string | null,
): PhysicalTraceOverlay => {
  const overlay = emptyOverlay();
  if (!artifact || artifact.verdict !== 'REACHABLE' || !document || document.layer !== 'L1') return overlay;

  const traceEdges = new Map(artifact.edges.map((edge) => [edge.id, edge]));
  const traceNodes = new Map(artifact.nodes.map((node) => [node.id, node]));
  const evidence: PhysicalTraceEvidenceRef[] = [];
  const branch = artifact.branches.find((item) => item.branch_id === selectedBranchId);
  if (branch) {
    evidence.push(...branch.evidence_refs);
    for (const edgeId of branch.edge_ids) {
      const edge = traceEdges.get(edgeId);
      if (!edge) continue;
      evidence.push(...edge.evidence_refs);
      evidence.push(...(traceNodes.get(edge.from_node_id)?.canonical_refs ?? []));
      evidence.push(...(traceNodes.get(edge.to_node_id)?.canonical_refs ?? []));
    }
  }
  if (evidence.length === 0) return overlay;

  for (const edge of document.edges) {
    for (const pair of edge.attributes.endpoint_pairs ?? []) {
      const cable = pair.cable_ref;
      if (
        cable?.ref_type === 'CANONICAL_FACT'
        && cable.entity_type === 'Cable'
        && evidence.some((item) => (
          sameEvidence(item, cable)
          || (item.entity_type === 'Connection' && item.entity_id === pair.connection_id)
          || (item.entity_type === 'ConnectionMember' && item.entity_id === pair.connection_member_id)
        ))
      ) {
        overlay.highlightedCableIds.add(cable.entity_id);
      }
    }
    if (!edge.source_refs.some((ref) => evidence.some((item) => sameEvidence(item, ref)))) continue;
    overlay.highlightedEdgeIds.add(edge.id);
    for (const pair of edge.attributes.endpoint_pairs ?? []) if (evidence.some((item) => item.entity_type === 'ConnectionMember' && item.entity_id === pair.connection_member_id)) overlay.highlightedConnectionMemberIds.add(pair.connection_member_id);
    // Endpoints are emphasized only because this exact physical projection edge is evidenced.
    overlay.highlightedNodeIds.add(edge.from_node_id);
    overlay.highlightedNodeIds.add(edge.to_node_id);
  }
  for (const node of document.nodes) {
    for (const link of node.attributes.internal_l1_links ?? []) {
      if (evidence.some((item) => (
        item.entity_type === 'ConnectionMember'
        && item.entity_id === link.connection_member_id
      ))) {
        overlay.highlightedConnectionMemberIds.add(link.connection_member_id);
        overlay.highlightedNodeIds.add(node.id);
      }
    }
    if (node.source_refs.some((ref) => evidence.some((item) => sameEvidence(item, ref)))) {
      overlay.highlightedNodeIds.add(node.id);
    }
  }
  return overlay;
};
