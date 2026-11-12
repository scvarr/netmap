import { describe, expect, it } from 'vitest';
import { deriveLocationPresentation, projectCollapsedEdges } from './locationFrames';
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


describe('independent Location presentation', () => {
  it('retains empty, unary and nested frames independently from equipment', () => {
    const locations = [location('U19'), location('rack', 'U19')];
    const empty = deriveLocationPresentation(locations, [], []);
    const populated = deriveLocationPresentation(locations, [placement('a', 'rack')], [shown('a', 10000, 20000)]);
    expect(empty.frames).toHaveLength(2);
    expect(populated.frames).toEqual(empty.frames);
    expect(empty.frames.find(f => f.locationId === 'rack')).toMatchObject({ parentLocationId: 'U19', label: 'U19 / rack', depth: 1 });
  });
  it('uses variant geometry and preserves canonical placement', () => {
    const geometry = { x: -1, y: 4, width: 300, height: 120, edge: 'bottom' as const, offset: .4 };
    const placements = [placement('a', 'room')];
    const result = deriveLocationPresentation([location('room')], placements, [shown('a', 0, 0)], [{ ...state('room', false), geometry }]);
    expect(result.frames[0].bounds).toEqual(geometry);
    expect(placements[0].location_ref?.entity_id).toBe('room');
  });
  it('keeps exact edge identity during collapse projection', () => {
    const edges = [{ id: 'cable', source: 'a', target: 'b' }];
    expect(projectCollapsedEdges(edges, new Map([['a', 'location-proxy:room']]))[0]).toEqual({ id: 'cable', source: 'location-proxy:room', target: 'b' });
  });
});
