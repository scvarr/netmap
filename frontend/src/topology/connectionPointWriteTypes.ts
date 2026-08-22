import type { PhysicalObjectDetailsDocument } from './physicalObjectDetailsTypes';

export interface CreateConnectionPointRequest {
  display_name: string;
}

export interface ConnectionPointWriteDataSource {
  createConnectionPoint(
    physicalObjectId: string,
    request: CreateConnectionPointRequest,
  ): Promise<PhysicalObjectDetailsDocument>;
}
