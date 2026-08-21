import type { ProjectionSourceRef } from './types';

export interface CreatePhysicalLinkRequest {
  source_interface_id: string;
  target_interface_id: string;
  cable_display_name?: string;
}

export interface PhysicalConnectionCreationDocument {
  schema_version: '1.0';
  source_interface_ref: ProjectionSourceRef;
  target_interface_ref: ProjectionSourceRef;
  cable_ref: ProjectionSourceRef;
  source_binding_ref: ProjectionSourceRef;
  target_binding_ref: ProjectionSourceRef;
  connection_refs: ProjectionSourceRef[];
}

export interface PhysicalLinkWriteDataSource {
  createPhysicalLink(
    request: CreatePhysicalLinkRequest,
  ): Promise<PhysicalConnectionCreationDocument>;
}
