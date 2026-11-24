export interface CableDeleteDataSource {
  deleteCable(cableId: string): Promise<void>;
  previewBulkDelete?(pair: CableDeletePair): Promise<{ cables: CableDeleteCandidate[] }>;
  bulkDelete?(pair: CableDeletePair, cables: CableDeleteExpectation[]): Promise<void>;
}

export interface CableDeletePair {
  source_object_id: string;
  target_object_id: string;
}

export interface CableDeleteExpectation {
  cable_id: string;
  connection_id: string;
  point_a_id: string;
  point_b_id: string;
  cardinality: number;
  label: string | null;
  members: { id: string; index: number; point_a_member: number; point_b_member: number }[];
}

export interface CableDeleteCandidate {
  expected: CableDeleteExpectation;
  display_label: string;
  source_point_label: string;
  target_point_label: string;
  source_is_point_a: boolean;
  source_member_designations?: string[];
  target_member_designations?: string[];
}
