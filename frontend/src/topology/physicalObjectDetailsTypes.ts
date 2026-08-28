import type { ProjectionSourceRef } from './types';
import type { LibraryRef, BlueprintSlotKind } from './objectBlueprintTypes';

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
  ordering_key?: string;
  blueprint_slot?: { slot_key: string; kind: BlueprintSlotKind };
  direct_interface_bindings?: Array<{ interface_ref: ProjectionSourceRef; label: string; label_source?: 'TECHNICAL_FALLBACK'; evidence_refs: ProjectionSourceRef[] }>;
  internal_physical_counterparts?: Array<{ connection_point_ref: ProjectionSourceRef; label: string; label_source?: 'TECHNICAL_FALLBACK'; connection_ref: ProjectionSourceRef; evidence_refs: ProjectionSourceRef[] }>;
  external_physical_attachments?: Array<{ kind: 'DIRECT_CONNECTION' | 'CABLE'; connection_ref: ProjectionSourceRef; evidence_refs: ProjectionSourceRef[]; remote_physical_object_ref?: ProjectionSourceRef; remote_physical_object_label?: string; remote_connection_point_ref?: ProjectionSourceRef; remote_connection_point_label?: string; cable_ref?: ProjectionSourceRef; cable_label?: string }>;
  source_refs: ProjectionSourceRef[];
}

export interface PhysicalObjectDetailsDocument {
  schema_version: '1.0';
  physical_object: PhysicalObjectDetails;
  blueprint_provenance?: { blueprint_ref: LibraryRef; version_ref: LibraryRef; version_number: number };
  connection_points: ConnectionPointDetails[];
  owned_interface_count: number;
  gaps: string[];
  warnings: string[];
}

export interface PhysicalObjectDetailsDataSource {
  loadPhysicalObjectDetails(physicalObjectId: string): Promise<PhysicalObjectDetailsDocument>;
}
