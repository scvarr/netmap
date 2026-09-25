import type { LocationDocument } from './locationTypes';
import type { LocationGroupMove, MapCableRouteWaypoint, MapPlacement, MapPresentationPoint } from './savedMapTypes';
import type { FlowRectangle } from './nodeFootprint';
import { rectanglesOverlap } from './nodeFootprint';

export interface GroupCableGeometry {
  cableId: string;
  sourceObjectId: string;
  targetObjectId: string;
  source: MapPresentationPoint;
  target: MapPresentationPoint;
  savedWaypoints?: readonly MapCableRouteWaypoint[];
}

export function prepareLocationGroupMove(
  locationId: string, delta: MapCableRouteWaypoint, frame: FlowRectangle,
  locations: readonly LocationDocument[], placements: readonly MapPlacement[],
  rectangles: ReadonlyMap<string, FlowRectangle>, cables: readonly GroupCableGeometry[],
): LocationGroupMove {
  const subtree = new Set([locationId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const location of locations) {
      const id = location.location_ref.entity_id;
      if (!subtree.has(id) && location.parent_location_ref && subtree.has(location.parent_location_ref.entity_id)) {
        subtree.add(id); changed = true;
      }
    }
  }
  const positioned = placements.filter((item) => Boolean(item.positions['L1/PHYSICAL_OBJECT']));
  const canonicalMembers = new Set(placements.filter((item) => item.location_ref && subtree.has(item.location_ref.entity_id)).map((item) => item.physical_object_ref.entity_id));
  const moving = new Set(positioned.filter((item) => canonicalMembers.has(item.physical_object_ref.entity_id)).map((item) => item.physical_object_ref.entity_id));
  if (!moving.size) throw new Error('У Location нет размещённых объектов в этой компоновке.');
  if (positioned.some((item) => moving.has(item.physical_object_ref.entity_id) && item.positions['L1/PHYSICAL_OBJECT']?.locked)) throw new Error('В Location есть объект с зафиксированным положением.');
  const footprints = positioned.map((item) => {
    const id = item.physical_object_ref.entity_id, position = item.positions['L1/PHYSICAL_OBJECT']!;
    const rectangle = rectangles.get(id);
    if (!rectangle) throw new Error('Геометрия объекта недоступна.');
    return { physical_object_id: id, x: position.x, y: position.y, width: rectangle.width, height: rectangle.height };
  });
  for (const item of footprints.filter((entry) => moving.has(entry.physical_object_id))) {
    const shifted = { ...item, x: item.x + delta.x, y: item.y + delta.y };
    if (footprints.some((other) => !moving.has(other.physical_object_id) && rectanglesOverlap(shifted, other))) throw new Error('Перемещение Location пересекает внешний объект.');
  }
  const boundary_routes: LocationGroupMove['boundary_routes'] = [];
  for (const cable of cables) {
    if (!cable.savedWaypoints || canonicalMembers.has(cable.sourceObjectId) === canonicalMembers.has(cable.targetObjectId)) continue;
    const sourceMoves = canonicalMembers.has(cable.sourceObjectId);
    const moving = sourceMoves ? cable.source : cable.target;
    const external = sourceMoves ? cable.target : cable.source;
    const moving_endpoint: MapPresentationPoint = { x: moving.x, y: moving.y };
    const external_endpoint: MapPresentationPoint = { x: external.x, y: external.y };
    boundary_routes.push({ cable_id: cable.cableId, moving_endpoint_is_source: sourceMoves, moving_endpoint, external_endpoint });
  }
  return { delta_x: delta.x, delta_y: delta.y, frame, footprints, boundary_routes };
}
