import { describe, expect, it } from 'vitest';
import { automaticLocationLayout } from './automaticLocationLayout';
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
    expect(layout.frames.get('root')!.height).toBe(layout.frames.get('building')!.height + 64);
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
