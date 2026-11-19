import { describe, expect, it } from 'vitest';
import { blueprintRenderedNodeDimensions } from './blueprintDisplaySize';
import { uniformGridPresentation } from './uniformGridPresentation';
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

  it('crops vertical panel layouts, preserves port identity and remeasures uniform-grid cells', () => {
    const panel = (key: string, y: number, face?: PhysicalFace, height = 1) => ({
      panel_key: key, panel_number: y + 1, display_name: 'Arbitrary ' + key, x: 0, y, width: 4, height, face,
    });
    const blueprint = {
      blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'template' },
      version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'revision' },
      body: { kind: 'RECTANGLE', width: 4, height: 5 },
      panels: [panel('A', 0, 'FRONT'), panel('B', 3, 'REAR', 2), panel('C', 5)],
      slots: ['A', 'B', 'C'].map(key => ({
        panel_key: key, slot_key: key, connection_point_id: 'canonical-' + key, display_name: key,
        kind: 'CONNECTION_POINT' as const, port_type_id: 'colored',
        panel_local_position: { x: .5, y: .5 }, rendered_position: { x: .5, y: .5 },
        external_attachment: { x: 1, y: .5, side: 'RIGHT' as const },
      })),
    } satisfies BlueprintPresentation;
    const original = structuredClone(blueprint);
    const front = blueprintFace(blueprint, 'FRONT')!.visibleBlueprint;
    const rear = blueprintFace(blueprint, 'REAR')!;
    expect(rear.hiddenPorts).toEqual(new Set(['canonical-A']));
    expect(rear.visibleBlueprint.panels.map(item => item.panel_key)).toEqual(['B', 'C']);
    expect(rear.visibleBlueprint.slots[0]).toMatchObject({
      connection_point_id: 'canonical-B', port_type_id: 'colored',
      rendered_position: { x: .5, y: 1 / 3 },
      external_attachment: { x: 1, y: 1 / 3 },
    });
    expect(blueprint).toEqual(original);
    expect(blueprintRenderedNodeDimensions(blueprint, 200)).toEqual({ width: 292, height: 300 });
    const rearDimensions = blueprintRenderedNodeDimensions(rear.visibleBlueprint, 200);
    expect(rearDimensions).toEqual({ width: 292, height: 150 });

    const grid = (dimensions: typeof rearDimensions) => uniformGridPresentation(
      [location('rack')], [placement('unit', 'rack'), placement('tail', 'rack')],
      [{ physicalObjectId: 'unit', rectangle: { x: 0, y: 0, ...dimensions }, flexibleCableZone: true },
        { physicalObjectId: 'tail', rectangle: { x: 0, y: 0, width: 212, height: 144 } }],
      [], { mode: 'uniform_grid', version: 1, hide_empty: false, tables: { root: [['rack']] },
        object_sequences: { rack: { direction: 'VERTICAL', order: ['unit', 'tail'] } } },
    );
    const frontGrid = grid(blueprintRenderedNodeDimensions(front, 200));
    const rearGrid = grid(rearDimensions);
    expect(rearGrid.positions.get('unit')?.height).toBe(150);
    expect(frontGrid.positions.get('tail')!.y - rearGrid.positions.get('tail')!.y).toBe(150);

    expect(blueprintFace({ ...blueprint, panels: [panel('A', 0, 'REAR')] }, 'FRONT')).toBeUndefined();
    expect(blueprintFace({ ...blueprint, panels: [panel('A', 0), panel('B', 1)] }, 'REAR')).toBeUndefined();
    const empty = blueprintFace({ ...blueprint, panels: blueprint.panels.map(item => ({ ...item, face: 'FRONT' })) }, 'REAR')!.visibleBlueprint;
    expect(empty.panels).toEqual([]);
    expect(empty.slots).toEqual([]);
    expect(blueprintRenderedNodeDimensions(empty, 200)).toEqual({ width: 124, height: 24 });
  });
});
