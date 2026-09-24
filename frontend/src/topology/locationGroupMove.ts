import type { LocationDocument } from './locationTypes';
import type { LocationGroupMove, MapCableRouteWaypoint, MapPlacement } from './savedMapTypes';
import type { FlowRectangle } from './nodeFootprint';
import { rectanglesOverlap } from './nodeFootprint';

export interface GroupCableGeometry {
  cableId: string;
  sourceObjectId: string;
  targetObjectId: string;
  source: MapCableRouteWaypoint;
  target: MapCableRouteWaypoint;
  savedWaypoints?: readonly MapCableRouteWaypoint[];
}

/** Return the count of internal waypoints before one unambiguous frame exit. */
export const boundaryWaypointPrefix = (frame: FlowRectangle, points: readonly MapCableRouteWaypoint[]): number | null => {
  const right = frame.x + frame.width, bottom = frame.y + frame.height;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-7;
  const inside = (point: MapCableRouteWaypoint) => frame.x < point.x && point.x < right && frame.y < point.y && point.y < bottom;
  const onEdge = (point: MapCableRouteWaypoint) =>
    ((near(point.x, frame.x) || near(point.x, right)) && frame.y <= point.y && point.y <= bottom) ||
    ((near(point.y, frame.y) || near(point.y, bottom)) && frame.x <= point.x && point.x <= right);
  const hits = (a: MapCableRouteWaypoint, b: MapCableRouteWaypoint): number[] | null => {
    if ([frame.x, right].some((x) => near(a.x, x) && near(b.x, x) && Math.max(Math.min(a.y, b.y), frame.y) < Math.min(Math.max(a.y, b.y), bottom)) ||
      [frame.y, bottom].some((y) => near(a.y, y) && near(b.y, y) && Math.max(Math.min(a.x, b.x), frame.x) < Math.min(Math.max(a.x, b.x), right))) return null;
    const dx = b.x - a.x, dy = b.y - a.y;
    const parameters = [frame.x, right].flatMap((x) => {
      const t = dx ? (x - a.x) / dx : -1, y = a.y + t * dy;
      return t >= 0 && t <= 1 && y >= frame.y && y <= bottom ? [t] : [];
    }).concat([frame.y, bottom].flatMap((y) => {
      const t = dy ? (y - a.y) / dy : -1, x = a.x + t * dx;
      return t >= 0 && t <= 1 && x >= frame.x && x <= right ? [t] : [];
    }));
    return parameters.sort((a, b) => a - b).filter((t, index, sorted) => index === 0 || Math.abs(t - sorted[index - 1]) > 1e-9);
  };
  if (points.length < 2 || !inside(points[0]) || onEdge(points[0]) || inside(points[points.length - 1]) || onEdge(points[points.length - 1])) return null;
  const boundaryPoints = points.flatMap((point, index) => onEdge(point) ? [index] : []);
  if (boundaryPoints.length > 1) return null;
  if (boundaryPoints.length === 1) {
    const boundary = boundaryPoints[0];
    if (boundary === 0 || boundary === points.length - 1) return null;
    if (points.slice(0, boundary).some((point) => !inside(point)) || points.slice(boundary + 1).some((point) => inside(point))) return null;
    for (let index = 0; index < points.length - 1; index += 1) {
      const crossings = hits(points[index], points[index + 1]);
      if (!crossings || crossings.length !== (index === boundary - 1 || index === boundary ? 1 : 0) ||
        (index === boundary - 1 && !near(crossings[0], 1)) || (index === boundary && !near(crossings[0], 0))) return null;
    }
    return boundary - 1;
  }
  let prefix: number | null = null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const crossings = hits(points[index], points[index + 1]);
    if (!crossings) return null;
    if (crossings.length) {
      if (crossings.length !== 1 || prefix !== null || !inside(points[index]) || inside(points[index + 1])) return null;
      prefix = index;
    }
  }
  return prefix;
};

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
    const waypoints = sourceMoves ? [...cable.savedWaypoints] : [...cable.savedWaypoints].reverse();
    const moving_endpoint = sourceMoves ? cable.source : cable.target;
    const external_endpoint = sourceMoves ? cable.target : cable.source;
    if (boundaryWaypointPrefix(frame, [moving_endpoint, ...waypoints, external_endpoint]) === null) throw new Error('Маршрут кабеля нельзя однозначно разделить по границе Location.');
    boundary_routes.push({ cable_id: cable.cableId, moving_endpoint_is_source: sourceMoves, moving_endpoint, external_endpoint });
  }
  return { delta_x: delta.x, delta_y: delta.y, frame, footprints, boundary_routes };
}
