import type { PhysicalObjectL1TraceArtifact, PhysicalTraceEvidenceRef } from './physicalObjectL1TraceTypes';
import type { ExactMemberTrace } from './exactMemberTrace';
import type { ProjectionSourceRef, TopologyProjectionDocument } from './types';
import { readOpticalPaths, type OpticalFact } from './opticalDiagnostic';
import { memberAddressKey } from './exactMemberTrace';

export type OpticalHighlight = 'LOCAL' | 'END_TO_END' | 'UNKNOWN';
export const opticalHighlightColors: Record<OpticalHighlight, string> = {
  LOCAL: '#ff3b48', END_TO_END: '#b46b72', UNKNOWN: '#9da8b0',
};

export interface PhysicalTraceOverlay {
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
  highlightedConnectionMemberIds: Set<string>;
  highlightedConnectionPointIds: Set<string>;
  faceConnectionPointIds?: Set<string>;
  /** Exact canonical Cable identities evidenced by the selected branch. */
  highlightedCableIds: Set<string>;
  opticalCableHighlights?: Map<string, OpticalHighlight>;
  opticalMemberHighlights?: Map<string, OpticalHighlight>;
  opticalLocalPointIds?: Set<string>;
}

const emptyOverlay = (): PhysicalTraceOverlay => ({ highlightedNodeIds: new Set(), highlightedEdgeIds: new Set(), highlightedConnectionMemberIds: new Set(), highlightedConnectionPointIds: new Set(), highlightedCableIds: new Set() });

export const physicalTraceOverlayFor = (
  artifact: PhysicalObjectL1TraceArtifact | null,
  document: TopologyProjectionDocument | null,
  selectedBranchId: string | null,
): PhysicalTraceOverlay => {
  const overlay = emptyOverlay();
  if (!artifact || !document || document.layer !== 'L1') return overlay;

  const traceEdges = new Map(artifact.edges.map((edge) => [edge.id, edge]));
  const traceNodes = new Map(artifact.nodes.map((node) => [node.id, node]));
  const evidence: PhysicalTraceEvidenceRef[] = [];
  const branch = artifact.verdict === 'REACHABLE' ? artifact.branches.find(item => item.branch_id === selectedBranchId) : undefined;
  const cycle = artifact.cycles.find(item => item.cycle_id === selectedBranchId);
  const selected = branch ?? cycle;
  if (!selected) return overlay;
  evidence.push(...selected.evidence_refs);
  const points = overlay.highlightedConnectionPointIds;
  if (branch?.source) points.add(branch.source.point_id);
  if (branch?.target) points.add(branch.target.point_id);
  const selectedEdges = [];
  for (const edgeId of selected.edge_ids) {
    const edge = traceEdges.get(edgeId);
    if (!edge) continue;
    selectedEdges.push(edge);
    evidence.push(...edge.evidence_refs);
    for (const nodeId of [edge.from_node_id, edge.to_node_id]) {
      const refs = traceNodes.get(nodeId)?.canonical_refs ?? [];
      for (const ref of refs) if (ref.entity_type === 'ConnectionPoint') points.add(ref.entity_id);
    }
  }
  projectOpticalEvidence(document, overlay, [selected.optical_diagnostic], selectedEdges);
  return projectTraceEvidence(document, overlay, evidence);
};

export function exactTraceOverlayFor(trace: Pick<ExactMemberTrace, 'edges' | 'optical_diagnostics'> | null, document: TopologyProjectionDocument | null): PhysicalTraceOverlay {
  const overlay = emptyOverlay();
  if (!trace || document?.layer !== 'L1') return overlay;
  const points = new Set<string>();
  for (const edge of trace.edges) {
    for (const ref of edge.evidence_refs) if (ref.entity_type === 'ConnectionPoint') points.add(ref.entity_id);
  }
  overlay.faceConnectionPointIds = points;
  projectOpticalEvidence(document, overlay, trace.optical_diagnostics, trace.edges);
  return projectTraceEvidence(document, overlay, trace.edges.flatMap(edge => edge.evidence_refs), true);
}

function projectOpticalEvidence(
  document: TopologyProjectionDocument,
  overlay: PhysicalTraceOverlay,
  value: unknown,
  edges: ExactMemberTrace['edges'],
) {
  const diagnostics = readOpticalPaths(value).flatMap(item => item ? [item] : []);
  if (!diagnostics.length) return;
  const traceEdges = new Map(edges.map(edge => [edge.id, edge]));
  const singleMemberPoints = new Set(document.nodes.flatMap(node => [
    ...(node.attributes.connection_points ?? []),
    ...(node.attributes.blueprint_presentation?.slots ?? []),
  ]).filter(point => point.cardinality === 1).map(point => point.connection_point_id));
  const cableHighlights = new Map<string, OpticalHighlight>();
  const memberHighlights = new Map<string, OpticalHighlight>();
  const localPoints = new Set<string>();
  const priority = { END_TO_END: 1, UNKNOWN: 2, LOCAL: 3 };
  const assign = (map: Map<string, OpticalHighlight>, id: string, kind: OpticalHighlight) => {
    const prior = map.get(id);
    if (!prior || priority[kind] > priority[prior]) map.set(id, kind);
  };
  const mark = (fact: OpticalFact, kind: OpticalHighlight) => {
    const edge = fact.trace_edge_id && traceEdges.get(fact.trace_edge_id);
    if (!edge) return;
    for (const ref of fact.canonical_refs) {
      if (!edge.evidence_refs.some(item => item.entity_type === ref.entity_type && item.entity_id === ref.entity_id)) continue;
      if (ref.entity_type === 'Cable') assign(cableHighlights, ref.entity_id, kind);
      if (ref.entity_type === 'ConnectionMember') assign(memberHighlights, ref.entity_id, kind);
    }
  };
  for (const diagnostic of diagnostics) {
    const { facts, conflicts } = diagnostic;
    for (const fact of facts) {
      if (fact.value === null || fact.unknown_reason || fact.model_error) mark(fact, 'UNKNOWN');
    }
    for (const { kind, left_fact: left, right_fact: right } of conflicts) {
      const ordered = left < right ? facts.slice(left, right + 1) : [...facts.slice(left), ...facts.slice(0, right + 1)];
      if (kind === 'END_TO_END') {
        for (const fact of ordered) mark(fact, kind);
        continue;
      }
      for (let index = 1; index < ordered.length; index++) {
        const a = ordered[index - 1].points.at(-1);
        const b = ordered[index].points[0];
        if (a && b && memberAddressKey(a) === memberAddressKey(b) && a.member_index === 1
          && singleMemberPoints.has(a.point_id)) localPoints.add(a.point_id);
      }
      // Only the transparent transition itself can receive LOCAL line styling.
      for (const fact of ordered.slice(1, -1)) if (fact.value === 'NO_FIBER') mark(fact, kind);
    }
  }
  overlay.opticalCableHighlights = cableHighlights;
  overlay.opticalMemberHighlights = memberHighlights;
  overlay.opticalLocalPointIds = localPoints;
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
