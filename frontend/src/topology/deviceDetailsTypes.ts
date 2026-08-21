import type { ProjectionSourceRef } from './types';

export interface InterfaceAddressDetails {
  address: string;
  prefix_length: number;
  source_refs: ProjectionSourceRef[];
}

export interface InterfacePhysicalBindingDetails {
  connection_point_ref: ProjectionSourceRef;
  member_index: number;
  source_refs: ProjectionSourceRef[];
}

export interface DeviceInterfaceDetails {
  interface_ref: ProjectionSourceRef;
  label: string;
  label_source?: 'TECHNICAL_FALLBACK';
  addresses: InterfaceAddressDetails[];
  l2_binding_count: number;
  l3_binding_count: number;
  direct_physical_bindings: InterfacePhysicalBindingDetails[];
  realization_down_count: number;
  realization_up_count: number;
  source_refs: ProjectionSourceRef[];
}

export interface DeviceDetails {
  source_ref: ProjectionSourceRef;
  label: string;
  label_source?: 'TECHNICAL_FALLBACK';
}

export interface DeviceDetailsDocument {
  schema_version: '1.0';
  device: DeviceDetails;
  interfaces: DeviceInterfaceDetails[];
  gaps: string[];
  warnings: string[];
}

export interface DeviceDetailsDataSource {
  loadDeviceDetails(physicalObjectId: string): Promise<DeviceDetailsDocument>;
}
