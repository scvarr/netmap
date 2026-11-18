import { describe, expect, it } from 'vitest';
import { buildHierarchicalCableChannels, hierarchicalLocationPath, type LocationChannelInput } from './hierarchicalCableRoutes';

const object = (id: string, x: number, y: number): LocationChannelInput['members'][number] => ({
  id, kind: 'blueprint-object', bounds: { x, y, width: 80, height: 22 }, edge: 'right', point: { x: x + 80, y: y + 11 },
});

function room(id: string, x: number, y: number, width: number, height: number, members: LocationChannelInput['members']) {
  const bounds = { x, y, width, height };
  const boundary = { id: 'boundary:' + id, geometry: { ...bounds, edge: 'right' as const, offset: .5 } };
  return {
    input: { locationId: id, boundary, members },
    terminal: { id: boundary.id, kind: 'location' as const, bounds, edge: 'right' as const, point: { x: x + width, y: y + height / 2 } },
  };
}

function fixture() {
  const left = room('left', 40, 50, 190, 220, [object('a', 65, 72), object('b', 65, 220)]);
  const right = room('right', 310, 50, 190, 220, [object('c', 335, 72)]);
  const server = room('server', 0, 0, 590, 330, [left.terminal, right.terminal]);
  const remote = room('remote', 730, 45, 190, 240, [object('d', 755, 100)]);
  const root = { locationId: null, boundary: null, members: [server.terminal, remote.terminal, object('e', 55, 460)] };
  return { left, right, server, remote, root };
}

describe('hierarchical Cable segment references', () => {
  const { left, right, server, remote, root } = fixture();
  const inputs = [left.input, right.input, server.input, remote.input, root];
  const scene = buildHierarchicalCableChannels(inputs);
  const route = (from: string, to: string, channels = scene) =>
    hierarchicalLocationPath(channels, channels.terminals.get(from)!, channels.terminals.get(to)!);
  const locations = (from: string, to: string) => [...new Set(route(from, to).segments?.map(ref => ref.locationId))];

  it('uses the local tree without going through its boundary terminal', () => {
    const { segments } = route('a', 'b');
    expect(locations('a', 'b')).toEqual(['left']);
    const graph = scene.locations.get('left')!.graph;
    const boundary = graph.terminals.get(left.terminal.id);
    expect(segments?.every(({ segment }) => {
      const { from, to } = graph.segments[segment];
      return from !== boundary && to !== boundary;
    })).toBe(true);
  });

  it('composes sibling racks, separates roots, and connects an unassigned object through root', () => {
    expect(locations('a', 'c')).toEqual(['left', 'server', 'right']);
    expect(locations('a', 'd')).toEqual(['left', 'server', null, 'remote']);
    expect(locations('e', 'a')).toEqual([null, 'server', 'left']);
    expect(route('c', 'a').segments).toEqual([...route('a', 'c').segments!].reverse());
    const reordered = buildHierarchicalCableChannels(inputs.map(input => ({ ...input, members: [...input.members].reverse() })));
    expect(route('a', 'c', reordered)).toEqual(route('a', 'c'));
  });

  it('starts at the visible boundary for full and partial collapse', () => {
    const collapsed = buildHierarchicalCableChannels([server.input, remote.input, root]);
    expect(route(left.terminal.id, right.terminal.id, collapsed).segments?.every(ref => ref.locationId === 'server')).toBe(true);
    expect(route(server.terminal.id, 'd', collapsed).segments?.map(ref => ref.locationId)).not.toContain('server');
    const hiddenEnd = { locationId: 'left', terminalId: left.terminal.id };
    const visibleEnd = scene.terminals.get('b')!;
    expect(hierarchicalLocationPath(scene, hiddenEnd, visibleEnd).segments?.every(ref => ref.locationId === 'left')).toBe(true);
    expect(hierarchicalLocationPath(scene, hiddenEnd, scene.terminals.get('c')!)).toEqual(route(left.terminal.id, 'c'));
  });

  it('reports the failing leg without returning a partial route', () => {
    const blocked = { ...left.input, members: [...left.input.members, object('blocker', 130, 72)] };
    const channels = buildHierarchicalCableChannels([blocked, ...inputs.slice(1)]);
    expect(channels.locations.get('left')!.graph.diagnostics).toContainEqual({ id: 'a', reason: 'blocked-access' });
    expect(route('a', 'c', channels)).toEqual({ failure: { locationId: 'left', from: 'a', to: left.terminal.id } });
  });
});
