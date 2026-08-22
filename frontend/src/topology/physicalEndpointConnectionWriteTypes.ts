import type { ProjectionSourceRef } from './types';

export type PhysicalEndpointRequest =
  | { kind: 'NETWORK_INTERFACE'; network_interface_id: string }
  | { kind: 'CONNECTION_POINT'; connection_point_id: string; member_index: 1 };

export interface CreatePhysicalEndpointConnectionRequest {
  source: PhysicalEndpointRequest;
  target: PhysicalEndpointRequest;
  cable_display_name?: string;
}

export interface PhysicalEndpointMaterialization {
  kind: PhysicalEndpointRequest['kind'];
  endpoint_ref: ProjectionSourceRef;
  connection_point_ref: ProjectionSourceRef;
  interface_binding_ref?: ProjectionSourceRef;
  member_index: 1;
}

export interface PhysicalEndpointConnectionCreationDocument {
  schema_version: '1.0';
  source: PhysicalEndpointMaterialization;
  target: PhysicalEndpointMaterialization;
  cable_ref: ProjectionSourceRef;
  connection_refs: ProjectionSourceRef[];
}

export interface PhysicalEndpointConnectionWriteDataSource {
  createPhysicalEndpointConnection(
    request: CreatePhysicalEndpointConnectionRequest,
  ): Promise<PhysicalEndpointConnectionCreationDocument>;
}
