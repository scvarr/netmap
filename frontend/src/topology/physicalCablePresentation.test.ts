import { describe, expect, it } from 'vitest';
import { physicalCablePresentation } from './physicalCablePresentation';
import type { TopologyProjectionDocument } from './types';

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });

describe('physicalCablePresentation', () => {
  it('separates a canonical cable-backed direct edge without mutating the projection', () => {
    const document: TopologyProjectionDocument = {
      schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', gaps: [], warnings: [],
      nodes: [{ id: 'a', kind: 'PHYSICAL_OBJECT', label: 'A', source_refs: [], attributes: {} }, { id: 'b', kind: 'PHYSICAL_OBJECT', label: 'B', source_refs: [], attributes: {} }],
      edges: [{ id: 'ab', from_node_id: 'a', to_node_id: 'b', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: { endpoint_pairs: [{ from_connection_point_id: 'a', from_member_index: 1, to_connection_point_id: 'b', to_member_index: 1, connection_id: 'connection', connection_member_id: 'member', cable_ref: ref('Cable', 'cable') }] } }],
    };
    const before = structuredClone(document);
    const presentation = physicalCablePresentation(document);
    expect(presentation.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(presentation.edges).toEqual([]);
    expect(presentation.cables[0]).toMatchObject({ source: 'a', target: 'b', supportingEdgeIds: ['ab'] });
    expect(presentation.cables[0].cable.source_refs[0]).toEqual(ref('Cable', 'cable'));
    expect(document).toEqual(before);
  });

  it('keeps parallel Cables distinct when they share a projection edge', () => {
    const document: TopologyProjectionDocument = {
      schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', gaps: [], warnings: [],
      nodes: [{ id: 'a', kind: 'PHYSICAL_OBJECT', label: 'A', source_refs: [], attributes: {} }, { id: 'b', kind: 'PHYSICAL_OBJECT', label: 'B', source_refs: [], attributes: {} }],
      edges: [{ id: 'ab', from_node_id: 'a', to_node_id: 'b', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: { endpoint_pairs: [
        { from_connection_point_id: 'a-1', from_member_index: 1, to_connection_point_id: 'b-1', to_member_index: 1, connection_id: 'connection-one', connection_member_id: 'member-one', cable_ref: ref('Cable', 'cable-one') },
        { from_connection_point_id: 'a-2', from_member_index: 1, to_connection_point_id: 'b-2', to_member_index: 1, connection_id: 'connection-two', connection_member_id: 'member-two', cable_ref: ref('Cable', 'cable-two') },
      ] } }],
    };

    expect(physicalCablePresentation(document).cables).toMatchObject([
      { cable: { source_refs: [ref('Cable', 'cable-one')] }, supportingEdgeIds: ['ab'] },
      { cable: { source_refs: [ref('Cable', 'cable-two')] }, supportingEdgeIds: ['ab'] },
    ]);
  });
});
