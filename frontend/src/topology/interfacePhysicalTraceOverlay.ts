import type { PhysicalObjectL1TraceArtifact, PhysicalTraceEvidenceRef } from './physicalObjectL1TraceTypes';
import type { ExactMemberTrace } from './exactMemberTrace';
import type { ProjectionSourceRef, TopologyProjectionDocument } from './types';

export interface PhysicalTraceOverlay {
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
  highlightedConnectionMemberIds: Set<string>;
  highlightedConnectionPointIds: Set<string>;
  faceConnectionPointIds?: Set<string>;
  /** Exact canonical Cable identities evidenced by the selected branch. */
  highlightedCableIds: Set<string>;
}

const emptyOverlay = (): PhysicalTraceOverlay => ({ highlightedNodeIds: new Set(), highlightedEdgeIds: new Set(), highlightedConnectionMemberIds: new Set(), highlightedConnectionPointIds: new Set(), highlightedCableIds: new Set() });

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
      for (const ref of refs) if (ref.entity_type === 'ConnectionPoint') points.add(ref.entity_id);
    }
  }
  return projectTraceEvidence(document, overlay, evidence);
};

export function exactTraceOverlayFor(trace: Pick<ExactMemberTrace, 'edges'> | null, document: TopologyProjectionDocument | null): PhysicalTraceOverlay {
  const overlay = emptyOverlay();
  if (!trace || document?.layer !== 'L1') return overlay;
  const points = new Set<string>();
  for (const edge of trace.edges) {
    for (const ref of edge.evidence_refs) if (ref.entity_type === 'ConnectionPoint') points.add(ref.entity_id);
  }
  overlay.faceConnectionPointIds = points;
  return projectTraceEvidence(document, overlay, trace.edges.flatMap(edge => edge.evidence_refs), true);
}

function projectTraceEvidence(document: TopologyProjectionDocument, overlay: PhysicalTraceOverlay,
  evidence: PhysicalTraceEvidenceRef[], exact = false): PhysicalTraceOverlay {
  const points = overlay.faceConnectionPointIds ?? overlay.highlightedConnectionPointIds;
  const connections = new Set(evidence.filter(ref => ref.entity_type === 'Connection').map(ref => ref.entity_id));
  const members = new Set(evidence.filter(ref => ref.entity_type === 'ConnectionMember').map(ref => ref.entity_id));
  const cables = new Set(evidence.filter(ref => ref.entity_type === 'Cable').map(ref => ref.entity_id));
  const objects = new Set(evidence.filter(ref => ref.entity_type === 'PhysicalObject').map(ref => ref.entity_id));
  const matchesLine = (ref: ProjectionSourceRef) => ref.ref_type === 'CANONICAL_FACT' && (
    (ref.entity_type === 'ConnectionMember' && members.has(ref.entity_id))
    || (ref.entity_type === 'Cable' && cables.has(ref.entity_id))
  );

  for (const edge of document.edges) {
    let highlighted = edge.source_refs.some(matchesLine);
    for (const pair of edge.attributes.endpoint_pairs ?? []) {
      const cable = pair.cable_ref;
      const canonicalCable = cable?.ref_type === 'CANONICAL_FACT' && cable.entity_type === 'Cable' ? cable : undefined;
      const memberMatches = members.has(pair.connection_member_id);
      if (exact
        ? !memberMatches || (connections.size > 0 && !connections.has(pair.connection_id))
        : !memberMatches && !(canonicalCable && matchesLine(canonicalCable))) continue;
      highlighted = true;
      points.add(pair.from_connection_point_id);
      points.add(pair.to_connection_point_id);
      overlay.highlightedConnectionMemberIds.add(pair.connection_member_id);
      if (canonicalCable && (!exact || matchesLine(canonicalCable))) {
        overlay.highlightedCableIds.add(canonicalCable.entity_id);
      }
    }
    if (!highlighted) continue;
    overlay.highlightedEdgeIds.add(edge.id);
    // Endpoints are emphasized only because this exact physical projection edge is evidenced.
    overlay.highlightedNodeIds.add(edge.from_node_id);
    overlay.highlightedNodeIds.add(edge.to_node_id);
  }
  for (const node of document.nodes) {
    if (node.source_refs.some(ref => ref.entity_type === 'PhysicalObject' && objects.has(ref.entity_id))) {
      overlay.highlightedNodeIds.add(node.id);
    }
    for (const link of node.attributes.internal_l1_links ?? []) {
      if (members.has(link.connection_member_id)) {
        points.add(link.from_connection_point_id);
        points.add(link.to_connection_point_id);
        overlay.highlightedConnectionMemberIds.add(link.connection_member_id);
        overlay.highlightedNodeIds.add(node.id);
      }
    }
  }
  for (const continuation of document.l1_off_map_continuations ?? []) {
    if (exact ? !matchesLine(continuation.cable_ref)
      : !matchesLine(continuation.cable_ref) && !continuation.source_refs.some(matchesLine)) continue;
    points.add(continuation.local_connection_point_ref.entity_id);
    overlay.highlightedCableIds.add(continuation.cable_ref.entity_id);
    overlay.highlightedNodeIds.add(continuation.local_node_id);
  }
  return overlay;
}
