import type { BlueprintPortBlockPlacement } from '../topology/objectBlueprintTypes';
import type { BlueprintBlockInstance } from './editorModel';

export interface CompositionCanvas { width: number; height: number; }
export interface ScreenRect { left: number; top: number; width: number; height: number; }
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export interface AlignmentGuide { axis: 'x' | 'y'; position: number; }

const MIN_SIZE = .08;
const INITIAL_MIN_SIZE = .12;
const SNAP_DISTANCE = .018;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const bounded = (placement: BlueprintPortBlockPlacement): BlueprintPortBlockPlacement => {
  const width = clamp(placement.width, MIN_SIZE, 1);
  const height = clamp(placement.height, MIN_SIZE, 1);
  return { x: clamp(placement.x, 0, 1 - width), y: clamp(placement.y, 0, 1 - height), width, height };
};
const overlaps = (first: BlueprintPortBlockPlacement, second: BlueprintPortBlockPlacement) => first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
const equalPlacement = (first: BlueprintPortBlockPlacement, second: BlueprintPortBlockPlacement) => first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;
const axisPositions = (size: number) => [...new Set([...Array(Math.floor((1 - size) / .02) + 1)].map((_, index) => Number((index * .02).toFixed(3))).concat(Number((1 - size).toFixed(3))))];
const freePlacement = (width: number, height: number, occupied: BlueprintPortBlockPlacement[], preferred?: BlueprintPortBlockPlacement) => {
  const available: BlueprintPortBlockPlacement[] = [];
  for (const y of axisPositions(height)) for (const x of axisPositions(width)) {
    const placement = { x, y, width, height };
    if (!occupied.some((item) => overlaps(placement, item))) available.push(placement);
  }
  if (!available.length) return undefined;
  if (preferred) available.sort((a, b) => Math.hypot(a.x - preferred.x, a.y - preferred.y) - Math.hypot(b.x - preferred.x, b.y - preferred.y));
  return available[0];
};

/** A compact initial block that follows the version's declared port grid. */
export const initialPlacementForPorts = (ports: Array<{ row: number; column: number }>, occupied: BlueprintPortBlockPlacement[]): BlueprintPortBlockPlacement | undefined => {
  const columns = Math.max(...ports.map((port) => port.column), 1);
  const rows = Math.max(...ports.map((port) => port.row), 1);
  const width = clamp(.10 + columns * .10, .18, .48);
  const height = clamp(.10 + rows * .12, .18, .62);
  for (const scale of [1, .85, .7, .55, .4]) {
    const placement = freePlacement(Math.max(INITIAL_MIN_SIZE, width * scale), Math.max(INITIAL_MIN_SIZE, height * scale), occupied);
    if (placement) return placement;
  }
  return undefined;
};

export const resizePlacement = (start: BlueprintPortBlockPlacement, handle: ResizeHandle, dx: number, dy: number): BlueprintPortBlockPlacement => {
  const left = handle.includes('w') ? start.x + dx : start.x;
  const top = handle.includes('n') ? start.y + dy : start.y;
  const right = handle.includes('e') ? start.x + start.width + dx : start.x + start.width;
  const bottom = handle.includes('s') ? start.y + start.height + dy : start.y + start.height;
  const x = handle.includes('w') ? Math.min(left, right - MIN_SIZE) : left;
  const y = handle.includes('n') ? Math.min(top, bottom - MIN_SIZE) : top;
  return bounded({ x, y, width: Math.max(MIN_SIZE, right - x), height: Math.max(MIN_SIZE, bottom - y) });
};

