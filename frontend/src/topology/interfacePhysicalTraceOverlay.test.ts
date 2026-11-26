import { describe, expect, it } from 'vitest';
import { exactTraceOverlayFor, physicalTraceOverlayFor } from './interfacePhysicalTraceOverlay';
import type { PhysicalObjectL1TraceArtifact } from './physicalObjectL1TraceTypes';
import type { TopologyProjectionDocument } from './types';
import type { OpticalDiagnostic, OpticalFact } from './opticalDiagnostic';
const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });
const physical: TopologyProjectionDocument = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', gaps: [], warnings: [], nodes: [{ id: 'a', kind: 'PHYSICAL_OBJECT', label: 'A', source_refs: [ref('PhysicalObject', 'a')], attributes: {} }, { id: 'b', kind: 'PHYSICAL_OBJECT', label: 'B', source_refs: [ref('PhysicalObject', 'b')], attributes: {} }, { id: 'c', kind: 'PHYSICAL_OBJECT', label: 'C', source_refs: [ref('PhysicalObject', 'c')], attributes: {} }], edges: [{ id: 'a-b', from_node_id: 'a', to_node_id: 'b', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [ref('ConnectionMember', 'one')], attributes: {} }, { id: 'b-c', from_node_id: 'b', to_node_id: 'c', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [ref('ConnectionMember', 'two')], attributes: {} }] };
const artifact = (verdict: 'REACHABLE' | 'UNKNOWN' = 'REACHABLE'): PhysicalObjectL1TraceArtifact => ({ schema_version: 1, query: { from_physical_object_id: 'a', to_physical_object_id: 'c' }, verdict, source_candidates: [], target_candidates: [], branches: [{ branch_id: 'first', source: { point_id: 'p1', member_index: 1 }, target: { point_id: 'p2', member_index: 1 }, edge_ids: ['one'], evidence_refs: [] }, { branch_id: 'second', source: { point_id: 'p3', member_index: 1 }, target: { point_id: 'p4', member_index: 1 }, edge_ids: ['two'], evidence_refs: [] }], cycles: [], nodes: [], edges: [{ id: 'one', from_node_id: 'x', to_node_id: 'y', evidence_refs: [ref('ConnectionMember', 'one')] }, { id: 'two', from_node_id: 'y', to_node_id: 'z', evidence_refs: [ref('ConnectionMember', 'two')] }], evidence_refs: [], gaps: [], warnings: [] });
describe('physicalTraceOverlayFor', () => {
  it('maps only selected branch canonical evidence to projection refs', () => { expect(physicalTraceOverlayFor(artifact(), physical, 'first').highlightedEdgeIds).toEqual(new Set(['a-b'])); });
  it('changes overlays between alternatives without rerunning trace data', () => { const result = artifact(); expect(physicalTraceOverlayFor(result, physical, 'second').highlightedEdgeIds).toEqual(new Set(['b-c'])); });
  it('never creates an overlay for UNKNOWN', () => { expect(physicalTraceOverlayFor(artifact('UNKNOWN'), physical, 'first').highlightedEdgeIds).toEqual(new Set()); });
  it('ignores a neighboring aggregate and its remote object when they share a point on another member', () => {
    const shared = ref('ConnectionPoint', 'shared');
    const used = {
      from_connection_point_id: 'p1', from_member_index: 1,
      to_connection_point_id: 'shared', to_member_index: 1,
      connection_id: 'used', connection_member_id: 'one', cable_ref: ref('Cable', 'used-cable'),
    };
    const neighbor = {
      from_connection_point_id: 'shared', from_member_index: 2,
      to_connection_point_id: 'p3', to_member_index: 1,
      connection_id: 'neighbor', connection_member_id: 'two', cable_ref: ref('Cable', 'neighbor-cable'),
    };
    const document = {
      ...physical,
      edges: [used, neighbor].map((pair, index) => ({
        ...physical.edges[index],
        source_refs: [shared, ref('ConnectionMember', pair.connection_member_id), pair.cable_ref],
        attributes: { endpoint_pairs: [pair] },
      })),
    };
    const result = artifact();
    result.branches[0] = { ...result.branches[0], target: { point_id: 'shared', member_index: 1 } };
    result.nodes = [{ id: 'y', canonical_refs: [shared] }];
    result.edges[0].evidence_refs.push(shared, ref('Connection', 'used'), used.cable_ref);

    const overlay = physicalTraceOverlayFor(result, document, 'first');
    expect(overlay.highlightedEdgeIds).toEqual(new Set(['a-b']));
    expect(overlay.highlightedNodeIds).toEqual(new Set(['a', 'b']));
    expect(overlay.highlightedConnectionMemberIds).toEqual(new Set(['one']));
    expect(overlay.highlightedCableIds).toEqual(new Set(['used-cable']));
    expect(overlay.highlightedConnectionPointIds).toEqual(new Set(['p1', 'shared']));
  });
  it('maps exact internal ConnectionMember evidence without highlighting sibling panel links', () => {
    const document = {
      ...physical,
      nodes: [{
        id: 'panel', kind: 'PHYSICAL_OBJECT', label: 'PP1', source_refs: [ref('PhysicalObject', 'panel')],
        attributes: { internal_l1_links: [
          { from_connection_point_id: 'front-01', from_member_index: 1, to_connection_point_id: 'rear-01', to_member_index: 1, connection_id: 'panel-connection', connection_member_id: 'member-1', source_refs: [] },
          { from_connection_point_id: 'front-02', from_member_index: 1, to_connection_point_id: 'rear-02', to_member_index: 1, connection_id: 'panel-connection', connection_member_id: 'member-2', source_refs: [] },
        ] },
      }],
    } satisfies TopologyProjectionDocument;
    const result = artifact();
    result.branches[0] = { ...result.branches[0], edge_ids: [], evidence_refs: [ref('ConnectionMember', 'member-1')] };
    const overlay = physicalTraceOverlayFor(result, document, 'first');
    expect(overlay.highlightedConnectionMemberIds).toEqual(new Set(['member-1']));
    expect(overlay.highlightedNodeIds).toEqual(new Set(['panel']));
  });
  it('identifies only the exact Cable when parallel Cables share one projection edge', () => {
    const document = {
      ...physical,
      edges: [{
        id: 'a-b', from_node_id: 'a', to_node_id: 'b', kind: 'L1_PHYSICAL_LINK', aggregate: true,
        source_refs: [ref('Connection', 'connection-one'), ref('Connection', 'connection-two')],
        attributes: { endpoint_pairs: [
          { from_connection_point_id: 'a-1', from_member_index: 1, to_connection_point_id: 'b-1', to_member_index: 1, connection_id: 'connection-one', connection_member_id: 'member-one', cable_ref: ref('Cable', 'cable-one') },
          { from_connection_point_id: 'a-2', from_member_index: 1, to_connection_point_id: 'b-2', to_member_index: 1, connection_id: 'connection-two', connection_member_id: 'member-two', cable_ref: ref('Cable', 'cable-two') },
        ] },
      }],
    } satisfies TopologyProjectionDocument;
    const result = artifact();
    result.branches[0] = { ...result.branches[0], evidence_refs: [], edge_ids: ['one'] };
    result.edges[0] = { ...result.edges[0], evidence_refs: [ref('Connection', 'connection-one'), ref('ConnectionMember', 'member-one')] };

    expect(physicalTraceOverlayFor(result, document, 'first').highlightedCableIds)
      .toEqual(new Set(['cable-one']));
  });
});


