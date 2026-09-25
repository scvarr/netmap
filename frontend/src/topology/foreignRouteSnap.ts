import type { MapCableRouteWaypoint } from './savedMapTypes';
import type { BoundaryFrame } from './locationBoundaryAnchors';
import { projectBoundaryWaypoint } from './locationBoundaryAnchors';

type Point = { x: number; y: number };
export type ForeignRouteGeometry = { waypoints: readonly MapCableRouteWaypoint[]; segments: readonly (readonly [Point, Point])[] };
export type ForeignRouteSnap = { kind: 'waypoint' | 'segment'; point: MapCableRouteWaypoint; segment?: readonly [Point, Point] };
export const FOREIGN_SEGMENT_CAPTURE_PX = 8;
export const FOREIGN_WAYPOINT_RADIUS_FLOW = 1;
export const FOREIGN_WAYPOINT_STROKE_FLOW = 0.5;
export const FOREIGN_BOUNDARY_HALF_SIDE_FLOW = 0.7;
export const FOREIGN_BOUNDARY_STROKE_FLOW = 0.5;
const BOUNDARY_WAYPOINT_PROJECTION_LIMIT_PX = 8;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const projection = (point: Point, a: Point, b: Point): Point => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t };
};

/** Only the transient rendered geometry is consulted; no foreign identity enters the result. */
export function findForeignRouteSnap(
  pointerScreen: Point,
  geometry: readonly ForeignRouteGeometry[],
  flowToScreen: (point: Point) => Point,
  screenToFlow: (point: Point) => Point,
  boundary?: BoundaryFrame,
): ForeignRouteSnap | null {
  const boundarySegments: [Point, Point][] = boundary ? [
    [{ x: boundary.bounds.x, y: boundary.bounds.y }, { x: boundary.bounds.x + boundary.bounds.width, y: boundary.bounds.y }],
    [{ x: boundary.bounds.x + boundary.bounds.width, y: boundary.bounds.y }, { x: boundary.bounds.x + boundary.bounds.width, y: boundary.bounds.y + boundary.bounds.height }],
    [{ x: boundary.bounds.x + boundary.bounds.width, y: boundary.bounds.y + boundary.bounds.height }, { x: boundary.bounds.x, y: boundary.bounds.y + boundary.bounds.height }],
    [{ x: boundary.bounds.x, y: boundary.bounds.y + boundary.bounds.height }, { x: boundary.bounds.x, y: boundary.bounds.y }],
  ] : [];
  const onBoundary = (point: Point) => boundarySegments.some(([a, b]) => distance(point, projection(point, a, b)) < 1e-6);
  const asWaypoint = (point: Point) => boundary
    ? projectBoundaryWaypoint(boundary.locationId, boundary.bounds, point)
    : { x: point.x, y: point.y };
  const candidates: { snap: ForeignRouteSnap; distance: number }[] = [];
  for (const route of geometry) for (const waypoint of route.waypoints) {
    const markerScreen = flowToScreen(waypoint);
    const zoom = distance(markerScreen, flowToScreen({ x: waypoint.x + 1, y: waypoint.y }));
    const dx = Math.abs(pointerScreen.x - markerScreen.x), dy = Math.abs(pointerScreen.y - markerScreen.y);
    const insideMarker = waypoint.anchor
      ? dx + dy <= (FOREIGN_BOUNDARY_HALF_SIDE_FLOW + FOREIGN_BOUNDARY_STROKE_FLOW / 2) * Math.SQRT2 * zoom
      : Math.hypot(dx, dy) <= (FOREIGN_WAYPOINT_RADIUS_FLOW + FOREIGN_WAYPOINT_STROKE_FLOW / 2) * zoom;
    if (!insideMarker) continue;
    const point = asWaypoint(waypoint);
    if (boundary && distance(markerScreen, flowToScreen(point)) > BOUNDARY_WAYPOINT_PROJECTION_LIMIT_PX) continue;
    candidates.push({ snap: { kind: 'waypoint', point }, distance: distance(pointerScreen, markerScreen) });
  }
  if (candidates.length) return candidates.sort((a, b) => a.distance - b.distance)[0].snap;

  for (const route of geometry) for (const segment of route.segments) {
    const [a, b] = segment;
    const points: Point[] = [];
    if (!boundary) {
      points.push(screenToFlow(projection(pointerScreen, flowToScreen(a), flowToScreen(b))));
    } else {
      for (const [c, d] of boundarySegments) {
        const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
        if (Math.abs(denominator) < 1e-9) {
          const candidate = projection(screenToFlow(pointerScreen), a, b);
          const boundaryPoint = projection(candidate, c, d);
          if (distance(candidate, boundaryPoint) < 1e-6) points.push(boundaryPoint);
          continue;
        }
        const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
        const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) points.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      }
    }
    for (const raw of points) {
      const point = boundary ? asWaypoint(raw) : raw;
      if (boundary && !onBoundary(raw)) continue;
      const screenDistance = distance(pointerScreen, flowToScreen(point));
      if (screenDistance <= FOREIGN_SEGMENT_CAPTURE_PX) candidates.push({ snap: { kind: 'segment', point, segment }, distance: screenDistance });
    }
  }
  return candidates.length ? candidates.sort((a, b) => a.distance - b.distance)[0].snap : null;
}
