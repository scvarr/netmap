import type { FlowRectangle } from './nodeFootprint';
import type { MapCableRouteWaypoint, MapLocationBoundaryAnchor } from './savedMapTypes';

export interface BoundaryFrame { locationId: string; bounds: FlowRectangle }
type Point = Pick<MapCableRouteWaypoint, 'x' | 'y'>;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-7;
const inside = (point: Point, frame: FlowRectangle) => frame.x < point.x && point.x < frame.x + frame.width && frame.y < point.y && point.y < frame.y + frame.height;
const interpolate = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export const resolveBoundaryWaypoint = (waypoint: MapCableRouteWaypoint, frames: readonly BoundaryFrame[]): MapCableRouteWaypoint => {
  const frame = waypoint.anchor && frames.find((item) => item.locationId === waypoint.anchor?.location_id)?.bounds;
  if (!frame) return waypoint;
  const { edge, offset } = waypoint.anchor!;
  return { ...waypoint, x: edge === 'left' ? frame.x : edge === 'right' ? frame.x + frame.width : frame.x + frame.width * offset,
    y: edge === 'top' ? frame.y : edge === 'bottom' ? frame.y + frame.height : frame.y + frame.height * offset };
};

export const projectBoundaryWaypoint = (locationId: string, frame: FlowRectangle, pointer: Point): MapCableRouteWaypoint => {
  const candidates: { edge: MapLocationBoundaryAnchor['edge']; point: Point; offset: number }[] = [
    { edge: 'top', point: { x: Math.max(frame.x, Math.min(frame.x + frame.width, pointer.x)), y: frame.y }, offset: clamp((pointer.x - frame.x) / frame.width) },
    { edge: 'right', point: { x: frame.x + frame.width, y: Math.max(frame.y, Math.min(frame.y + frame.height, pointer.y)) }, offset: clamp((pointer.y - frame.y) / frame.height) },
    { edge: 'bottom', point: { x: Math.max(frame.x, Math.min(frame.x + frame.width, pointer.x)), y: frame.y + frame.height }, offset: clamp((pointer.x - frame.x) / frame.width) },
    { edge: 'left', point: { x: frame.x, y: Math.max(frame.y, Math.min(frame.y + frame.height, pointer.y)) }, offset: clamp((pointer.y - frame.y) / frame.height) },
  ];
  const chosen = candidates.reduce((best, candidate) => Math.hypot(candidate.point.x - pointer.x, candidate.point.y - pointer.y) < Math.hypot(best.point.x - pointer.x, best.point.y - pointer.y) ? candidate : best);
  return { ...chosen.point, anchor: { location_id: locationId, edge: chosen.edge, offset: chosen.offset } };
};

/** Angular candidates are intersections of neighboring segment rays with the frame perimeter. */
export const assistBoundaryWaypoint = (
  locationId: string, frame: FlowRectangle, pointer: Point, neighbors: readonly Point[],
  flowToScreenPosition: (point: Point) => Point,
): MapCableRouteWaypoint => {
  const distance = (point: Point) => Math.hypot(flowToScreenPosition(point).x - flowToScreenPosition(pointer).x, flowToScreenPosition(point).y - flowToScreenPosition(pointer).y);
  for (const [step, capturePx] of [[45, 12], [15, 5]] as const) {
    const candidates: MapCableRouteWaypoint[] = [];
    for (const neighbor of neighbors) for (let angle = 0; angle < 360; angle += step) {
      const radians = angle * Math.PI / 180, dx = Math.cos(radians), dy = Math.sin(radians);
      for (const x of [frame.x, frame.x + frame.width]) {
        if (Math.abs(dx) < 1e-9) continue;
        const t = (x - neighbor.x) / dx, y = neighbor.y + t * dy;
        if (t > 1e-7 && y >= frame.y - 1e-7 && y <= frame.y + frame.height + 1e-7) candidates.push(projectBoundaryWaypoint(locationId, frame, { x, y }));
      }
      for (const y of [frame.y, frame.y + frame.height]) {
        if (Math.abs(dy) < 1e-9) continue;
        const t = (y - neighbor.y) / dy, x = neighbor.x + t * dx;
        if (t > 1e-7 && x >= frame.x - 1e-7 && x <= frame.x + frame.width + 1e-7) candidates.push(projectBoundaryWaypoint(locationId, frame, { x, y }));
      }
    }
    const closest = candidates.sort((left, right) => distance(left) - distance(right))[0];
    if (closest && distance(closest) <= capturePx) return closest;
  }
  return projectBoundaryWaypoint(locationId, frame, pointer);
};

const onBoundary = (point: Point, frame: FlowRectangle) =>
  ((near(point.x, frame.x) || near(point.x, frame.x + frame.width)) && frame.y <= point.y && point.y <= frame.y + frame.height) ||
  ((near(point.y, frame.y) || near(point.y, frame.y + frame.height)) && frame.x <= point.x && point.x <= frame.x + frame.width);

const crossings = (a: Point, b: Point, frame: FlowRectangle): { t: number; point: Point }[] => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const parameters = [frame.x, frame.x + frame.width].flatMap((x) => {
    const t = dx ? (x - a.x) / dx : -1, y = a.y + t * dy;
    return t > 0 && t < 1 && y >= frame.y && y <= frame.y + frame.height ? [t] : [];
  }).concat([frame.y, frame.y + frame.height].flatMap((y) => {
    const t = dy ? (y - a.y) / dy : -1, x = a.x + t * dx;
    return t > 0 && t < 1 && x >= frame.x && x <= frame.x + frame.width ? [t] : [];
  }));
  return parameters.sort((left, right) => left - right).filter((t, index, sorted) => index === 0 || Math.abs(t - sorted[index - 1]) > 1e-9).flatMap((t) => {
    const before = interpolate(a, b, Math.max(0, t - 1e-6));
    const after = interpolate(a, b, Math.min(1, t + 1e-6));
    return inside(before, frame) !== inside(after, frame) ? [{ t, point: interpolate(a, b, t) }] : [];
  });
};

/** Explicit save/group-move normalization; read-only rendering never mutates routes. */
export const normalizeLocationBoundaryAnchors = (
  source: Point, target: Point, waypoints: readonly MapCableRouteWaypoint[], frames: readonly BoundaryFrame[],
): MapCableRouteWaypoint[] => {
  const resolved = waypoints.map((point) => resolveBoundaryWaypoint(point, frames));
  const explicitLocations = new Set(resolved.flatMap((point) => point.anchor ? [point.anchor.location_id] : []));
  const points = [source, ...resolved, target];
  const result: MapCableRouteWaypoint[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index], b = points[index + 1];
    const events = frames.filter((frame) => !explicitLocations.has(frame.locationId)).flatMap((frame) => crossings(a, b, frame.bounds).map((crossing) => ({ ...crossing, frame })));
    for (const event of events.sort((left, right) => left.t - right.t)) result.push(projectBoundaryWaypoint(event.frame.locationId, event.frame.bounds, event.point));
    if (index >= resolved.length) continue;
    const waypoint = resolved[index];
    if (waypoint.anchor) { result.push(waypoint); continue; }
    const following = points[index + 2];
    const frame = frames.find((item) => !explicitLocations.has(item.locationId) && onBoundary(waypoint, item.bounds) && inside(a, item.bounds) !== inside(following, item.bounds) && !onBoundary(a, item.bounds) && !onBoundary(following, item.bounds));
    result.push(frame ? projectBoundaryWaypoint(frame.locationId, frame.bounds, waypoint) : waypoint);
  }
  return result;
};
