import type { ProjectionSourceRef } from './types';

export interface SavedMapRef { entity_type: 'SavedMap'; entity_id: string }
export interface MapPlacement { physical_object_ref: ProjectionSourceRef; x: number; y: number }
export interface SavedMap { map_ref: SavedMapRef; name: string; created_at: string; updated_at: string; placements: MapPlacement[] }
export interface SavedMapSummary { map_ref: SavedMapRef; name: string; created_at: string; updated_at: string }
export interface SavedMapDataSource {
  listMaps(): Promise<SavedMapSummary[]>;
  createMap(name: string): Promise<SavedMap>;
  loadMap(mapId: string): Promise<SavedMap>;
  addPlacement(mapId: string, physicalObjectId: string, x: number, y: number): Promise<void>;
  movePlacement(mapId: string, physicalObjectId: string, x: number, y: number): Promise<void>;
  removePlacement(mapId: string, physicalObjectId: string): Promise<void>;
}
