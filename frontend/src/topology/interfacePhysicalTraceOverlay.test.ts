import { describe, expect, it } from 'vitest';
import { physicalTraceOverlayFor } from './interfacePhysicalTraceOverlay';
import type { InterfacePhysicalTraceArtifact } from './interfacePhysicalTraceTypes';
import type { TopologyProjectionDocument } from './types';

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });
const physical: TopologyProjectionDocument = {
  schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', gaps: [], warnings: [],
  nodes: [
    { id: 'a', kind: 'PHYSICAL_OBJECT', label: 'same label', source_refs: [ref('PhysicalObject', 'a')], attributes: {} },
    { id: 'b', kind: 'PHYSICAL_OBJECT', label: 'same label', source_refs: [ref('PhysicalObject', 'b')], attributes: {} },
    { id: 'c', kind: 'PHYSICAL_OBJECT', label: 'unrelated', source_refs: [ref('PhysicalObject', 'c')], attributes: {} },
  ],
  edges: [
    { id: 'proved-a-b', from_node_id: 'a', to_node_id: 'b', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [ref('Connection', 'connection-1')], attributes: {} },
    { id: 'proved-b-c', from_node_id: 'b', to_node_id: 'c', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [ref('Connection', 'connection-2')], attributes: {} },
    { id: 'unrelated', from_node_id: 'a', to_node_id: 'c', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [ref('Connection', 'connection-3')], attributes: {} },
  ],
};

const artifact = (branches: InterfacePhysicalTraceArtifact['branches'], verdict: 'REACHABLE' | 'UNKNOWN' = 'REACHABLE'): InterfacePhysicalTraceArtifact => ({
  schema_version: 1, query: { from_interface_id: 'source', to_interface_id: 'target' }, verdict, branches,
  nodes: [],
  edges: [
    { id: 'trace-1', from_node_id: 'n1', to_node_id: 'n2', evidence_refs: [ref('Connection', 'connection-1')] },
    { id: 'trace-2', from_node_id: 'n2', to_node_id: 'n3', evidence_refs: [ref('Connection', 'connection-2')] },
    { id: 'not-in-branch', from_node_id: 'n3', to_node_id: 'n4', evidence_refs: [ref('Connection', 'connection-3')] },
  ], gaps: [], warnings: [],
});

const branch = (edge_ids: string[]): InterfacePhysicalTraceArtifact['branches'][number] => ({
  branch_id: edge_ids.join('-'), source_candidate_id: 'source', target_candidate_id: 'target', edge_ids, evidence_refs: [],
});

describe('physicalTraceOverlayFor', () => {
  it('maps only branch-referenced public evidence to physical projection refs, never labels or geometry', () => {
    const overlay = physicalTraceOverlayFor(artifact([branch(['trace-1'])]), physical);
    expect(overlay.highlightedEdgeIds).toEqual(new Set(['proved-a-b']));
    expect(overlay.highlightedNodeIds).toEqual(new Set(['a', 'b']));
    expect(overlay.highlightedEdgeIds.has('unrelated')).toBe(false);
  });

  it('uses the truthful union when several reachable branches are returned', () => {
    const overlay = physicalTraceOverlayFor(artifact([branch(['trace-1']), branch(['trace-2'])]), physical);
    expect(overlay.highlightedEdgeIds).toEqual(new Set(['proved-a-b', 'proved-b-c']));
    expect(overlay.highlightedNodeIds).toEqual(new Set(['a', 'b', 'c']));
  });

  it('never creates an overlay for UNKNOWN', () => {
    const overlay = physicalTraceOverlayFor(artifact([branch(['trace-1'])], 'UNKNOWN'), physical);
    expect(overlay.highlightedEdgeIds).toEqual(new Set());
    expect(overlay.highlightedNodeIds).toEqual(new Set());
  });
});
