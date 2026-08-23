export interface InterfacePhysicalTraceQuery {
  from_interface_id: string;
  to_interface_id: string;
}

export interface InterfacePhysicalTraceGap {
  code: 'INTERFACE_PHYSICAL_BINDING_UNKNOWN' | 'INTERFACE_PHYSICAL_REALIZATION_UNKNOWN' | 'L1_TOPOLOGY_INCOMPLETE';
  node_id?: string | null;
}

export interface InterfaceTraceEvidenceRef {
  ref_type?: 'CANONICAL_FACT';
  entity_type: string;
  entity_id: string;
}

export interface InterfacePhysicalTraceBranch {
  branch_id: string;
  source_candidate_id: string;
  target_candidate_id: string;
  edge_ids: string[];
  evidence_refs: InterfaceTraceEvidenceRef[];
}

export interface InterfaceTraceNode {
  id: string;
  canonical_refs: InterfaceTraceEvidenceRef[];
}

export interface InterfaceTraceEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  evidence_refs: InterfaceTraceEvidenceRef[];
}

export interface InterfacePhysicalTraceArtifact {
  schema_version: 1;
  query: InterfacePhysicalTraceQuery;
  resolver_version?: 'interface-physical/2.0';
  verdict: 'REACHABLE' | 'UNKNOWN';
  branches: InterfacePhysicalTraceBranch[];
  nodes: InterfaceTraceNode[];
  edges: InterfaceTraceEdge[];
  gaps: InterfacePhysicalTraceGap[];
  warnings: Record<string, unknown>[];
}

export interface InterfacePhysicalTraceDataSource {
  traceInterfacePhysical(query: InterfacePhysicalTraceQuery): Promise<InterfacePhysicalTraceArtifact>;
}
