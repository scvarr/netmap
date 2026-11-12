import { describe, expect, it } from 'vitest';
import { automaticLocationLayout } from './automaticLocationLayout';
import { resolveBoundaryWaypoint } from './locationBoundaryAnchors';
import { deriveLocationPresentation } from './locationFrames';
import type { LocationDocument } from './locationTypes';
import type { MapPlacement, MapLocationState, AutomaticLocationLayout } from './savedMapTypes';
const loc = (id: string, parent?: string): LocationDocument => ({ location_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: id }, name: id, parent_location_ref: parent ? { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: parent } : null } as LocationDocument);
const placement = (id: string, location: string): MapPlacement => ({ physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id }, location_ref: loc(location).location_ref, positions: {} });
const settings: AutomaticLocationLayout = { hide_empty: false, containers: {} };
const locations = [loc('building'), loc('floor','building'), loc('room','floor'), loc('empty'),loc('empty-child','empty')];
const placements = [placement('a','room'), placement('b','room')];
const objects = [{ physicalObjectId: 'a', rectangle: { x: 999, y: -200, width: 240, height: 84 } }, { physicalObjectId: 'b', rectangle: { x: -999, y: 900, width: 300, height: 130 } }];
describe('automatic Location composition', () => {
  it('packs nested frames and includes complete equipment footprint independently of manual positions', () => {
    const a = automaticLocationLayout(locations,placements,objects,[],settings);
    const b = automaticLocationLayout([...locations].reverse(),placements,objects.map(o => ({ ...o, rectangle: { ...o.rectangle, x: 0, y: 0 } })),[],settings);
    expect([...a.positions]).toEqual([...b.positions]);
    const first = a.positions.get('a')!, second = a.positions.get('b')!, room = a.frames.get('room')!;
    expect(second.y).toBeGreaterThan(first.y + first.height);
    expect(room.x + room.width).toBeGreaterThanOrEqual(second.x + second.width);
    expect(room.y + room.height).toBeGreaterThanOrEqual(second.y + second.height);
    expect(a.frames.get('floor')!.height).toBeGreaterThan(room.height);
  });
  it('mixes children and equipment in one explicit sequence with both directions', () => {
    const result = automaticLocationLayout([loc('rack'),loc('u','rack')],[placement('a','rack'),placement('b','u')],objects,[],{ ...settings, containers: { rack: { direction: 'HORIZONTAL', order: ['PhysicalObject:a','Location:u'] }, root: { direction: 'HORIZONTAL', order: [] } } });
    expect(result.frames.get('u')!.x).toBeGreaterThan(result.positions.get('a')!.x + 240);
  });
  it('removes entire empty subtrees and closes the gap', () => {
    const result = deriveLocationPresentation(locations,placements,objects,[],{ ...settings,hide_empty: true });
    expect(result.frames.map(f => f.locationId).sort()).toEqual(['building','floor','room']);
    const layout = automaticLocationLayout(locations,placements,objects,[],{ ...settings, hide_empty: true });
    expect(layout.frames.get('root')!.height).toBe(layout.frames.get('building')!.height + 24);
  });
  it('retains full and partial collapse semantics and expands deterministically', () => {
    const state: MapLocationState = { location_ref: loc('room').location_ref, collapsed: true, visible_direct_elements: [] };
    const full = deriveLocationPresentation(locations,placements,objects,[state],settings);
    expect(full.proxies.find(p => p.locationId === 'room')!.bounds.height).toBe(32);
    expect(full.hiddenObjectProxy.size).toBe(2);
    const partial = deriveLocationPresentation(locations,placements,objects,[{ ...state, visible_direct_elements: [{ entity_type: 'PhysicalObject', entity_id: 'b' }] }],settings);
    expect(partial.hiddenObjectProxy.has('a')).toBe(true);
    expect(partial.hiddenObjectProxy.has('b')).toBe(false);
    expect(partial.proxies.find(p => p.locationId === 'room')?.partial).toBe(true);
    expect(automaticLocationLayout(locations,placements,objects,[],settings).positions.size).toBe(2);
  });
});


