import type { ProjectionSourceRef } from './types';
import type { CableNamingInput } from './cableLabelTypes';

import type { CableSpecification } from './physicalEndpointConnectionWriteTypes';
import type { PhysicalCompatibilityConfirmation, PhysicalCompatibilityPreview } from './physicalCompatibility';

export interface CreatePhysicalLinkRequest extends CableNamingInput, CableSpecification {
  source_interface_id: string;
  target_interface_id: string;
  compatibility?: PhysicalCompatibilityConfirmation;
}

export interface PhysicalConnectionCreationDocument {
  schema_version: '1.0';
  source_interface_ref: ProjectionSourceRef;
  target_interface_ref: ProjectionSourceRef;
  cable_ref: ProjectionSourceRef;
  source_binding_ref: ProjectionSourceRef;
  target_binding_ref: ProjectionSourceRef;
  connection_ref: ProjectionSourceRef;
}

export interface PhysicalLinkWriteDataSource {
  previewPhysicalLink?(request: CreatePhysicalLinkRequest): Promise<PhysicalCompatibilityPreview>;
  createPhysicalLink(
    request: CreatePhysicalLinkRequest,
  ): Promise<PhysicalConnectionCreationDocument>;
}
