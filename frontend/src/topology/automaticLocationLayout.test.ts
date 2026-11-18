import { moveGridLocation } from './locationGridArrangement';
import { gridTables } from './uniformGridPresentation';
import { describe, expect, it } from 'vitest';
import { automaticLocationLayout } from './automaticLocationLayout';
import { locationBoundaryPoint } from './locationFrameGeometry';
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


it('positions the Location boundary point on recomposed frames', () => {
  const tree = [loc('p'), loc('c','p')];
  const state: MapLocationState = { location_ref: loc('c').location_ref, boundary_point_id: 'stable-boundary', collapsed: false, visible_direct_elements: [], geometry: { x: 900, y: 800, width: 700, height: 600, edge: 'bottom', offset: .25 } };
  const before = JSON.stringify(state);
  for (const direction of ['VERTICAL', 'HORIZONTAL'] as const) {
    const presentation = deriveLocationPresentation(tree, [placement('a','p')], objects, [state], { ...settings, containers: { p: { direction, order: [] } } });
    const frame = presentation.frames.find(f => f.locationId === 'c')!;
    const resolved = locationBoundaryPoint(frame.bounds, state.geometry!);
    expect(resolved).toEqual({ x: frame.bounds.x + frame.bounds.width * .25, y: frame.bounds.y + frame.bounds.height });
  }
  expect(JSON.stringify(state)).toBe(before);
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


describe('flexible cable reserve', () => {
  const ls = [loc('rack'), loc('U42', 'rack'), loc('U40', 'rack')];
  const ps = [placement('PP1', 'U42'), placement('SW1', 'U40')];
  const os = [{ physicalObjectId: 'PP1', flexibleCableZone: true, rectangle: { x: 0, y: 0, width: 332, height: 24 } }, { physicalObjectId: 'SW1', flexibleCableZone: true, rectangle: { x: 0, y: 0, width: 572, height: 44 } }];
  it('fills equal-width stacked Locations using only derived frame widths', () => {
    const before = JSON.stringify({ ls, ps, os, settings });
    const result = automaticLocationLayout(ls, ps, os, [], settings);
    const a = result.positions.get('PP1')!, b = result.positions.get('SW1')!;
    expect(a.width).toBe(572);
    expect(a.x + a.width).toBe(b.x + b.width);
    expect(a.height).toBe(24);
    expect(a.x + a.width).toBe(result.frames.get('U42')!.x + result.frames.get('U42')!.width - 12);
    expect(JSON.stringify({ ls, ps, os, settings })).toBe(before);
  });
  it('never stretches multiple objects across a horizontal container', () => {
    const result = automaticLocationLayout([loc('rack')], [placement('PP1', 'rack'), placement('SW1', 'rack')], os, [], { ...settings, containers: { rack: { direction: 'HORIZONTAL', order: [] } } });
    const a = result.positions.get('PP1')!, b = result.positions.get('SW1')!;
    expect(a.width).toBe(332); expect(b.width).toBe(572);
    expect(a.x + a.width).toBeLessThan(b.x);
  });
});


describe('uniform grid runtime integration', () => {
  const grid = { mode: 'uniform_grid' as const, version: 1 as const, hide_empty: false, tables: { root: [['building', null, 'empty']] } };
  it('uses real footprints through Location presentation and preserves settings across live additions', () => {
    const frozen = JSON.stringify(grid);
    const first = deriveLocationPresentation(locations, placements, objects, [], grid);
    const room = first.frames.find(f => f.locationId === 'room')!.bounds;
    expect(room.width).toBe(324);
    expect(first.automaticPositions!.get('b')!.width).toBe(300);
    const added = [...locations, loc('new')];
    const next = automaticLocationLayout(added, [...placements, placement('large', 'empty')], [...objects, { physicalObjectId: 'large', rectangle: { x: 0, y: 0, width: 800, height: 400 } }], [], grid);
    expect(next.frames.get('building')!.width).toBe(next.frames.get('empty')!.width);
    expect(next.frames.has('new')).toBe(true);
    expect(next.positions.get('large')!.width).toBe(800);
    expect(JSON.stringify(grid)).toBe(frozen);
    expect(deriveLocationPresentation(locations, placements, objects, [], JSON.parse(frozen))).toEqual(first);
  });
  it('preserves sparse addresses and collapse visibility without rewriting routes or structure', () => {
    const state: MapLocationState = { location_ref: loc('room').location_ref, collapsed: true, visible_direct_elements: [{ entity_type: 'PhysicalObject', entity_id: 'b' }] };
    const before = JSON.stringify(grid);
    const layout = automaticLocationLayout(locations, placements, objects, [state], grid);
    expect(layout.positions.has('a')).toBe(false);
    expect(layout.positions.has('b')).toBe(true);
    const hidden = automaticLocationLayout(locations, placements, objects, [], { ...grid, hide_empty: true });
    expect(hidden.hidden.has('empty')).toBe(true);
    expect(JSON.stringify(grid)).toBe(before);
  });

  it('lays out ordered full footprints along each container’s own axis', () => {
    const tree = [loc('room'), loc('nested', 'room'), loc('sibling')];
    const rootMember = (id: string) => ({ ...placement(id, 'room'), location_ref: null });
    const members = [...placements, rootMember('rootA'), rootMember('rootB'), placement('c', 'nested')];
    const footprints = [...objects, ...['rootA', 'rootB', 'c'].map(physicalObjectId => ({
      physicalObjectId, rectangle: { x: 100, y: -100, width: 80, height: 40 },
    }))];
    const baseline = automaticLocationLayout(tree, members, footprints, [], grid);
    const edited = automaticLocationLayout(tree, members, footprints, [], {
      ...grid, object_sequences: {
        room: { direction: 'HORIZONTAL' as const, order: ['b', 'rootA', 'b'] },
        root: { direction: 'VERTICAL' as const, order: ['rootB', 'rootA'] },
      },
    });
    const a = edited.positions.get('a')!, b = edited.positions.get('b')!;
    expect([b.width, b.height, a.width, a.height]).toEqual([300, 130, 240, 84]);
    expect(a.x).toBeGreaterThan(b.x + b.width);
    expect(a.y).toBe(b.y);
    expect(edited.frames.get('room')!.width).toBeGreaterThan(baseline.frames.get('room')!.width);
    expect(edited.frames.get('nested')!.y).toBeGreaterThan(b.y + b.height);
    expect(edited.frames.get('nested')!.width).toBe(baseline.frames.get('nested')!.width);
    const first = edited.positions.get('rootB')!, second = edited.positions.get('rootA')!;
    expect(first.x).toBe(second.x);
    expect(second.y).toBeGreaterThan(first.y + first.height);
    expect(baseline.positions.get('rootA')!.y).toBeLessThan(baseline.positions.get('rootB')!.y);
    expect(edited.positions.size).toBe(members.length);
  });
});


it('reconciles new children into holes without moving surviving cells or mutating variants', () => {
  const tables = { root: [[null, 'building'], ['empty']] };
  const before = JSON.stringify(tables);
  const next = gridTables([...locations, loc('added')], tables);
  expect(next.root).toEqual([['added', 'building'], ['empty']]);
  next.root[0][0] = null;
  expect(JSON.stringify(tables)).toBe(before);
});

it('SLOC-03 preview and persisted reload share final nested geometry without mutating settings', () => {
 const locs=[loc('A'),loc('B'),loc('C'),loc('child','B')];
 const ps=[placement('a','A'),placement('b','child')];
 const original = { mode:'uniform_grid' as const, version:1 as const, hide_empty:false, tables:{root:[['A'],['B'],['C']],B:[['child']]} };
 const snapshot=JSON.stringify(original);
 const next={...original,tables:{...original.tables,root:moveGridLocation(original.tables.root,'B','RIGHT')!}};
 const preview=automaticLocationLayout(locs,ps,objects,[],next);
 const reload=automaticLocationLayout(locs,ps,objects,[],JSON.parse(JSON.stringify(next)));
 expect([...preview.frames]).toEqual([...reload.frames]); expect([...preview.positions]).toEqual([...reload.positions]);
 expect(JSON.stringify(original)).toBe(snapshot); expect(next.tables.B).toBe(original.tables.B);
 const before=automaticLocationLayout(locs,ps,objects,[],original);
 const relative=(layout:typeof before) => {const b=layout.frames.get('B')!, child=layout.frames.get('child')!, object=layout.positions.get('b')!; return [child.x-b.x,child.y-b.y,object.x-b.x,object.y-b.y,object.width,object.height];};
 expect(relative(preview)).toEqual(relative(before));
 expect(next.tables.root).toEqual([['A',null],[null,'B'],['C',null]]);
 let current = next;
 for (let i=0;i<10;i++) {
   current = {...current,tables:{...current.tables,root:moveGridLocation(current.tables.root,'B','LEFT')!}};
   expect(current.tables.root).toEqual(original.tables.root);
   const restored = automaticLocationLayout(locs,ps,objects,[],current);
   expect(restored.frames.get('root')).toEqual(before.frames.get('root'));
   expect(relative(restored)).toEqual(relative(before));
   current = {...current,tables:{...current.tables,root:moveGridLocation(current.tables.root,'B','RIGHT')!}};
   expect(automaticLocationLayout(locs,ps,objects,[],current).frames.get('root')).toEqual(preview.frames.get('root'));
 }

});
