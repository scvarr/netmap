import type { InterfacePhysicalTraceArtifact, InterfaceTraceEvidenceRef } from './interfacePhysicalTraceTypes';
import type { TopologyProjectionDocument } from './types';

export interface PhysicalTraceOverlay {
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
}

const emptyOverlay = (): PhysicalTraceOverlay => ({ highlightedNodeIds: new Set(), highlightedEdgeIds: new Set() });

const sameEvidence = (left: InterfaceTraceEvidenceRef, right: { entity_type: string; entity_id: string }): boolean => (
  left.entity_type === right.entity_type && left.entity_id === right.entity_id
);

export const physicalTraceOverlayFor = (
  artifact: InterfacePhysicalTraceArtifact | null,
  document: TopologyProjectionDocument | null,
): PhysicalTraceOverlay => {
  const overlay = emptyOverlay();
  if (!artifact || artifact.verdict !== 'REACHABLE' || !document || document.layer !== 'L1') return overlay;

  const traceEdges = new Map(artifact.edges.map((edge) => [edge.id, edge]));
  const traceNodes = new Map(artifact.nodes.map((node) => [node.id, node]));
  const evidence: InterfaceTraceEvidenceRef[] = [];
  for (const branch of artifact.branches) {
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
    if (!edge.source_refs.some((ref) => evidence.some((item) => sameEvidence(item, ref)))) continue;
    overlay.highlightedEdgeIds.add(edge.id);
    // Endpoints are emphasized only because this exact physical projection edge is evidenced.
    overlay.highlightedNodeIds.add(edge.from_node_id);
    overlay.highlightedNodeIds.add(edge.to_node_id);
  }
  for (const node of document.nodes) {
    if (node.source_refs.some((ref) => evidence.some((item) => sameEvidence(item, ref)))) {
      overlay.highlightedNodeIds.add(node.id);
    }
  }
  return overlay;
};
