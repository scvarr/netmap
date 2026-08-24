import type { ProjectionSourceRef } from './types';

export interface CatalogInventoryOccupancy { total_ports: number; connected_ports: number; free_ports: number }
export interface CatalogInventoryMapMembership { map_ref: { entity_type: 'SavedMap'; entity_id: string }; name: string }
export interface CatalogInventoryEquipmentItem { physical_object_ref: ProjectionSourceRef; label: string; label_source?: 'TECHNICAL_FALLBACK'; class?: string; occupancy?: CatalogInventoryOccupancy | null; map_memberships: CatalogInventoryMapMembership[] }
export interface CatalogInventoryCableEndpoint { remote_physical_object_ref: ProjectionSourceRef; remote_physical_object_label: string; remote_connection_point_ref: ProjectionSourceRef; remote_connection_point_label: string; evidence_refs: ProjectionSourceRef[] }
export interface CatalogInventoryCableItem { cable_ref: ProjectionSourceRef; label: string; label_source?: 'TECHNICAL_FALLBACK'; resolution: 'SIMPLE_CABLE' | 'UNRESOLVED'; endpoint_a?: CatalogInventoryCableEndpoint; endpoint_b?: CatalogInventoryCableEndpoint; gaps: string[]; warnings: string[] }
export interface CatalogInventoryDocument { schema_version: '1.0'; equipment: CatalogInventoryEquipmentItem[]; cables: CatalogInventoryCableItem[]; gaps: string[]; warnings: string[] }
export interface CatalogInventoryDataSource { loadCatalogInventory(): Promise<CatalogInventoryDocument> }
