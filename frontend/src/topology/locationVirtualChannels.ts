import type { XYPosition } from '@xyflow/react';
import { locationBoundaryPoint } from './locationFrameGeometry';
import type { FlowRectangle } from './nodeFootprint';
import type { MapLocationGeometry } from './savedMapTypes';

type Edge = MapLocationGeometry['edge'];
type Box = { left: number; top: number; right: number; bottom: number };

export interface LocationChannelBoundary {
  id: string;
  geometry: MapLocationGeometry;
}

export interface LocationChannelMember {
  id: string;
  bounds: FlowRectangle;
  point: XYPosition;
  edge: Edge;
}

export interface LocationChannelGraph {
  root: number | null;
  nodes: XYPosition[];
  segments: { from: number; to: number }[];
  terminals: Map<string, number>;
  diagnostics: { id: string; reason: 'blocked-access' | 'no-corridor' | 'search-limit' }[];
}

export const LOCATION_CHANNEL_CLEARANCE = 4;
const CLEARANCE = LOCATION_CHANNEL_CLEARANCE;
const BEND_COST = 8;
const OFF_CENTER_COST = 4;
const MAX_MEMBERS = 512;
const MAX_GRID_POINTS = 32_768;
const MAX_SEARCH_STEPS = 300_000;

const normal = {
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 },
};
const box = (r: FlowRectangle, pad: number): Box => ({
  left: r.x - pad, top: r.y - pad,
  right: r.x + r.width + pad, bottom: r.y + r.height + pad,
});
const inside = (p: XYPosition, b: Box) =>
  p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
const crossesInterior = (a: XYPosition, b: XYPosition, r: Box) =>
  a.x === b.x
    ? a.x > r.left && a.x < r.right && Math.min(a.y, b.y) < r.bottom && Math.max(a.y, b.y) > r.top
    : a.y > r.top && a.y < r.bottom && Math.min(a.x, b.x) < r.right && Math.max(a.x, b.x) > r.left;
const same = (a: XYPosition, b: XYPosition) => a.x === b.x && a.y === b.y;
const coordinates = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

interface Corridor {
  low: number;
  high: number;
  center: number;
}

/** Each slab has the same obstacle projection throughout its length. Merge
 * those projections to find gaps between facing sides (or the frame margin).
 * The symmetric clearance inset preserves the midpoint of the original gap. */
function corridorSlabs(obstacles: readonly Box[], bounds: Box, vertical: boolean) {
  const project = (r: Box) => vertical
    ? { start: r.top, end: r.bottom, low: r.left, high: r.right }
    : { start: r.left, end: r.right, low: r.top, high: r.bottom };
  const limits = project(bounds);
  const walls = obstacles.map(project).filter(r => r.high > limits.low && r.low < limits.high)
    .sort((a, b) => a.low - b.low);
  const breaks = coordinates([limits.start, limits.end, ...walls.flatMap(r => [r.start, r.end])
    .filter(p => p > limits.start && p < limits.end)]);
  return breaks.slice(0, -1).map((start, index) => {
    const end = breaks[index + 1];
    const gaps: Corridor[] = [];
    let low = limits.low;
    let occupied = false;
    for (const wall of walls) {
      if (wall.start >= end || wall.end <= start) continue;
      occupied = true;
      if (low < wall.low) gaps.push({ low, high: wall.low, center: (low + wall.low) / 2 });
      low = Math.max(low, wall.high);
    }
    if (occupied && low < limits.high) gaps.push({ low, high: limits.high, center: (low + limits.high) / 2 });
    return { start, end, gaps };
  });
}

/** Grid intervals subdivide, but never straddle, the slab boundaries. */
function corridorIntervals(grid: readonly number[], slabs: ReturnType<typeof corridorSlabs>) {
  let slab = 0;
  return grid.slice(0, -1).map(start => {
    while (slabs[slab].end <= start) slab++;
    return slabs[slab].gaps;
  });
}

function addCorridorAxes(
  xs: Set<number>, ys: Set<number>,
  horizontal: ReturnType<typeof corridorSlabs>, vertical: ReturnType<typeof corridorSlabs>,
) {
  const rank = (slabs: ReturnType<typeof corridorSlabs>, vertical: boolean) => {
    const spanByCenter = new Map<number, number>();
    for (const { start, end, gaps } of slabs) for (const { center } of gaps) {
      spanByCenter.set(center, (spanByCenter.get(center) ?? 0) + end - start);
    }
    return [...spanByCenter].map(([center, span]) => ({ center, span, vertical }));
  };
  const axes = [...rank(vertical, true), ...rank(horizontal, false)]
    .sort((a, b) => b.span - a.span || a.center - b.center);
  // Keep every obstacle and terminal coordinate. If the grid cannot fit all
  // optional axes, prefer those covering the longest aggregate corridor.
  for (const axis of axes) {
    const across = axis.vertical ? xs : ys;
    const along = axis.vertical ? ys : xs;
    if ((across.size + 1) * along.size <= MAX_GRID_POINTS) across.add(axis.center);
  }
}

