export interface PhysicalObjectL1TraceQuery {
  from_physical_object_id: string;
  to_physical_object_id: string;
}

export interface PhysicalTraceEvidenceRef {
  ref_type?: 'CANONICAL_FACT';
  entity_type: string;
  entity_id: string;
}

export interface PhysicalObjectL1TraceBranch {
  branch_id: string;
  source: { point_id: string; member_index: number };
  target: { point_id: string; member_index: number };
  edge_ids: string[];
  evidence_refs: PhysicalTraceEvidenceRef[];
}

export interface PhysicalObjectL1TraceCycle {
  cycle_id: string;
  state_node_ids: string[];
  edge_ids: string[];
  evidence_refs: PhysicalTraceEvidenceRef[];
}

export interface PhysicalTraceNode { id: string; canonical_refs: PhysicalTraceEvidenceRef[]; }
export interface PhysicalTraceEdge { id: string; from_node_id: string; to_node_id: string; evidence_refs: PhysicalTraceEvidenceRef[]; }

export interface PhysicalObjectL1TraceArtifact {
  schema_version: 1;
  query: PhysicalObjectL1TraceQuery;
  resolver_version?: 'physical-object-l1/1.0';
  verdict: 'REACHABLE' | 'UNKNOWN';
  source_candidates: { point_id: string; member_index: number }[];
  target_candidates: { point_id: string; member_index: number }[];
  branches: PhysicalObjectL1TraceBranch[];
  cycles: PhysicalObjectL1TraceCycle[];
  nodes: PhysicalTraceNode[];
  edges: PhysicalTraceEdge[];
  evidence_refs: PhysicalTraceEvidenceRef[];
  gaps: { code: 'L1_TOPOLOGY_INCOMPLETE'; node_id?: string | null; evidence_refs: PhysicalTraceEvidenceRef[] }[];
  warnings: Record<string, unknown>[];
}

export interface PhysicalObjectL1TraceDataSource {
  tracePhysicalObjectsL1(query: PhysicalObjectL1TraceQuery): Promise<PhysicalObjectL1TraceArtifact>;
}
