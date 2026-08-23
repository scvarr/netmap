export interface PhysicalObjectDeleteDataSource {
  deletePhysicalObject(physicalObjectId: string): Promise<void>;
}