type SearchEntry = { state: number; cost: number };
const before = (a: SearchEntry, b: SearchEntry) => a.cost < b.cost || (a.cost === b.cost && a.state < b.state);

class SearchQueue {
  private items: SearchEntry[] = [];

  push(entry: SearchEntry) {
    const items = this.items;
    let position = items.length;
    items.push(entry);
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (!before(entry, items[parent])) break;
      items[position] = items[parent];
      position = parent;
    }
    items[position] = entry;
  }

  pop(): SearchEntry | undefined {
    const items = this.items;
    const first = items[0];
    const last = items.pop();
    if (!last || !items.length) return first;
    let position = 0;
    while (2 * position + 1 < items.length) {
      let child = 2 * position + 1;
      if (child + 1 < items.length && before(items[child + 1], items[child])) child++;
      if (!before(items[child], last)) break;
      items[position] = items[child];
      position = child;
    }
    items[position] = last;
    return first;
  }
}

/** Grow a local rectilinear tree on a compressed visibility grid. Grid links
 * end at every candidate junction. Each branch stops at its first tree vertex,
 * so links are shared explicitly and the result stays acyclic. */
export function buildLocationChannelGraph(
  boundary: LocationChannelBoundary | null,
  members: readonly LocationChannelMember[],
): LocationChannelGraph {
  const graph: LocationChannelGraph = { root: null, nodes: [], segments: [], terminals: new Map(), diagnostics: [] };
  const addNode = (point: XYPosition) => graph.nodes.push(point) - 1;
  const addTerminal = (id: string, point: XYPosition) => {
    const node = addNode(point);
    graph.terminals.set(id, node);
    return node;
  };
  const ownPoint = boundary && locationBoundaryPoint(boundary.geometry, boundary.geometry);
  if (boundary && ownPoint) graph.root = addTerminal(boundary.id, ownPoint);
  if (!members.length) return graph;

  const ordered = [...members].sort((a, b) =>
    b.point.x - a.point.x || a.point.y - b.point.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const terminals = ordered.map(member => addTerminal(member.id, member.point));
  if (members.length > MAX_MEMBERS) {
    graph.diagnostics = ordered.map(({ id }) => ({ id, reason: 'search-limit' }));
    return graph;
  }
  const obstacles = ordered.map(({ bounds }) => box(bounds, CLEARANCE));
  const bounds = boundary ? box(boundary.geometry, -CLEARANCE) : {
    left: Math.min(...obstacles.map(r => r.left)) - CLEARANCE,
    top: Math.min(...obstacles.map(r => r.top)) - CLEARANCE,
    right: Math.max(...obstacles.map(r => r.right)) + CLEARANCE,
    bottom: Math.max(...obstacles.map(r => r.bottom)) + CLEARANCE,
  };
  const clear = (a: XYPosition, b: XYPosition, except = -1) =>
    !obstacles.some((r, index) => index !== except && crossesInterior(a, b, r));

  const inputs = ordered.flatMap(({ id, point, edge }, index) => {
    const direction = normal[edge];
    const access = { x: point.x + CLEARANCE * direction.x, y: point.y + CLEARANCE * direction.y };
    if (!inside(access, bounds) || (boundary && !inside(point, box(boundary.geometry, 0))) || !clear(point, access, index)) {
      graph.diagnostics.push({ id, reason: 'blocked-access' });
      return [];
    }
    return [{ id, access, lead: [] as XYPosition[], node: terminals[index], axis: direction.x ? 0 : 1 }];
  });
  if (!inputs.length) return graph;
  if (boundary && ownPoint) {
    const { x, y } = normal[boundary.geometry.edge];
    const middle = { x: ownPoint.x - x * CLEARANCE / 2, y: ownPoint.y - y * CLEARANCE / 2 };
    const access = {
      x: Math.max(bounds.left, Math.min(bounds.right, ownPoint.x - x * CLEARANCE)),
      y: Math.max(bounds.top, Math.min(bounds.bottom, ownPoint.y - y * CLEARANCE)),
    };
    const corner = { x: x ? middle.x : access.x, y: y ? middle.y : access.y };
    const lead = [ownPoint, middle, corner, access];
    if (!inside(access, bounds) || lead.slice(1).some((point, index) => !clear(lead[index], point))) {
      graph.diagnostics.push({ id: boundary.id, reason: 'blocked-access' });
      graph.diagnostics.push(...inputs.map(({ id }) => ({ id, reason: 'no-corridor' as const })));
      return graph;
    }
    inputs.unshift({
      id: boundary.id, access, lead: same(middle, corner) ? [] : [middle, corner], node: graph.root!, axis: x ? 0 : 1,
    });
  }
  const xCoordinates = new Set([bounds.left, bounds.right, ...inputs.map(i => i.access.x),
    ...obstacles.flatMap(r => [r.left, r.right]).filter(x => x > bounds.left && x < bounds.right)]);
  const yCoordinates = new Set([bounds.top, bounds.bottom, ...inputs.map(i => i.access.y),
    ...obstacles.flatMap(r => [r.top, r.bottom]).filter(y => y > bounds.top && y < bounds.bottom)]);
  const [seed, ...branches] = inputs;
  // Join nearby exits first so a sparse initial branch doesn't pull an entire
  // rack's spine out to a distant boundary.
  const distanceToSeed = ({ access }: typeof seed) =>
    Math.abs(access.x - seed.access.x) + Math.abs(access.y - seed.access.y);
  branches.sort((a, b) => distanceToSeed(a) - distanceToSeed(b));
  if (xCoordinates.size * yCoordinates.size > MAX_GRID_POINTS) {
    graph.diagnostics.push(...inputs.map(({ id }) => ({ id, reason: 'search-limit' as const })));
    return graph;
  }

  const horizontal = corridorSlabs(obstacles, bounds, false);
  const vertical = corridorSlabs(obstacles, bounds, true);
  addCorridorAxes(xCoordinates, yCoordinates, horizontal, vertical);
  const xs = [...xCoordinates].sort((a, b) => a - b);
  const ys = [...yCoordinates].sort((a, b) => a - b);
  const size = xs.length * ys.length;
  const width = xs.length;
  const horizontalGaps = corridorIntervals(xs, horizontal);
  const verticalGaps = corridorIntervals(ys, vertical);
  const indexOf = (p: XYPosition) => ys.indexOf(p.y) * width + xs.indexOf(p.x);
  const points = Array.from({ length: size }, (_, i) => ({ x: xs[i % width], y: ys[Math.floor(i / width)] }));
  const tree = new Map<number, number>();
  const treeNode = (vertex: number) => {
    let node = tree.get(vertex);
    if (node === undefined) {
      node = addNode(points[vertex]);
      tree.set(vertex, node);
    }
    return node;
  };
  const connectLead = (input: typeof seed, vertex: number) => {
    let from = input.node;
    for (const point of input.lead) {
      const to = addNode(point);
      graph.segments.push({ from, to });
      from = to;
    }
    graph.segments.push({ from, to: treeNode(vertex) });
  };
  connectLead(seed, indexOf(seed.access));
  graph.root ??= seed.node;

  const links = new Map<number, { vertex: number; axis: number; cost: number }[]>();
  const neighbors = (vertex: number) => {
    let adjacent = links.get(vertex);
    if (!adjacent) {
      const column = vertex % width;
      adjacent = [
        column > 0 ? vertex - 1 : -1, column < width - 1 ? vertex + 1 : -1,
        vertex - width, vertex + width,
      ].flatMap((next, direction) => {
        const a = points[vertex], b = points[next];
        if (!b || !clear(a, b)) return [];
        const axis = direction >> 1;
        const gaps = axis ? verticalGaps[Math.floor(Math.min(vertex, next) / width)] : horizontalGaps[Math.min(vertex, next) % width];
        const cross = axis ? a.x : a.y;
        const crossCoordinates = axis ? xCoordinates : yCoordinates;
        const offCenter = gaps.some(gap =>
          cross >= gap.low && cross <= gap.high && cross !== gap.center && crossCoordinates.has(gap.center));
        const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        return [{ vertex: next, axis, cost: length * (offCenter ? OFF_CENTER_COST : 1) }];
      });
      links.set(vertex, adjacent);
    }
    return adjacent;
  };

  let steps = 0;
  for (const input of branches) {
    const start = indexOf(input.access);
    const startState = 2 * start + input.axis;
    const queue = new SearchQueue();
    const distance = new Map([[startState, 0]]);
    const previous = new Map<number, number>();
    queue.push({ state: startState, cost: 0 });
    let target: number | undefined;
    while (steps < MAX_SEARCH_STEPS) {
      const entry = queue.pop();
      if (!entry) break;
      steps++;
      const { state, cost } = entry;
      if (distance.get(state) !== cost) continue;
      const vertex = state >> 1;
      if (tree.has(vertex)) {
        target = state;
        break;
      }
      for (const next of neighbors(vertex)) {
        const nextState = 2 * next.vertex + next.axis;
        const nextCost = cost + next.cost + (next.axis === (state & 1) ? 0 : BEND_COST);
        if (nextCost >= (distance.get(nextState) ?? Infinity)) continue;
        distance.set(nextState, nextCost);
        previous.set(nextState, state);
        queue.push({ state: nextState, cost: nextCost });
      }
    }
    if (target === undefined) {
      graph.diagnostics.push({ id: input.id, reason: steps >= MAX_SEARCH_STEPS ? 'search-limit' : 'no-corridor' });
      continue;
    }
    for (let state = target; state !== startState;) {
      const prior = previous.get(state)!;
      graph.segments.push({ from: treeNode(prior >> 1), to: treeNode(state >> 1) });
      state = prior;
    }
    connectLead(input, start);
  }
  return graph;
}
