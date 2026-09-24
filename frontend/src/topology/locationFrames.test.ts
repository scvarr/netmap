import { describe, expect, it } from 'vitest';
import { deriveLocationPresentation, LOCATION_FRAME_PADDING, projectCollapsedEdges } from './locationFrames';
import type { LocationDocument } from './locationTypes';
import type { MapLocationState, MapPlacement } from './savedMapTypes';
import type { FlowRectangle } from './nodeFootprint';

const location = (id: string, parent: string | null = null): LocationDocument => ({
  location_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: id },
  name: id,
  type: null,
  parent_location_ref: parent ? { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: parent } : null,
});
const placement = (id: string, at: string | null): MapPlacement => ({
  physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id },
  location_ref: at ? location(at).location_ref : null,
  positions: {},
});
const shown = (physicalObjectId: string, x: number, y: number, width = 100, height = 60) => ({
  physicalObjectId, rectangle: { x, y, width, height },
});
const state = (id: string, collapsed: boolean, refs: MapLocationState['visible_direct_elements'] = []): MapLocationState => ({ location_ref: location(id).location_ref, collapsed, visible_direct_elements: refs });

describe('variant Location collapse projection', () => {
  const hierarchy = [location('room'), location('rack', 'room')];
  const placements = [placement('switch', 'rack'), placement('ups', 'room')];
  const objects = [shown('switch', 0, 0), shown('ups', 400, 0)];

  it('keeps absent state expanded and collapses all into one compact proxy', () => {
    expect(deriveLocationPresentation(hierarchy, placements, objects).frames).toHaveLength(1);
    const collapsed = deriveLocationPresentation(hierarchy, placements, objects, [state('room', true)]);
    expect(collapsed.frames).toEqual([]);
    expect(collapsed.proxies).toMatchObject([{ locationId: 'room', hiddenObjectCount: 2 }]);
    expect([...collapsed.hiddenObjectProxy.entries()]).toEqual([['ups', 'room'], ['switch', 'room']]);
    expect(collapsed.proxies[0].bounds.height).toBeLessThan(objects[0].rectangle.height);
    expect(collapsed.proxies[0].bounds.width).toBeLessThan(objects[0].rectangle.width + objects[1].rectangle.x);
  });

  it('derives a unary parent path once for a collapsed proxy and sizes its anchor from that path', () => {
    const hierarchy = [location('301'), location('301A', '301')];
    const placements = [placement('a', '301A')];
    const objects = [shown('a', 100, 100)];
    const collapsed = deriveLocationPresentation(hierarchy, placements, objects, [state('301A', true)]);
    expect(collapsed.proxies).toMatchObject([{ locationId: '301A', pathLocationIds: ['301', '301A'], label: '301 / 301A' }]);
    expect(collapsed.proxies[0].label).not.toContain('301A / 301A');
    expect(collapsed.proxies[0].bounds.height).toBeLessThan(objects[0].rectangle.height);
    expect(collapsed.proxies[0].bounds.width).toBeGreaterThan(deriveLocationPresentation([location('301A')], placements, objects, [state('301A', true)]).proxies[0].bounds.width);
  });

  it('keeps a direct child recursively and forms a frame with the hidden remainder', () => {
    const states = [state('room', true, [{ entity_type: 'Location', entity_id: 'rack' }]), state('rack', true)];
    const partial = deriveLocationPresentation(hierarchy, placements, objects, states);
    expect(partial.frames.map((frame) => frame.locationId)).toEqual(['room']);
    expect(partial.proxies.map((proxy) => proxy.locationId)).toEqual(['rack', 'room']);
    expect([...partial.hiddenObjectProxy.entries()]).toEqual([['switch', 'rack'], ['ups', 'room']]);
    const hiddenChild = deriveLocationPresentation(hierarchy, placements, objects, [state('room', true), state('rack', true)]);
    expect(hiddenChild.proxies.map((proxy) => proxy.locationId)).toEqual(['room']);
  });

  it('expands without losing the visible set and applies independent variant states', () => {
    const retained = state('room', false, [{ entity_type: 'Location', entity_id: 'rack' }]);
    const expanded = deriveLocationPresentation(hierarchy, placements, objects, [retained]);
    expect(expanded.proxies).toEqual([]);
    expect(expanded.frames).toHaveLength(1);
    const again = deriveLocationPresentation(hierarchy, placements, objects, [{ ...retained, collapsed: true }]);
    expect(again.hiddenObjectProxy.get('ups')).toBe('room');
    expect(deriveLocationPresentation(hierarchy, placements, objects, []).hiddenObjectProxy.size).toBe(0);
  });

  it('keeps each real cable and route while remapping hidden endpoints, including continuations', () => {
    const edges = [
      { id: 'same', source: 'a', target: 'b', evidence: 'canonical-same', waypoints: [{ x: 1, y: 2 }], data: {} },
      { id: 'boundary', source: 'a', target: 'visible', evidence: 'canonical-boundary', waypoints: [{ x: 3, y: 4 }], data: {} },
      { id: 'other', source: 'a', target: 'c', evidence: 'canonical-other', waypoints: [], data: {} },
      { id: 'continuation', source: 'a', target: 'a', evidence: 'canonical-continuation', waypoints: [], data: { continuation: true } },
    ];
    const result = projectCollapsedEdges(edges, new Map([['a', 'location-proxy:room'], ['b', 'location-proxy:room'], ['c', 'location-proxy:other']]));
    expect(result.map((edge) => edge.id)).toEqual(['boundary', 'other', 'continuation']);
    expect(result[0]).toEqual({ ...edges[1], source: 'location-proxy:room' });
    expect(result[1]).toEqual({ ...edges[2], source: 'location-proxy:room', target: 'location-proxy:other' });
    expect(result[2]).toEqual({ ...edges[3], source: 'location-proxy:room', target: 'location-proxy:room' });
    expect(edges[1].waypoints).toEqual([{ x: 3, y: 4 }]);
  });
});
const contains = (outer: FlowRectangle, inner: FlowRectangle) => {
  expect(outer.x).toBeLessThanOrEqual(inner.x);
  expect(outer.y).toBeLessThanOrEqual(inner.y);
  expect(outer.x + outer.width).toBeGreaterThanOrEqual(inner.x + inner.width);
  expect(outer.y + outer.height).toBeGreaterThanOrEqual(inner.y + inner.height);
};

