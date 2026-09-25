import type { MapCableRouteWaypoint } from './savedMapTypes';
import { segmentLength } from './geometryAssist';

/** Exact editor action in map coordinates; the opposite segment endpoint stays fixed. */
export function waypointAtSegmentLength(
  fixed: MapCableRouteWaypoint,
  selected: MapCableRouteWaypoint,
  rawLength: string,
): MapCableRouteWaypoint | null {
  const numericText = rawLength.trim();
  if (!/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(numericText)) return null;
  const length = Number(numericText);
  if (!Number.isFinite(length) || length <= 0 || selected.anchor) return null;
  const currentLength = segmentLength(fixed, selected);
  if (!Number.isFinite(currentLength) || currentLength <= 0) return null;
  const x = fixed.x + (selected.x - fixed.x) / currentLength * length;
  const y = fixed.y + (selected.y - fixed.y) / currentLength * length;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
