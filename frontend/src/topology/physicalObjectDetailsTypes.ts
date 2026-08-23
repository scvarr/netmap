import type { ProjectionSourceRef } from './types';

export interface PhysicalObjectDetails {
  source_ref: ProjectionSourceRef;
  label: string;
  label_source?: 'TECHNICAL_FALLBACK';
  class?: string;
}

export interface ConnectionPointDetails {
  connection_point_ref: ProjectionSourceRef;
  label: string;
  label_source?: 'TECHNICAL_FALLBACK';
  cardinality: number;
  incident_connection_count: number;
  external_connection_count?: number;
  direct_interface_binding_count: number;
  source_refs: ProjectionSourceRef[];
}

export interface PhysicalObjectDetailsDocument {
  schema_version: '1.0';
  physical_object: PhysicalObjectDetails;
  connection_points: ConnectionPointDetails[];
  owned_interface_count: number;
  gaps: string[];
  warnings: string[];
}

export interface PhysicalObjectDetailsDataSource {
  loadPhysicalObjectDetails(physicalObjectId: string): Promise<PhysicalObjectDetailsDocument>;
}
