import { describe, expect, it } from 'vitest';
import { blueprintRenderedNodeDimensions } from './blueprintDisplaySize';
import { uniformGridPresentation } from './uniformGridPresentation';
import { blueprintFace, resolveFaces, selectedCableIdFor, temporaryFacesFor } from './physicalFaces';
import type { LocationDocument, LocationRef } from './locationTypes';
import type { MapLocationState, MapPlacement, PhysicalFace } from './savedMapTypes';
import { physicalTraceOverlayFor } from './interfacePhysicalTraceOverlay';
import type { PhysicalObjectL1TraceArtifact } from './physicalObjectL1TraceTypes';
import type { BlueprintPresentation, TopologyProjectionDocument } from './types';

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

describe('temporary physical views', () => {
  const canonical = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });
  const pair = (from: string, to: string, member: string, cable?: string) => ({
    from_connection_point_id: from, from_member_index: 1, to_connection_point_id: to, to_member_index: 1,
    connection_id: 'connection-' + member, connection_member_id: member,
    cable_ref: cable ? canonical('Cable', cable) : undefined,
  });
  const object = (id: string) => {
    const panels = ['FRONT', 'REAR', null].map((face, index) => ({
      panel_key: String(index), panel_number: index + 1, display_name: String(index), x: 0, y: index * 20,
      width: 100, height: 20, face: face as PhysicalFace | null,
    }));
    const point = { x: .5, y: .5 };
    return {
      id, kind: 'PHYSICAL_OBJECT', label: id, source_refs: [canonical('PhysicalObject', id)],
      attributes: {
        blueprint_presentation: {
          blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'template' },
          version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'revision' },
          body: { kind: 'RECTANGLE', width: 100, height: 60 }, panels,
          slots: ['front', 'rear', 'other'].map((suffix, i) => ({
            slot_key: suffix, connection_point_id: id + '-' + suffix, display_name: suffix, panel_key: String(i),
            kind: 'CONNECTION_POINT', panel_local_position: point,
            rendered_position: { ...point, y: (i + .5) / 3 }, external_attachment: { ...point, side: 'RIGHT' },
          })),
        } satisfies BlueprintPresentation,
        internal_l1_links: [{ ...pair(id + '-front', id + '-rear', 'inside-' + id), source_refs: [] }],
      },
    };
  };
  const edge = (from: string, to: string, endpoint: ReturnType<typeof pair>) => ({
    id: endpoint.connection_id, from_node_id: from, to_node_id: to, kind: 'L1_PHYSICAL_LINK', aggregate: true,
    source_refs: [canonical('ConnectionMember', endpoint.connection_member_id)], attributes: { endpoint_pairs: [endpoint] },
  });
  const document: TopologyProjectionDocument = {
    schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', gaps: [], warnings: [],
    nodes: ['a', 'b', 'c'].map(object),
    edges: [
      edge('a', 'b', pair('a-front', 'b-rear', 'external', 'first')),
      edge('a', 'b', pair('a-front', 'b-other', 'unassigned', 'already-visible')),
      edge('b', 'b', pair('b-front', 'b-rear', 'loop', 'same-object')),
    ],
  };
  const configured = resolveFaces('FRONT', [], [], ['a', 'b', 'c'].map(id => placement(id))).objectFaces;
  it('reveals only the selected Cable endpoint sides, including BOTH on one object', () => {
    const selected = selectedCableIdFor({ type: 'node', item: {
      id: 'inspector-item', kind: 'CABLE', label: 'Cable', source_refs: [canonical('Cable', 'first')], attributes: {},
    } });
    expect(temporaryFacesFor(document, configured, selected)).toEqual(new Map([['b', { face: 'REAR', reason: 'cable' }]]));
    expect(temporaryFacesFor(document, configured, 'already-visible').size).toBe(0);
    expect(temporaryFacesFor(document, configured, 'same-object')).toEqual(new Map([['b', { face: 'BOTH', reason: 'cable' }]]));
    expect(temporaryFacesFor(document, configured, null).size).toBe(0);
    expect(configured.get('b')?.face).toBe('FRONT');
  });

  it('uses only exact member evidence of the chosen trace branch and takes priority over Cable', () => {
    const branch = (id: string, member: string, target: string) => ({
      branch_id: id, source: { point_id: 'a-front', member_index: 1 }, target: { point_id: target, member_index: 1 },
      edge_ids: [], evidence_refs: [canonical('ConnectionMember', member)],
    });
    const artifact: PhysicalObjectL1TraceArtifact = {
      schema_version: 1, query: { from_physical_object_id: 'a', to_physical_object_id: 'b' },
      verdict: 'REACHABLE', branches: [branch('internal', 'inside-b', 'b-front'), branch('alternate', 'external', 'b-rear')],
      source_candidates: [], target_candidates: [], cycles: [], nodes: [], edges: [],
      evidence_refs: [canonical('ConnectionMember', 'inside-c')], gaps: [], warnings: [],
    };
    for (const [id, face] of [['internal', 'BOTH'], ['alternate', 'REAR']] as const) {
      const trace = physicalTraceOverlayFor(artifact, document, id);
      expect(temporaryFacesFor(document, configured, 'same-object', trace.highlightedConnectionPointIds))
        .toEqual(new Map([['b', { face, reason: 'trace' }]]));
      expect(trace.highlightedConnectionPointIds.has('b-other')).toBe(false);
      expect(trace.highlightedConnectionPointIds.has('c-rear')).toBe(false);
    }
    for (const [verdict, id] of [['UNKNOWN', 'internal'], ['REACHABLE', 'missing']] as const) {
      const trace = physicalTraceOverlayFor({ ...artifact, verdict }, document, id);
      expect(trace.highlightedConnectionPointIds.size).toBe(0);
    }
  });
});
