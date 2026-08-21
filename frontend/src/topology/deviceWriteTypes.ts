import type { DeviceDetailsDocument } from './deviceDetailsTypes';

export interface CreateNetworkDeviceRequest {
  display_name: string;
  initial_interface: {
    display_name: string;
  };
}

export interface DeviceWriteDataSource {
  createNetworkDevice(request: CreateNetworkDeviceRequest): Promise<DeviceDetailsDocument>;
}
