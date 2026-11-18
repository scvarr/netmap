import { describe, expect, it } from 'vitest';
import { buildLocationChannelGraph, LOCATION_CHANNEL_CLEARANCE, type LocationChannelGraph, type LocationChannelMember } from './locationVirtualChannels';

const member = (id: string, x: number, y: number, width = 100, height = 20): LocationChannelMember => ({
  id, bounds: { x, y, width, height }, point: { x: x + width, y: y + height / 2 }, edge: 'right',
});
const boundary = { id: 'boundary:rack', geometry: { x: 0, y: 0, width: 180, height: 180, edge: 'right' as const, offset: 0.5 } };

function expectTree(graph: LocationChannelGraph) {
  const seen = new Set(graph.root === null ? [] : [graph.root]);
  const pending = [...seen];
  const neighbors = new Map<number, number[]>();
  for (const { from, to } of graph.segments) {
    const a = graph.nodes[from], b = graph.nodes[to];
    expect(a).not.toEqual(b);
    expect(a.x === b.x || a.y === b.y).toBe(true);
    neighbors.set(from, [...(neighbors.get(from) ?? []), to]);
    neighbors.set(to, [...(neighbors.get(to) ?? []), from]);
  }
  for (const node of pending) for (const adjacent of neighbors.get(node) ?? []) {
    if (seen.has(adjacent)) continue;
    seen.add(adjacent);
    pending.push(adjacent);
  }
  expect(graph.diagnostics).toEqual([]);
  expect(seen.size).toBe(graph.nodes.length);
  expect(graph.segments).toHaveLength(graph.nodes.length - 1);
  const spans = graph.segments.map(({ from, to }) => {
    const a = graph.nodes[from], b = graph.nodes[to];
    return { from, to, left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
  });
  for (const [index, a] of spans.entries()) for (const b of spans.slice(index + 1)) {
    const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (xOverlap < 0 || yOverlap < 0) continue;
    expect([xOverlap, yOverlap]).toEqual([0, 0]);
    expect([b.from, b.to].some(node => node === a.from || node === a.to)).toBe(true);
  }
  return neighbors;
}

describe('Location virtual channels', () => {
  it('connects 42 exits along shared branches with a bounded total length', () => {
    const objects = Array.from({ length: 42 }, (_, i) => member('object:' + i, 12, 24 + i * 32));
    const rack = { ...boundary, geometry: { ...boundary.geometry, height: 1380 } };
    const graph = buildLocationChannelGraph(rack, objects);
    const neighbors = expectTree(graph);
    expect(graph.terminals.size).toBe(43);
    expect(graph.nodes[graph.root!]).toEqual({ x: 180, y: 690 });
    expect([...neighbors.values()].filter(n => n.length >= 3).length).toBeGreaterThan(30);
    const length = graph.segments.reduce((sum, { from, to }) => {
      const a = graph.nodes[from], b = graph.nodes[to];
      return sum + Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }, 0);
    expect(length).toBeLessThan(1600);
    expect(buildLocationChannelGraph(rack, [...objects].reverse())).toEqual(graph);
  });

  it('detours around equipment and child footprints, with clearance except at access leads', () => {
    const child = { ...member('boundary:child', 60, 40, 80, 90), edge: 'left' as const, point: { x: 60, y: 95 } };
    const objects = [member('object', 12, 80, 20, 20), child];
    const graph = buildLocationChannelGraph(boundary, objects);
    expectTree(graph);
    for (const { from, to } of graph.segments) {
      const a = graph.nodes[from], b = graph.nodes[to];
      for (const obstacle of objects) {
        const { x, y, width, height } = obstacle.bounds;
        const pad = graph.terminals.get(obstacle.id) === from ? 0 : LOCATION_CHANNEL_CLEARANCE;
        const crosses = a.x === b.x
          ? a.x > x - pad && a.x < x + width + pad && Math.min(a.y, b.y) < y + height + pad && Math.max(a.y, b.y) > y - pad
          : a.y > y - pad && a.y < y + height + pad && Math.min(a.x, b.x) < x + width + pad && Math.max(a.x, b.x) > x - pad;
        expect(crosses).toBe(false);
      }
    }
    expect(graph.nodes[graph.terminals.get(child.id)!]).toEqual(child.point);
  });

  it('keeps an empty Location boundary and seeds the technical root from a real member', () => {
    const empty = buildLocationChannelGraph(boundary, []);
    expectTree(empty);
    expect(empty.root).toBe(empty.terminals.get(boundary.id));
    expect(buildLocationChannelGraph(null, []).root).toBeNull();
    const child = member(boundary.id, 0, 0, 180, 180);
    const root = buildLocationChannelGraph(null, [child, member('direct', 240, 20)]);
    expectTree(root);
    expect(root.terminals.size).toBe(2);
    expect([...root.terminals.values()]).toContain(root.root);
    expect(root.nodes[root.terminals.get(boundary.id)!]).toEqual(empty.nodes[empty.root!]);
  });

  it('diagnoses blocked access and separated free regions without routing through the obstruction', () => {
    const wall = member('wall', 80, 0, 20, 180);
    const trapped = member('trapped', 10, 50, 30, 20);
    const blocked = member('blocked', 10, 90, 69, 20);
    const graph = buildLocationChannelGraph(boundary, [wall, trapped, blocked]);
    expect(graph.diagnostics).toEqual(expect.arrayContaining([
      { id: 'blocked', reason: 'blocked-access' },
      { id: 'trapped', reason: 'no-corridor' },
    ]));
    for (const id of ['blocked', 'trapped']) {
      const terminal = graph.terminals.get(id)!;
      expect(graph.segments.some(({ from, to }) => from === terminal || to === terminal)).toBe(false);
    }
  });

  it('uses explicit junctions even when two members share the same access point', () => {
    const right = member('right', 108, 40, 40, 20);
    right.edge = 'left';
    right.point = { x: 108, y: 50 };
    const left = member('left', 60, 40, 40, 20);
    const graph = buildLocationChannelGraph(boundary, [left, right]);
    expectTree(graph);
    const links = graph.segments.filter(({ from }) => from === graph.terminals.get(left.id) || from === graph.terminals.get(right.id));
    expect(links).toHaveLength(2);
    expect(links[0].to).toBe(links[1].to);
    expect(graph.nodes[links[0].to]).toEqual({ x: 104, y: 50 });
  });

  it('keeps a corner boundary orthogonal and reports a bounded search limit', () => {
    const corner = { ...boundary, geometry: { ...boundary.geometry, edge: 'top' as const, offset: 0 } };
    expectTree(buildLocationChannelGraph(corner, [member('object', 12, 40)]));
    const many = Array.from({ length: 513 }, (_, i) => member('object:' + i, 0, 40 * i));
    const graph = buildLocationChannelGraph(null, many);
    expect(graph.segments).toEqual([]);
    expect(graph.diagnostics).toHaveLength(many.length);
    expect(graph.diagnostics.every(d => d.reason === 'search-limit')).toBe(true);
  });
});
