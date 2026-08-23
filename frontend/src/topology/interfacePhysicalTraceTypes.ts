export interface InterfacePhysicalTraceQuery {
  from_interface_id: string;
  to_interface_id: string;
}

export interface InterfacePhysicalTraceGap {
  code: 'INTERFACE_PHYSICAL_BINDING_UNKNOWN' | 'INTERFACE_PHYSICAL_REALIZATION_UNKNOWN' | 'L1_TOPOLOGY_INCOMPLETE';
  node_id?: string | null;
}

export interface InterfacePhysicalTraceArtifact {
  schema_version: 1;
  query: InterfacePhysicalTraceQuery;
  resolver_version?: 'interface-physical/2.0';
  verdict: 'REACHABLE' | 'UNKNOWN';
  branches: Array<{ branch_id: string }>;
  gaps: InterfacePhysicalTraceGap[];
  warnings: Record<string, unknown>[];
}

export interface InterfacePhysicalTraceDataSource {
  traceInterfacePhysical(query: InterfacePhysicalTraceQuery): Promise<InterfacePhysicalTraceArtifact>;
}
