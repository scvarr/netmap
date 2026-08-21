import type { DeviceDetailsDocument } from './deviceDetailsTypes';

export interface CreateDeviceInterfaceRequest {
  display_name: string;
}

export interface DeviceInterfaceWriteDataSource {
  createDeviceInterface(
    physicalObjectId: string,
    request: CreateDeviceInterfaceRequest,
  ): Promise<DeviceDetailsDocument>;
}
