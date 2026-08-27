import type { BlueprintPortBlockPlacement } from '../topology/objectBlueprintTypes';
import type { BlueprintBlockInstance } from './editorModel';

export interface CompositionCanvas { width: number; height: number; }
export interface ScreenRect { left: number; top: number; width: number; height: number; }
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export interface AlignmentGuide { axis: 'x' | 'y'; position: number; }

const MIN_SIZE = .08;
const SNAP_DISTANCE = .018;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const bounded = (placement: BlueprintPortBlockPlacement): BlueprintPortBlockPlacement => {
  const width = clamp(placement.width, MIN_SIZE, 1);
  const height = clamp(placement.height, MIN_SIZE, 1);
  return { x: clamp(placement.x, 0, 1 - width), y: clamp(placement.y, 0, 1 - height), width, height };
};
const overlaps = (first: BlueprintPortBlockPlacement, second: BlueprintPortBlockPlacement) => first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
const equalPlacement = (first: BlueprintPortBlockPlacement, second: BlueprintPortBlockPlacement) => first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;

/** A compact initial block that follows the version's declared port grid. */
export const initialPlacementForPorts = (ports: Array<{ row: number; column: number }>, occupied: BlueprintPortBlockPlacement[]) => {
  const columns = Math.max(...ports.map((port) => port.column), 1);
  const rows = Math.max(...ports.map((port) => port.row), 1);
  const width = clamp(.10 + columns * .10, .18, .48);
  const height = clamp(.10 + rows * .12, .18, .62);
  const step = .02;
  for (let y = 0; y <= 1 - height + .0001; y += step) for (let x = 0; x <= 1 - width + .0001; x += step) {
    const placement = { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)), width, height };
    if (!occupied.some((item) => overlaps(placement, item))) return placement;
  }
  return { x: 0, y: 0, width, height };
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
  if (mode === 'resize') return { placement: previous, guides: [] as AlignmentGuide[] };
  const candidates: BlueprintPortBlockPlacement[] = [];
  for (const item of occupied) {
    candidates.push(bounded({ ...result.placement, x: item.x - result.placement.width }));
    candidates.push(bounded({ ...result.placement, x: item.x + item.width }));
    candidates.push(bounded({ ...result.placement, y: item.y - result.placement.height }));
    candidates.push(bounded({ ...result.placement, y: item.y + item.height }));
  }
  const available = candidates.filter((candidate) => !occupied.some((item) => overlaps(candidate, item)));
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
