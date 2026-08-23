export type TopologyLayer = 'L1' | 'L2' | 'L3';
export type TopologyDetailLevel = 'DEVICE' | 'PHYSICAL_OBJECT';

export interface ProjectionSourceRef {
  ref_type: string;
  entity_type: string;
  entity_id: string;
}
export interface BlueprintPresentation {
  blueprint_ref: { ref_type: 'LIBRARY_RECORD'; entity_type: 'ObjectBlueprint'; entity_id: string };
  version_ref: { ref_type: 'LIBRARY_RECORD'; entity_type: 'ObjectBlueprintVersion'; entity_id: string };
  body: { kind: 'RECTANGLE'; width: number; height: number; fill_color?: string | null };
  slots: Array<{ slot_key: string; display_name: string; kind: 'CONNECTION_POINT' | 'NETWORK_PORT'; anchor: { side: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM'; offset: number }; connection_point_id: string; network_interface_id?: string | null }>;
}
export interface PhysicalEndpointPair { from_connection_point_id: string; from_member_index: number; to_connection_point_id: string; to_member_index: number; connection_id: string; connection_member_id: string; }
export interface ConnectionPointPresentation { connection_point_id: string; display_name: string; cardinality: number; external_connection_count: number; }

export interface TopologyProjectionScope {
  include_location_subtrees: ProjectionSourceRef[];
  include_entities: ProjectionSourceRef[];
}

export interface TopologyProjectionRequest {
  layer: TopologyLayer;
  detail_level: TopologyDetailLevel;
  scope: TopologyProjectionScope;
  grouping?: Record<string, unknown>;
  filters?: Record<string, unknown>;
}

export interface TopologyProjectionNode {
  id: string;
  kind: string;
  label: string;
  source_refs: ProjectionSourceRef[];
  attributes: Record<string, unknown> & { blueprint_presentation?: BlueprintPresentation; connection_points?: ConnectionPointPresentation[] };
  status?: string;
}

export interface TopologyProjectionEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  kind: string;
  aggregate: boolean;
  source_refs: ProjectionSourceRef[];
  attributes: Record<string, unknown> & { endpoint_pairs?: PhysicalEndpointPair[] };
  status?: string;
}

export interface TopologyProjectionDocument {
  schema_version: '1.0';
  layer: TopologyLayer;
  detail_level: TopologyDetailLevel;
  nodes: TopologyProjectionNode[];
  edges: TopologyProjectionEdge[];
  gaps: string[];
  warnings: string[];
}

export interface TopologyDataSource {
  loadProjection(request: TopologyProjectionRequest): Promise<TopologyProjectionDocument>;
}

export type TopologySelection =
  | { type: 'node'; item: TopologyProjectionNode }
  | { type: 'edge'; item: TopologyProjectionEdge }
  | null;