describe('expanded Location presentation arity', () => {
  it('retains a full frame for two direct displayed objects using their actual rectangles', () => {
    const objects = [shown('a', 10, 20, 310, 170), shown('b', 450, 80, 100, 60)];
    const result = deriveLocationPresentation([location('room')], [placement('a', 'room'), placement('b', 'room')], objects);
    expect(result.frames).toHaveLength(1);
    expect(result.objectPaths).toHaveLength(0);
    expect(result.frames[0]).toMatchObject({ locationId: 'room', label: 'room', pathLocationIds: ['room'] });
    objects.forEach((object) => contains(result.frames[0].bounds, object.rectangle));
    expect(result.frames[0].bounds).toEqual({
      x: 10 - LOCATION_FRAME_PADDING,
      y: 20 - LOCATION_FRAME_PADDING,
      width: 550 - 10 + LOCATION_FRAME_PADDING * 2,
      height: 190 - 20 + LOCATION_FRAME_PADDING * 2,
    });
  });

  it('retains a parent frame for two non-empty child Locations and ignores an empty sibling', () => {
    const result = deriveLocationPresentation(
      [location('room'), location('rack-a', 'room'), location('rack-b', 'room'), location('empty', 'room')],
      [placement('a', 'rack-a'), placement('b', 'rack-b')],
      [shown('a', 0, 0), shown('b', 400, 0)],
    );
    expect(result.frames.map((frame) => frame.locationId)).toEqual(['room']);
    expect(result.objectPaths.map((path) => path.label)).toEqual(['rack-a', 'rack-b']);
    contains(result.frames[0].bounds, shown('a', 0, 0).rectangle);
    contains(result.frames[0].bounds, shown('b', 400, 0).rectangle);
  });

  it('suppresses a single-object frame and provides its Location path without geometry', () => {
    const result = deriveLocationPresentation([location('unit')], [placement('a', 'unit')], [shown('a', 10, 20)]);
    expect(result.frames).toEqual([]);
    expect(result.objectPaths).toEqual([{ physicalObjectId: 'a', label: 'unit', pathLocationIds: ['unit'] }]);
  });

  it('compresses a deep unary chain into one path without repeated padding or headers', () => {
    const locations = Array.from({ length: 12 }, (_, index) => location(`L${index}`, index ? `L${index - 1}` : null));
    const deep = deriveLocationPresentation(locations, [placement('a', 'L11')], [shown('a', 0, 100)]);
    expect(deep.frames).toEqual([]);
    expect(deep.objectPaths).toHaveLength(1);
    expect(deep.objectPaths[0].pathLocationIds).toEqual(locations.map((item) => item.location_ref.entity_id));
    expect(deep.objectPaths[0].label).toBe(locations.map((item) => item.name).join(' / '));
    expect(deep.objectPaths[0]).not.toHaveProperty('bounds');
  });

  it('merges unary ancestor names into one retained branching frame', () => {
    const objects = [shown('x', 0, 0), shown('y', 300, 0)];
    const result = deriveLocationPresentation(
      [location('A'), location('B', 'A'), location('C', 'B')],
      [placement('x', 'C'), placement('y', 'C')],
      objects,
    );
    const uncompressed = deriveLocationPresentation([location('C')], [placement('x', 'C'), placement('y', 'C')], objects);
    expect(result.frames).toMatchObject([{ locationId: 'C', label: 'A / B / C', pathLocationIds: ['A', 'B', 'C'] }]);
    expect(result.frames[0].bounds).toEqual(uncompressed.frames[0].bounds);
    expect(result.objectPaths).toEqual([]);
  });

  it('does not size a retained frame from a long unary path label', () => {
    const long = 'Very-long-semantic-Location-name-that-exceeds-the-displayed-frame-width';
    const objects = [shown('x', 0, 0), shown('y', 100, 100)];
    const plain = deriveLocationPresentation([location('branch')], [placement('x', 'branch'), placement('y', 'branch')], objects);
    const path = deriveLocationPresentation([location(long), location('branch', long)], [placement('x', 'branch'), placement('y', 'branch')], objects);
    expect(path.frames[0].label).toBe(`${long} / branch`);
    expect(path.frames[0].bounds).toEqual(plain.frames[0].bounds);
  });

  it('retains a parent with one direct object and one non-empty child', () => {
    const result = deriveLocationPresentation(
      [location('parent'), location('child', 'parent')],
      [placement('a', 'parent'), placement('b', 'child')],
      [shown('a', 0, 0), shown('b', 300, 100)],
    );
    expect(result.frames.map((frame) => frame.locationId)).toEqual(['parent']);
    expect(result.objectPaths.map((path) => path.label)).toEqual(['child']);
    contains(result.frames[0].bounds, shown('b', 300, 100).rectangle);
    contains(result.frames[0].bounds, shown('a', 0, 0).rectangle);
  });

  it('keeps the same parent bounds when a child object gains a unary path', () => {
    const objects = [shown('a', 0, 0), shown('b', 300, 100)];
    const direct = deriveLocationPresentation([location('parent')], [placement('a', 'parent'), placement('b', 'parent')], objects);
    const unary = deriveLocationPresentation([location('parent'), location('child', 'parent')], [placement('a', 'parent'), placement('b', 'child')], objects);
    expect(unary.objectPaths).toHaveLength(1);
    expect(unary.frames[0].bounds).toEqual(direct.frames[0].bounds);
  });

  it('derives frame bounds afresh on movement and resize without changing the object path', () => {
    const locations = [location('room'), location('unit', 'room')];
    const placements = [placement('a', 'room'), placement('b', 'unit')];
    const derive = (x: number, width: number) => deriveLocationPresentation(locations, placements, [shown('a', 0, 0), shown('b', x, 100, width, 60)]);
    const initial = derive(300, 100);
    const moved = derive(400, 100);
    const resized = derive(300, 400);
    expect(moved.objectPaths).toEqual(initial.objectPaths);
    expect(moved.frames[0].bounds.width).toBeGreaterThan(initial.frames[0].bounds.width);
    expect(resized.frames[0].bounds.width).toBeGreaterThan(initial.frames[0].bounds.width);
  });

  it('does not invent representation for empty, unlocated, unknown or undisplayed placements', () => {
    const result = deriveLocationPresentation(
      [location('empty'), location('known')],
      [placement('unlocated', null), placement('unknown', 'missing'), placement('hidden', 'known')],
      [shown('unlocated', 0, 0), shown('unknown', 100, 0)],
    );
    expect(result).toEqual({ frames: [], objectPaths: [], proxies: [], hiddenObjectProxy: new Map() });
  });
});
