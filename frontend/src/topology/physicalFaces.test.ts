import { describe, expect, it } from 'vitest';
import { blueprintFace, resolveFaces } from './physicalFaces';
import type { LocationDocument, LocationRef } from './locationTypes';
import type { MapLocationState, MapPlacement, PhysicalFace } from './savedMapTypes';
import type { BlueprintPresentation } from './types';

const ref = (id: string): LocationRef => ({ ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: id });
const location = (id: string, parent?: string): LocationDocument => ({
  location_ref: ref(id), name: id, type: null, parent_location_ref: parent ? ref(parent) : null,
});
const state = (id: string, face: PhysicalFace): MapLocationState => ({
  location_ref: ref(id), face_override: face, collapsed: true, visible_direct_elements: [],
});
const placement = (id: string, locationId?: string, face?: PhysicalFace): MapPlacement => ({
  physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id },
  location_ref: locationId ? ref(locationId) : null,
  positions: { 'L1/PHYSICAL_OBJECT': { x: 0, y: 0, locked: false, face_override: face } },
});

describe('physical faces', () => {
  it('resolves the nearest canonical override and tracks its source after reparent and reassignment', () => {
    const locations = [location('root'), location('rack', 'root'), location('shelf', 'rack'), location('other')];
    const states = [state('root', 'REAR'), state('rack', 'FRONT')];
    const placements = [placement('inherited', 'shelf'), placement('explicit', 'shelf', 'REAR'), placement('unassigned')];
    const initial = resolveFaces('REAR', locations, states, placements);
    expect(initial.locationFaces.get('rack')).toEqual({ face: 'FRONT', source: { kind: 'location', name: 'rack' }, explicit: true });
    expect(initial.locationFaces.get('shelf')).toEqual({ face: 'FRONT', source: { kind: 'location', name: 'rack' }, explicit: false });
    expect(initial.objectFaces.get('inherited')).toEqual(initial.locationFaces.get('shelf'));
    expect(initial.objectFaces.get('explicit')).toEqual({ face: 'REAR', source: { kind: 'object' }, explicit: true });
    expect(initial.objectFaces.get('unassigned')).toEqual({ face: 'REAR', source: { kind: 'variant' }, explicit: false });

    const changed = resolveFaces('FRONT', locations.map(row => row.name === 'shelf' ? location('shelf', 'root') : row),
      states, [placements[0], placement('explicit', 'other'), placements[2]]);
    expect(changed.objectFaces.get('inherited')).toEqual({ face: 'REAR', source: { kind: 'location', name: 'root' }, explicit: false });
    expect(changed.objectFaces.get('explicit')).toEqual({ face: 'FRONT', source: { kind: 'variant' }, explicit: false });
  });

  it('uses explicit panel faces while preserving geometry and canonical port IDs', () => {
    const panel = (key: string, x: number, face?: PhysicalFace) => ({
      panel_key: key, panel_number: x + 1, display_name: 'Arbitrary ' + key, x, y: 0, width: 1, height: 1, face,
    });
    const blueprint = {
      blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'template' },
      version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'revision' },
      body: { kind: 'RECTANGLE', width: 3, height: 1 },
      panels: [panel('A', 0, 'FRONT'), panel('B', 1, 'REAR'), panel('C', 2)],
      slots: ['A', 'B', 'C'].map(key => ({
        panel_key: key, slot_key: key, connection_point_id: 'canonical-' + key, display_name: key,
        kind: 'CONNECTION_POINT' as const, port_type_id: 'colored',
        panel_local_position: { x: .5, y: .5 }, rendered_position: { x: .5, y: .5 },
        external_attachment: { x: 1, y: .5, side: 'RIGHT' as const },
      })),
    } satisfies BlueprintPresentation;
    const rear = blueprintFace(blueprint, 'REAR')!;
    expect(rear.hiddenPorts).toEqual(new Set(['canonical-A']));
    expect(rear.visibleBlueprint.panels).toBe(blueprint.panels);
    expect(rear.visibleBlueprint.slots).toEqual(blueprint.slots.slice(1));
    expect(blueprintFace({ ...blueprint, panels: [panel('A', 0, 'REAR')] }, 'FRONT')).toBeUndefined();
    expect(blueprintFace({ ...blueprint, panels: [panel('A', 0), panel('B', 1)] }, 'REAR')).toBeUndefined();
    expect(blueprintFace({ ...blueprint, panels: [panel('A', 0, 'FRONT'), panel('B', 1, 'FRONT'), panel('C', 2, 'FRONT')] }, 'REAR')?.visibleBlueprint.slots).toEqual([]);
  });
});
