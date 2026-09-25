import type { ProjectionSourceRef } from './types';
import type { LocationRef } from './locationTypes';

export interface SavedMapRef { entity_type: 'SavedMap'; entity_id: string }
export interface MapPresentationVariantRef { entity_type: 'MapPresentationVariant'; entity_id: string }
export interface MapPresentationVariant { variant_ref: MapPresentationVariantRef; name: string }
export type SavedMapView = 'physical' | 'logical';
export type SavedMapViewKey = 'L1/PHYSICAL_OBJECT' | 'L2/DEVICE';
export interface MapViewPosition { x: number; y: number; locked: boolean; display_width?: number }
/** `location_ref` is derived/live canonical context for this scene, not MapPlacement state. */
export interface MapPlacement { physical_object_ref: ProjectionSourceRef; location_ref?: LocationRef | null; positions: Partial<Record<SavedMapViewKey, MapViewPosition>> }
export interface MapLocationBoundaryAnchor { location_id: string; edge: 'top' | 'right' | 'bottom' | 'left'; offset: number }
export interface MapCableRouteWaypoint { x: number; y: number; anchor?: MapLocationBoundaryAnchor }
export interface MapCableRoute { cable_ref: ProjectionSourceRef; view: 'L1/PHYSICAL_OBJECT'; waypoints: MapCableRouteWaypoint[] }
export interface LocationGroupMove {
  delta_x: number; delta_y: number;
  frame: { x: number; y: number; width: number; height: number };
  footprints: Array<{ physical_object_id: string; x: number; y: number; width: number; height: number }>;
  boundary_routes: Array<{ cable_id: string; moving_endpoint_is_source: boolean; moving_endpoint: MapPresentationPoint; external_endpoint: MapPresentationPoint }>;
}
export interface MapPresentationPoint { x: number; y: number }
export interface MapTextAnnotationRef { entity_type: 'MapTextAnnotation'; entity_id: string }
export interface MapTextAnnotation { annotation_ref: MapTextAnnotationRef; text: string; position: MapPresentationPoint; text_color: string; font_size: number }
export interface MapTextAnnotationWrite { text: string; position: MapPresentationPoint; text_color: string; font_size: number }
export interface MapLocationDirectElementRef { entity_type: 'PhysicalObject' | 'Location'; entity_id: string }
export interface MapLocationState { location_ref: LocationRef; collapsed: boolean; visible_direct_elements: MapLocationDirectElementRef[] }
export interface MapLocationDirectElementChoice { ref: MapLocationDirectElementRef; label: string }
export interface SavedMap { map_ref: SavedMapRef; name: string; created_at: string; updated_at: string; active_variant_ref: MapPresentationVariantRef; variants: MapPresentationVariant[]; location_states?: MapLocationState[]; placements: MapPlacement[]; cable_routes: MapCableRoute[]; text_annotations: MapTextAnnotation[] }
export interface SavedMapSummary { map_ref: SavedMapRef; name: string; created_at: string; updated_at: string }
export interface SavedMapDataSource {
  listMaps(): Promise<SavedMapSummary[]>;
  createMap(name: string): Promise<SavedMap>;
  deleteMap(mapId: string): Promise<void>;
  loadMap(mapId: string, variantId?: string): Promise<SavedMap>;
  /** Acknowledges variant creation; load SavedMap separately for authoritative state. */
  createPresentationVariant?(mapId: string, name: string, sourceVariantId: string): Promise<MapPresentationVariant>;
  deletePresentationVariant?(mapId: string, variantId: string): Promise<void>;
  setLocationState?(mapId: string, variantId: string, locationId: string, state: Pick<MapLocationState, 'collapsed' | 'visible_direct_elements'>): Promise<void>;
  moveLocationGroup?(mapId: string, variantId: string, locationId: string, move: LocationGroupMove): Promise<void>;
  loadLocationDirectElements?(mapId: string, variantId: string, locationId: string): Promise<MapLocationDirectElementChoice[]>;
  addPlacement(mapId: string, physicalObjectId: string, x: number, y: number, displayWidth?: number, variantId?: string): Promise<void>;
  movePosition(mapId: string, physicalObjectId: string, view: SavedMapView, x: number, y: number, displayWidth?: number, variantId?: string): Promise<void>;
  setPositionLock(mapId: string, physicalObjectId: string, view: SavedMapView, locked: boolean, variantId?: string): Promise<void>;
  removePlacement(mapId: string, physicalObjectId: string): Promise<void>;
  /** A successful resolution only acknowledges the route write; read SavedMap separately for authoritative state. */
  setCableRoute(mapId: string, cableId: string, waypoints: MapCableRouteWaypoint[], variantId?: string): Promise<void>;
  deleteCableRoute(mapId: string, cableId: string, variantId?: string): Promise<void>;
  /** Text annotation writes only acknowledge persistence; reload SavedMap for authoritative state. */
  createTextAnnotation(mapId: string, annotation: MapTextAnnotationWrite): Promise<void>;
  replaceTextAnnotation(mapId: string, annotationId: string, annotation: MapTextAnnotationWrite): Promise<void>;
  deleteTextAnnotation(mapId: string, annotationId: string): Promise<void>;
}
