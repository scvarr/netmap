export interface CableDeleteDataSource {
  deleteCable(cableId: string): Promise<void>;
}
