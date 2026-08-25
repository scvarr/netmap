import { describe, expect, it } from 'vitest';
import { physicalTraceOverlayFor } from './interfacePhysicalTraceOverlay';
import type { PhysicalObjectL1TraceArtifact } from './physicalObjectL1TraceTypes';
import type { TopologyProjectionDocument } from './types';
const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });
const physical: TopologyProjectionDocument = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', gaps: [], warnings: [], nodes: [{ id: 'a', kind: 'PHYSICAL_OBJECT', label: 'A', source_refs: [ref('PhysicalObject', 'a')], attributes: {} }, { id: 'b', kind: 'PHYSICAL_OBJECT', label: 'B', source_refs: [ref('PhysicalObject', 'b')], attributes: {} }, { id: 'c', kind: 'PHYSICAL_OBJECT', label: 'C', source_refs: [ref('PhysicalObject', 'c')], attributes: {} }], edges: [{ id: 'a-b', from_node_id: 'a', to_node_id: 'b', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [ref('Connection', 'one')], attributes: {} }, { id: 'b-c', from_node_id: 'b', to_node_id: 'c', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [ref('Connection', 'two')], attributes: {} }] };
const artifact = (verdict: 'REACHABLE' | 'UNKNOWN' = 'REACHABLE'): PhysicalObjectL1TraceArtifact => ({ schema_version: 1, query: { from_physical_object_id: 'a', to_physical_object_id: 'c' }, verdict, source_candidates: [], target_candidates: [], branches: [{ branch_id: 'first', source: { point_id: 'p1', member_index: 1 }, target: { point_id: 'p2', member_index: 1 }, edge_ids: ['one'], evidence_refs: [] }, { branch_id: 'second', source: { point_id: 'p3', member_index: 1 }, target: { point_id: 'p4', member_index: 1 }, edge_ids: ['two'], evidence_refs: [] }], cycles: [], nodes: [], edges: [{ id: 'one', from_node_id: 'x', to_node_id: 'y', evidence_refs: [ref('Connection', 'one')] }, { id: 'two', from_node_id: 'y', to_node_id: 'z', evidence_refs: [ref('Connection', 'two')] }], evidence_refs: [], gaps: [], warnings: [] });
describe('physicalTraceOverlayFor', () => {
  it('maps only selected branch canonical evidence to projection refs', () => { expect(physicalTraceOverlayFor(artifact(), physical, 'first').highlightedEdgeIds).toEqual(new Set(['a-b'])); });
  it('changes overlays between alternatives without rerunning trace data', () => { const result = artifact(); expect(physicalTraceOverlayFor(result, physical, 'second').highlightedEdgeIds).toEqual(new Set(['b-c'])); });
  it('never creates an overlay for UNKNOWN', () => { expect(physicalTraceOverlayFor(artifact('UNKNOWN'), physical, 'first').highlightedEdgeIds).toEqual(new Set()); });
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
});
