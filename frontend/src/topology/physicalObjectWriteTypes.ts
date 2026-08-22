import type { PhysicalObjectDetailsDocument } from './physicalObjectDetailsTypes';

export interface CreatePhysicalObjectRequest {
  display_name: string;
  initial_connection_point: { display_name: string };
  class?: string;
}

export interface PhysicalObjectWriteDataSource {
  createPhysicalObject(request: CreatePhysicalObjectRequest): Promise<PhysicalObjectDetailsDocument>;
}
