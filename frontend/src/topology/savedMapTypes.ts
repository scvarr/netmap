import type { ProjectionSourceRef } from './types';

export interface SavedMapRef { entity_type: 'SavedMap'; entity_id: string }
export type SavedMapView = 'physical' | 'logical';
export type SavedMapViewKey = 'L1/PHYSICAL_OBJECT' | 'L2/DEVICE';
export interface MapViewPosition { x: number; y: number; locked: boolean; display_width?: number }
export interface MapPlacement { physical_object_ref: ProjectionSourceRef; positions: Partial<Record<SavedMapViewKey, MapViewPosition>> }
export interface MapCableRouteWaypoint { x: number; y: number }
export interface MapCableRoute { cable_ref: ProjectionSourceRef; view: 'L1/PHYSICAL_OBJECT'; waypoints: MapCableRouteWaypoint[] }
export interface MapRegionRef { entity_type: 'MapRegion'; entity_id: string }
export interface MapRegionPoint { x: number; y: number }
export interface MapRegionStyle { fill_color: string; fill_opacity: number; stroke_color: string; stroke_width: number; stroke_style: 'solid' | 'dashed' | 'dotted'; label_color?: string | null }
export interface MapRegion { region_ref: MapRegionRef; label: string; points: MapRegionPoint[]; label_position?: MapRegionPoint | null; style: MapRegionStyle; z_order: number }
export interface MapRegionWrite { label: string; points: MapRegionPoint[]; label_position?: MapRegionPoint | null; style: MapRegionStyle; z_order: number }
export interface SavedMap { map_ref: SavedMapRef; name: string; created_at: string; updated_at: string; placements: MapPlacement[]; cable_routes: MapCableRoute[]; regions: MapRegion[] }
export interface SavedMapSummary { map_ref: SavedMapRef; name: string; created_at: string; updated_at: string }
export interface SavedMapDataSource {
  listMaps(): Promise<SavedMapSummary[]>;
  createMap(name: string): Promise<SavedMap>;
  deleteMap(mapId: string): Promise<void>;
  loadMap(mapId: string): Promise<SavedMap>;
  addPlacement(mapId: string, physicalObjectId: string, x: number, y: number, displayWidth?: number): Promise<void>;
  movePosition(mapId: string, physicalObjectId: string, view: SavedMapView, x: number, y: number, displayWidth?: number): Promise<void>;
  setPositionLock(mapId: string, physicalObjectId: string, view: SavedMapView, locked: boolean): Promise<void>;
  removePlacement(mapId: string, physicalObjectId: string): Promise<void>;
  /** A successful resolution only acknowledges the route write; read SavedMap separately for authoritative state. */
  setCableRoute(mapId: string, cableId: string, waypoints: MapCableRouteWaypoint[]): Promise<void>;
  deleteCableRoute(mapId: string, cableId: string): Promise<void>;
  /** Region writes only acknowledge persistence; reload SavedMap for authoritative state. */
  createRegion(mapId: string, region: MapRegionWrite): Promise<void>;
  replaceRegion(mapId: string, regionId: string, region: MapRegionWrite): Promise<void>;
  deleteRegion(mapId: string, regionId: string): Promise<void>;
}
