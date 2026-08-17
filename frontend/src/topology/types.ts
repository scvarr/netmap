export type TopologyLayer = 'L1' | 'L2' | 'L3';
export type TopologyDetailLevel = 'DEVICE';

export interface ProjectionSourceRef {
  ref_type: string;
  entity_type: string;
  entity_id: string;
}

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
  attributes: Record<string, unknown>;
  status?: string;
}

export interface TopologyProjectionEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  kind: string;
  aggregate: boolean;
  source_refs: ProjectionSourceRef[];
  attributes: Record<string, unknown>;
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