it('projects one DIRECT_CONNECTION member and reveals faces without coloring shared point markers', () => {
  const first = {
    from_connection_point_id: 'rear', from_member_index: 1, to_connection_point_id: 'front', to_member_index: 2,
    connection_id: 'direct', connection_member_id: 'first',
  };
  const second = { ...first, from_member_index: 2, to_member_index: 1, connection_member_id: 'second' };
  const document = {
    ...physical,
    edges: [{
      ...physical.edges[0],
      source_refs: [ref('Connection', 'direct'), ref('ConnectionMember', 'first'), ref('ConnectionMember', 'second')],
      attributes: { endpoint_pairs: [first, second] },
    }],
  };
  const result = {
    edges: [{
      id: 'proven', from_node_id: 'actual-from', to_node_id: 'actual-to',
      evidence_refs: [ref('Connection', 'direct'), ref('ConnectionMember', 'first'),
        ref('ConnectionPoint', 'rear'), ref('ConnectionPoint', 'front')],
    }],
  };
  const overlay = exactTraceOverlayFor(result, document);
  expect(overlay.highlightedConnectionMemberIds).toEqual(new Set(['first']));
  expect(overlay.highlightedCableIds.size).toBe(0);
  expect(overlay.faceConnectionPointIds).toEqual(new Set(['rear', 'front']));
  expect(overlay.highlightedConnectionPointIds.size).toBe(0);
  expect(exactTraceOverlayFor({ edges: [] }, document).highlightedEdgeIds.size).toBe(0);
});

