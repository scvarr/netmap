import type { PhysicalObjectDetailsDocument } from './physicalObjectDetailsTypes';

export interface PhysicalObjectClassWriteDataSource {
  setPhysicalObjectClass(
    physicalObjectId: string,
    value: string,
  ): Promise<PhysicalObjectDetailsDocument>;
}
