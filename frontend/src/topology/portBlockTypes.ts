export type PortBlockKind = 'CONNECTION_POINT' | 'NETWORK_PORT';

export interface PortBlockRef { ref_type: 'LIBRARY_RECORD'; entity_type: 'PortBlock'; entity_id: string; }
export interface PortBlockVersionRef { ref_type: 'LIBRARY_RECORD'; entity_type: 'PortBlockVersion'; entity_id: string; }
export interface PortBlockPort { local_id: string; display_label: string; kind: PortBlockKind; row: 1 | 2; column: number; layout_order: number; }
export interface CreatePortBlockRequest { name: string; ports: PortBlockPort[]; }
export interface CreatePortBlockVersionRequest { port_block_name?: string; ports: PortBlockPort[]; }
export interface PortBlockCreationDocument { schema_version: '1.0'; port_block_ref: PortBlockRef; version_ref: PortBlockVersionRef; }
export interface PortBlockListItem { port_block_ref: PortBlockRef; name: string; version_ref: PortBlockVersionRef; version_number: number; port_count: number; version_count: number; }
export interface PortBlockListDocument { schema_version: '1.0'; port_blocks: PortBlockListItem[]; }
export interface PortBlockVersionDocument { schema_version: '1.0'; port_block_ref: PortBlockRef; name: string; version_ref: PortBlockVersionRef; version_number: number; ports: PortBlockPort[]; }
export interface PortBlockVersionSummary { port_block_ref: PortBlockRef; version_ref: PortBlockVersionRef; version_number: number; port_count: number; }
export interface PortBlockVersionListDocument { schema_version: '1.0'; versions: PortBlockVersionSummary[]; }
export interface PortBlockDataSource {
  loadPortBlocks(): Promise<PortBlockListDocument>;
  loadPortBlockVersions(portBlockId: string): Promise<PortBlockVersionListDocument>;
  loadPortBlockVersion(portBlockId: string, versionId: string): Promise<PortBlockVersionDocument>;
  createPortBlock(request: CreatePortBlockRequest): Promise<PortBlockCreationDocument>;
  createPortBlockVersion(portBlockId: string, request: CreatePortBlockVersionRequest): Promise<PortBlockCreationDocument>;
  deletePortBlock?(portBlockId: string): Promise<void>;
}
