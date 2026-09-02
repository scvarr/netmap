import type { ProjectionSourceRef } from './types';
import type { LocationRef } from './locationTypes';

export interface SavedMapRef { entity_type: 'SavedMap'; entity_id: string }
export interface MapPresentationVariantRef { entity_type: 'MapPresentationVariant'; entity_id: string }
export interface MapPresentationVariant { variant_ref: MapPresentationVariantRef; name: string }
export interface MapComposite { composite_ref: { entity_type: 'MapComposite'; entity_id: string }; name: string; physical_object_refs: ProjectionSourceRef[]; presentation: { variant_ref: MapPresentationVariantRef; collapsed: boolean; x: number; y: number; width: number; height: number } }
export type SavedMapView = 'physical' | 'logical';
export type SavedMapViewKey = 'L1/PHYSICAL_OBJECT' | 'L2/DEVICE';
export interface MapViewPosition { x: number; y: number; locked: boolean; display_width?: number }
/** `location_ref` is derived/live canonical context for this scene, not MapPlacement state. */
export interface MapPlacement { physical_object_ref: ProjectionSourceRef; location_ref?: LocationRef | null; positions: Partial<Record<SavedMapViewKey, MapViewPosition>> }
export interface MapCableRouteWaypoint { x: number; y: number }
export interface MapCableRoute { cable_ref: ProjectionSourceRef; view: 'L1/PHYSICAL_OBJECT'; waypoints: MapCableRouteWaypoint[] }
export interface MapRegionRef { entity_type: 'MapRegion'; entity_id: string }
export interface MapRegionPoint { x: number; y: number }
export interface MapRegionStyle { fill_color: string; fill_opacity: number; stroke_color: string; stroke_width: number; stroke_style: 'solid' | 'dashed' | 'dotted'; label_color?: string | null }
export interface MapRegion { region_ref: MapRegionRef; location_ref?: LocationRef | null; label: string; points: MapRegionPoint[]; label_position?: MapRegionPoint | null; style: MapRegionStyle; z_order: number }
export interface MapRegionWrite { label: string; points: MapRegionPoint[]; label_position?: MapRegionPoint | null; style: MapRegionStyle; z_order: number; location_id?: string | null }
export interface MapTextAnnotationRef { entity_type: 'MapTextAnnotation'; entity_id: string }
export interface MapTextAnnotation { annotation_ref: MapTextAnnotationRef; text: string; position: MapRegionPoint; text_color: string; font_size: number }
export interface MapTextAnnotationWrite { text: string; position: MapRegionPoint; text_color: string; font_size: number }
export interface SavedMap { map_ref: SavedMapRef; name: string; created_at: string; updated_at: string; active_variant_ref: MapPresentationVariantRef; variants: MapPresentationVariant[]; placements: MapPlacement[]; cable_routes: MapCableRoute[]; composites: MapComposite[]; regions: MapRegion[]; text_annotations: MapTextAnnotation[] }
export interface SavedMapSummary { map_ref: SavedMapRef; name: string; created_at: string; updated_at: string }
export interface SavedMapDataSource {
  listMaps(): Promise<SavedMapSummary[]>;
  createMap(name: string): Promise<SavedMap>;
  deleteMap(mapId: string): Promise<void>;
  loadMap(mapId: string, variantId?: string): Promise<SavedMap>;
  /** Acknowledges variant creation; load SavedMap separately for authoritative state. */
  createPresentationVariant?(mapId: string, name: string, sourceVariantId: string): Promise<MapPresentationVariant>;
  deletePresentationVariant?(mapId: string, variantId: string): Promise<void>;
  /** Acknowledges composite creation; load SavedMap separately for authoritative state. */
  createComposite?(mapId: string, name: string, physicalObjectIds: string[], variantId?: string): Promise<MapComposite>;
  /** Acknowledges composite deletion; load SavedMap separately for authoritative state. */
  deleteComposite?(mapId: string, compositeId: string): Promise<void>;
  addPlacement(mapId: string, physicalObjectId: string, x: number, y: number, displayWidth?: number, variantId?: string): Promise<void>;
  movePosition(mapId: string, physicalObjectId: string, view: SavedMapView, x: number, y: number, displayWidth?: number, variantId?: string): Promise<void>;
  setPositionLock(mapId: string, physicalObjectId: string, view: SavedMapView, locked: boolean, variantId?: string): Promise<void>;
  removePlacement(mapId: string, physicalObjectId: string): Promise<void>;
  /** A successful resolution only acknowledges the route write; read SavedMap separately for authoritative state. */
  setCableRoute(mapId: string, cableId: string, waypoints: MapCableRouteWaypoint[], variantId?: string): Promise<void>;
  deleteCableRoute(mapId: string, cableId: string, variantId?: string): Promise<void>;
  /** Region writes only acknowledge persistence; reload SavedMap for authoritative state. */
  createRegion(mapId: string, region: MapRegionWrite): Promise<void>;
  replaceRegion(mapId: string, regionId: string, region: MapRegionWrite): Promise<void>;
  deleteRegion(mapId: string, regionId: string): Promise<void>;
  /** Text annotation writes only acknowledge persistence; reload SavedMap for authoritative state. */
  createTextAnnotation(mapId: string, annotation: MapTextAnnotationWrite): Promise<void>;
  replaceTextAnnotation(mapId: string, annotationId: string, annotation: MapTextAnnotationWrite): Promise<void>;
  deleteTextAnnotation(mapId: string, annotationId: string): Promise<void>;
}
