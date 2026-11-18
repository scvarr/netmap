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
  const xs = coordinates([bounds.left, bounds.right, ...inputs.map(i => i.access.x),
    ...obstacles.flatMap(r => [r.left, r.right]).filter(x => x > bounds.left && x < bounds.right)]);
  const ys = coordinates([bounds.top, bounds.bottom, ...inputs.map(i => i.access.y),
    ...obstacles.flatMap(r => [r.top, r.bottom]).filter(y => y > bounds.top && y < bounds.bottom)]);
  const size = xs.length * ys.length;
  const [seed, ...branches] = inputs;
  // Join nearby exits first so a sparse initial branch doesn't pull an entire
  // rack's spine out to a distant boundary.
  const distanceToSeed = ({ access }: typeof seed) =>
    Math.abs(access.x - seed.access.x) + Math.abs(access.y - seed.access.y);
  branches.sort((a, b) => distanceToSeed(a) - distanceToSeed(b));
  if (size > MAX_GRID_POINTS) {
    graph.diagnostics.push(...inputs.map(({ id }) => ({ id, reason: 'search-limit' as const })));
    return graph;
  }

  const width = xs.length;
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

  const links = new Map<number, { vertex: number; axis: number; length: number }[]>();
  const neighbors = (vertex: number) => {
    let adjacent = links.get(vertex);
    if (!adjacent) {
      const column = vertex % width;
      adjacent = [
        column > 0 ? vertex - 1 : -1, column < width - 1 ? vertex + 1 : -1,
        vertex - width, vertex + width,
      ].flatMap((next, direction) => {
        const a = points[vertex], b = points[next];
        return b && clear(a, b) ? [{ vertex: next, axis: direction >> 1, length: Math.abs(a.x - b.x) + Math.abs(a.y - b.y) }] : [];
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
        const nextCost = cost + next.length + (next.axis === (state & 1) ? 0 : BEND_COST);
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