const snapped = (placement: BlueprintPortBlockPlacement, occupied: BlueprintPortBlockPlacement[]) => {
  let next = { ...placement }; const guides: AlignmentGuide[] = [];
  const xTargets = [0, 1, ...occupied.flatMap((item) => [item.x, item.x + item.width])];
  const yTargets = [0, 1, ...occupied.flatMap((item) => [item.y, item.y + item.height])];
  const snapAxis = (axis: 'x' | 'y', size: 'width' | 'height', targets: number[]) => {
    const edges = [next[axis], next[axis] + next[size]];
    let closest: { delta: number; target: number } | undefined;
    for (const edge of edges) for (const target of targets) if (Math.abs(edge - target) <= SNAP_DISTANCE && (!closest || Math.abs(edge - target) < Math.abs(closest.delta))) closest = { delta: target - edge, target };
    if (closest) { next = { ...next, [axis]: next[axis] + closest.delta }; guides.push({ axis, position: closest.target }); }
  };
  snapAxis('x', 'width', xTargets); snapAxis('y', 'height', yTargets);
  return { placement: bounded(next), guides };
};

/** Keeps a gesture inside the panel and outside its face peers; returns snap guides in normalized panel coordinates. */
export const resolvePlacement = (requested: BlueprintPortBlockPlacement, previous: BlueprintPortBlockPlacement, occupied: BlueprintPortBlockPlacement[], mode: 'drag' | 'resize') => {
  const result = snapped(bounded(requested), occupied);
  if (!occupied.some((item) => overlaps(result.placement, item))) return result;
  const previousOverlaps = occupied.some((item) => overlaps(previous, item));
  if (mode === 'resize' && !previousOverlaps) return { placement: previous, guides: [] as AlignmentGuide[] };
  const candidates: BlueprintPortBlockPlacement[] = [];
  for (const item of occupied) {
    candidates.push(bounded({ ...result.placement, x: item.x - result.placement.width }));
    candidates.push(bounded({ ...result.placement, x: item.x + item.width }));
    candidates.push(bounded({ ...result.placement, y: item.y - result.placement.height }));
    candidates.push(bounded({ ...result.placement, y: item.y + item.height }));
  }
  const available = candidates.filter((candidate) => !occupied.some((item) => overlaps(candidate, item)));
  const escaped = freePlacement(result.placement.width, result.placement.height, occupied, result.placement);
  if (escaped) available.push(escaped);
  if (!available.length) return { placement: previous, guides: [] as AlignmentGuide[] };
  available.sort((a, b) => Math.hypot(a.x - requested.x, a.y - requested.y) - Math.hypot(b.x - requested.x, b.y - requested.y));
  const placement = available[0];
  return { placement, guides: equalPlacement(placement, result.placement) ? result.guides : [] as AlignmentGuide[] };
};

export const compositionCanvas = (body: { width: number; height: number }): CompositionCanvas => ({ width: 1000, height: 1000 * body.height / body.width });
export const placementRect = (placement: BlueprintPortBlockPlacement, canvas: CompositionCanvas) => ({ x: placement.x * canvas.width, y: placement.y * canvas.height, width: placement.width * canvas.width, height: placement.height * canvas.height });
export const portCenter = (item: BlueprintBlockInstance, localId: string, placement: BlueprintPortBlockPlacement, canvas: CompositionCanvas) => {
  const port = item.ports.find((value) => value.local_id === localId); if (!port) return undefined;
  const columns = Math.max(...item.ports.filter((value) => value.row === port.row).map((value) => value.column), 1);
  const rows = Math.max(...item.ports.map((value) => value.row), 1); const rect = placementRect(placement, canvas);
  return { x: rect.x + rect.width * (port.column - .5) / columns, y: rect.y + rect.height * (port.row - .5) / rows };
};
/** Converts screen coordinates through preserveAspectRatio's centred meet viewport. */
export const screenToPlacementPoint = (clientX: number, clientY: number, rect: ScreenRect, canvas: CompositionCanvas) => {
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const renderedWidth = canvas.width * scale; const renderedHeight = canvas.height * scale;
  const left = rect.left + (rect.width - renderedWidth) / 2; const top = rect.top + (rect.height - renderedHeight) / 2;
  return { x: (clientX - left) / renderedWidth, y: (clientY - top) / renderedHeight };
};
