import type { FiberType } from "./fiberTypes";
import type { ProjectionSourceRef } from './types';
import type { CableNamingInput } from './cableLabelTypes';
import type { PhysicalCompatibilityConfirmation, PhysicalCompatibilityPreview } from './physicalCompatibility';

export type PhysicalEndpointRequest =
  | { kind: 'NETWORK_INTERFACE'; network_interface_id: string }
  | { kind: 'CONNECTION_POINT'; connection_point_id: string; member_index: number };

export interface CreatePhysicalEndpointConnectionRequest extends CableNamingInput {
  fiber_type?: FiberType | null;
  source: PhysicalEndpointRequest;
  target: PhysicalEndpointRequest;
  compatibility?: PhysicalCompatibilityConfirmation;
}

export interface PhysicalEndpointMaterialization {
  kind: PhysicalEndpointRequest['kind'];
  endpoint_ref: ProjectionSourceRef;
  connection_point_ref: ProjectionSourceRef;
  interface_binding_ref?: ProjectionSourceRef;
  member_index: number;
}

export interface PhysicalEndpointConnectionCreationDocument {
  schema_version: '1.0';
  source: PhysicalEndpointMaterialization;
  target: PhysicalEndpointMaterialization;
  cable_ref: ProjectionSourceRef;
  connection_ref: ProjectionSourceRef;
}

export interface CreateBulkPhysicalConnectionsRequest {
  pairs: { source: Extract<PhysicalEndpointRequest, { kind: 'CONNECTION_POINT' }>; target: Extract<PhysicalEndpointRequest, { kind: 'CONNECTION_POINT' }>; fiber_type?: FiberType | null }[];
  template_id: string | null;
  expected_generated_labels: string[];
  compatibility?: PhysicalCompatibilityConfirmation;
}

export interface BulkPhysicalConnectionItem {
  source_connection_point_id: string;
  target_connection_point_id: string;
  source_member_index: number;
  target_member_index: number;
  connection_id: string;
  cable_id: string;
}

export interface PhysicalEndpointConnectionWriteDataSource {
  previewPhysicalEndpointConnection?(request: CreatePhysicalEndpointConnectionRequest): Promise<PhysicalCompatibilityPreview>;
  previewBulkPhysicalConnections?(request: CreateBulkPhysicalConnectionsRequest): Promise<PhysicalCompatibilityPreview>;
  createPhysicalEndpointConnection(
    request: CreatePhysicalEndpointConnectionRequest,
  ): Promise<PhysicalEndpointConnectionCreationDocument>;
  deleteExternalPhysicalConnection?(connectionId: string): Promise<void>;
  previewBulkCableLabels?(templateId: string, count: number): Promise<{ labels: string[] }>;
  createBulkPhysicalConnections?(request: CreateBulkPhysicalConnectionsRequest): Promise<{ created: BulkPhysicalConnectionItem[] }>;
}
