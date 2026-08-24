import type { ProjectionSourceRef } from './types';

export interface SavedMapRef { entity_type: 'SavedMap'; entity_id: string }
export type SavedMapView = 'physical' | 'logical';
export type SavedMapViewKey = 'L1/PHYSICAL_OBJECT' | 'L2/DEVICE';
export interface MapViewPosition { x: number; y: number }
export interface MapPlacement { physical_object_ref: ProjectionSourceRef; positions: Partial<Record<SavedMapViewKey, MapViewPosition>> }
export interface SavedMap { map_ref: SavedMapRef; name: string; created_at: string; updated_at: string; placements: MapPlacement[] }
export interface SavedMapSummary { map_ref: SavedMapRef; name: string; created_at: string; updated_at: string }
export interface SavedMapDataSource {
  listMaps(): Promise<SavedMapSummary[]>;
  createMap(name: string): Promise<SavedMap>;
  loadMap(mapId: string): Promise<SavedMap>;
  addPlacement(mapId: string, physicalObjectId: string, x: number, y: number): Promise<void>;
  movePosition(mapId: string, physicalObjectId: string, view: SavedMapView, x: number, y: number): Promise<void>;
  removePlacement(mapId: string, physicalObjectId: string): Promise<void>;
}
