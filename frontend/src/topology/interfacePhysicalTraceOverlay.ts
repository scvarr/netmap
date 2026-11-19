import type { PhysicalObjectL1TraceArtifact, PhysicalTraceEvidenceRef } from './physicalObjectL1TraceTypes';
import type { TopologyProjectionDocument } from './types';

export interface PhysicalTraceOverlay {
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
  highlightedConnectionMemberIds: Set<string>;
  highlightedConnectionPointIds: Set<string>;
  /** Exact canonical Cable identities evidenced by the selected branch. */
  highlightedCableIds: Set<string>;
}

const emptyOverlay = (): PhysicalTraceOverlay => ({ highlightedNodeIds: new Set(), highlightedEdgeIds: new Set(), highlightedConnectionMemberIds: new Set(), highlightedConnectionPointIds: new Set(), highlightedCableIds: new Set() });

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
  if (!branch) return overlay;
  evidence.push(...branch.evidence_refs);
  const points = overlay.highlightedConnectionPointIds;
  if (branch.source) points.add(branch.source.point_id);
  if (branch.target) points.add(branch.target.point_id);
  for (const edgeId of branch.edge_ids) {
    const edge = traceEdges.get(edgeId);
    if (!edge) continue;
    evidence.push(...edge.evidence_refs);
    for (const nodeId of [edge.from_node_id, edge.to_node_id]) {
      const refs = traceNodes.get(nodeId)?.canonical_refs ?? [];
      evidence.push(...refs);
      for (const ref of refs) if (ref.entity_type === 'ConnectionPoint') points.add(ref.entity_id);
    }
  }
  const members = new Set(evidence.filter(ref => ref.entity_type === 'ConnectionMember').map(ref => ref.entity_id));

  for (const edge of document.edges) {
    for (const pair of edge.attributes.endpoint_pairs ?? []) {
      if (members.has(pair.connection_member_id)) {
        points.add(pair.from_connection_point_id);
        points.add(pair.to_connection_point_id);
        overlay.highlightedConnectionMemberIds.add(pair.connection_member_id);
      }
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
    // Endpoints are emphasized only because this exact physical projection edge is evidenced.
    overlay.highlightedNodeIds.add(edge.from_node_id);
    overlay.highlightedNodeIds.add(edge.to_node_id);
  }
  for (const node of document.nodes) {
    for (const link of node.attributes.internal_l1_links ?? []) {
      if (members.has(link.connection_member_id)) {
        points.add(link.from_connection_point_id);
        points.add(link.to_connection_point_id);
        overlay.highlightedConnectionMemberIds.add(link.connection_member_id);
        overlay.highlightedNodeIds.add(node.id);
      }
    }
    if (node.source_refs.some((ref) => evidence.some((item) => sameEvidence(item, ref)))) {
      overlay.highlightedNodeIds.add(node.id);
    }
  }
  for (const continuation of document.l1_off_map_continuations ?? []) {
    if (!continuation.source_refs.some(ref => ref.entity_type === 'ConnectionMember' && members.has(ref.entity_id))) continue;
    points.add(continuation.local_connection_point_ref.entity_id);
    overlay.highlightedCableIds.add(continuation.cable_ref.entity_id);
    overlay.highlightedNodeIds.add(continuation.local_node_id);
  }
  return overlay;
};
