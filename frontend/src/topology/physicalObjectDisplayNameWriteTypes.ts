import type { PhysicalObjectDetailsDocument } from './physicalObjectDetailsTypes';

export interface PhysicalObjectDisplayNameWriteDataSource {
  renamePhysicalObject(
    physicalObjectId: string,
    displayName: string,
  ): Promise<PhysicalObjectDetailsDocument>;
}