describe('compact cross-axis geometry', () => {
  const tree = [loc('8'), loc('808','8'), loc('823','808'), loc('U42','823'), loc('U40','823')];
  const equipment = [{ physicalObjectId: 'PP1', rectangle: { x: 900, y: 900, width: 240, height: 84 } }];
  const members = [placement('PP1','U42')];
  it.each(['VERTICAL', 'HORIZONTAL'] as const)('aligns direct frames in %s and preserves natural main-axis size', direction => {
    const config = { ...settings, containers: { '823': { direction, order: ['Location:U42','Location:U40'] } } };
    const result = automaticLocationLayout(tree, members, equipment, [], config);
    const full = result.frames.get('U42')!, empty = result.frames.get('U40')!;
    if (direction === 'VERTICAL') {
      expect(empty.width).toBe(full.width);
      expect(empty.height).toBe(32);
      expect(full.height).toBe(108);
    } else {
      expect(empty.height).toBe(full.height);
      expect(empty.width).toBe(100);
      expect(full.width).toBe(264);
      expect(empty.x - full.x - full.width).toBe(20);
    }
    expect(result.positions.get('PP1')).toMatchObject({ width: 240, height: 84 });
    for (const [child, parent] of [['808','8'], ['823','808'], ['U42','823']]) {
      const c = result.frames.get(child)!, p = result.frames.get(parent)!;
      expect(c.x).toBeGreaterThanOrEqual(p.x + 12);
      expect(c.y).toBeGreaterThanOrEqual(p.y + 24);
      expect(c.x + c.width).toBeLessThanOrEqual(p.x + p.width - 12);
      expect(c.y + c.height).toBeLessThanOrEqual(p.y + p.height - 12);
    }
    expect(automaticLocationLayout(tree, members, equipment, [], JSON.parse(JSON.stringify(config)))).toEqual(result);
  });
  it.each(['VERTICAL', 'HORIZONTAL'] as const)('includes equipment in the %s cross-axis maximum without stretching it', direction => {
    const result = automaticLocationLayout([loc('p'),loc('c','p')], [placement('PP1','p')], equipment, [], { ...settings, containers: { p: { direction, order: [] } } });
    expect(result.frames.get('c')![direction === 'VERTICAL' ? 'width' : 'height']).toBe(direction === 'VERTICAL' ? 240 : 84);
    expect(result.positions.get('PP1')).toMatchObject({ width: 240, height: 84 });
  });
  it('reorders and hides empty frames without mutating variant inputs', () => {
    const config: AutomaticLocationLayout = { hide_empty: true, containers: { '823': { direction: 'VERTICAL', order: ['Location:U40','Location:U42'] } } };
    const before = JSON.stringify({ tree, members, equipment, config });
    const hidden = automaticLocationLayout(tree, members, equipment, [], config);
    expect(hidden.frames.has('U40')).toBe(false);
    const shown = automaticLocationLayout(tree, members, equipment, [], { ...config, hide_empty: false });
    expect(shown.frames.get('U40')!.y).toBeLessThan(shown.frames.get('U42')!.y);
    expect(JSON.stringify({ tree, members, equipment, config })).toBe(before);
  });
});


it('resolves route anchors against recomposed frames and preserves saved free geometry', () => {
  const tree = [loc('p'), loc('c','p')];
  const state: MapLocationState = { location_ref: loc('c').location_ref, boundary_point_id: 'stable-boundary', collapsed: false, visible_direct_elements: [], geometry: { x: 900, y: 800, width: 700, height: 600, edge: 'bottom', offset: .25 } };
  const route = [{ x: 999, y: 888, anchor: { location_id: 'c', edge: 'bottom' as const, offset: .25 } }, { x: 321, y: 123 }];
  const before = JSON.stringify({ state, route });
  for (const direction of ['VERTICAL', 'HORIZONTAL'] as const) {
    const presentation = deriveLocationPresentation(tree, [placement('a','p')], objects, [state], { ...settings, containers: { p: { direction, order: [] } } });
    const frame = presentation.frames.find(f => f.locationId === 'c')!;
    const resolved = route.map(w => resolveBoundaryWaypoint(w, presentation.frames));
    expect(resolved[0]).toEqual({ x: frame.bounds.x + frame.bounds.width * .25, y: frame.bounds.y + frame.bounds.height, anchor: route[0].anchor });
    expect(resolved[1]).toEqual(route[1]);
  }
  expect(JSON.stringify({ state, route })).toBe(before);
});


it.each([1, 3])('keeps border headings and full equipment footprints separate at %sx without changing layout', zoom => {
  const tree = [loc('8'),loc('808','8'),loc('823','808'),loc('U42','823'),loc('U40','823')];
  for (const direction of ['VERTICAL', 'HORIZONTAL'] as const) {
    const config: AutomaticLocationLayout = { ...settings, containers: { '823': { direction, order: ['Location:U42','Location:U40'] } } };
    const result = automaticLocationLayout(tree, [placement('PP1','U42')], [{ physicalObjectId: 'PP1', rectangle: { x: 0, y: 0, width: 240, height: 84 } }], [], config);
    const headingHalfHeight = 12 * Math.min(1, 1 / zoom) * zoom;
    for (const [parent, child] of [['8','808'],['808','823'],['823','U42']]) {
      const p = result.frames.get(parent)!, c = result.frames.get(child)!;
      expect(p.y * zoom + headingHalfHeight).toBeLessThanOrEqual(c.y * zoom - headingHalfHeight);
    }
    const rack = result.frames.get('U42')!, object = result.positions.get('PP1')!, sibling = result.frames.get('U40')!;
    expect(object.y - rack.y).toBe(12);
    expect(rack.height).toBe(108);
    expect(rack.y * zoom + headingHalfHeight).toBeLessThanOrEqual(object.y * zoom);
    expect(object.y + object.height).toBeLessThanOrEqual(rack.y + rack.height - 12);
    if (direction === 'VERTICAL') {
      expect(sibling.y - rack.y - rack.height).toBe(12);
      expect((rack.y + rack.height) * zoom).toBeLessThanOrEqual(sibling.y * zoom - headingHalfHeight);
    } else expect(sibling.x - rack.x - rack.width).toBe(20);
  }
});