it('marks the exact interval and local transition, and removes optical evidence on branch switch', () => {
  const result = artifact();
  const point = (point_id: string, member_index = 1) => ({ point_id, member_index });
  const document = structuredClone(physical);
  document.nodes[0].attributes.connection_points = [
    { connection_point_id: 'junction', display_name: 'J', cardinality: 1, external_connection_count: 1 },
    { connection_point_id: 'shared', display_name: 'S', cardinality: 2, external_connection_count: 1 },
  ];
  result.edges[0].evidence_refs.push(ref('Cable', 'first-cable'));
  result.edges[1].evidence_refs.push(ref('Cable', 'second-cable'));
  const fact = (value: OpticalFact['value'], points: OpticalFact['points'], edge?: typeof result.edges[number]): OpticalFact =>
    ({ value, points, source: edge ? 'CABLE' : 'TRANSCEIVER', trace_edge_id: edge?.id, canonical_refs: edge?.evidence_refs ?? [] });
  const diagnostic: OpticalDiagnostic = {
    status: 'CONFLICT',
    facts: [
      fact('SM', [point('junction')]),
      fact('MM', [point('junction'), point('shared', 2)], result.edges[0]),
      fact(null, [point('shared', 2), point('end')], result.edges[1]),
      fact('SM', [point('end')]),
    ],
    conflicts: [
      { kind: 'LOCAL', left_fact: 0, right_fact: 1, unknown_facts: [] },
      { kind: 'END_TO_END', left_fact: 1, right_fact: 3, unknown_facts: [2] },
    ],
  };
  result.branches[0].edge_ids = ['one', 'two'];
  result.branches[0].optical_diagnostic = diagnostic;
  result.branches[1].optical_diagnostic = { status: 'CONSISTENT', facts: [fact('MM', [point('shared', 1)], result.edges[1])], conflicts: [] };
  const selected = physicalTraceOverlayFor(result, document, 'first');
  expect(selected.opticalLocalPointIds).toEqual(new Set(['junction']));
  expect(selected.opticalCableHighlights).toEqual(new Map([['first-cable', 'END_TO_END'], ['second-cable', 'UNKNOWN']]));
  expect(physicalTraceOverlayFor(result, document, 'second').opticalCableHighlights?.size).toBe(0);
  const incomplete = exactTraceOverlayFor({
    edges: [result.edges[0]], optical_diagnostics: [{ ...diagnostic, reason: 'INCOMPLETE_PATH' }],
  }, document);
  expect(incomplete.opticalCableHighlights?.has('second-cable')).toBe(false);
  result.verdict = 'UNKNOWN';
  result.cycles = [{ cycle_id: 'cycle', state_node_ids: ['x', 'y'], edge_ids: ['one', 'two'],
    evidence_refs: [], optical_diagnostic: diagnostic }];
  expect(physicalTraceOverlayFor(result, document, 'first').opticalCableHighlights).toBeUndefined();
  expect(physicalTraceOverlayFor(result, document, 'cycle').opticalLocalPointIds).toEqual(new Set(['junction']));
});
