import { describe, expect, it } from 'vitest';
import { presentationSceneDocument } from './presentationScene';
import type { TopologyProjectionDocument } from './types';

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });
const document = (pairs: TopologyProjectionDocument['edges'][number]['attributes']['endpoint_pairs'] = []): TopologyProjectionDocument => ({
  schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', gaps: [], warnings: [],
  nodes: [{ id: 'a', kind: 'PHYSICAL_OBJECT', label: 'A', source_refs: [], attributes: {} }, { id: 'b', kind: 'PHYSICAL_OBJECT', label: 'B', source_refs: [], attributes: {} }],
  edges: [{ id: 'ab', from_node_id: 'a', to_node_id: 'b', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [ref('Connection', 'connection')], attributes: { endpoint_pairs: pairs } }],
});

describe('presentationSceneDocument', () => {
  it('turns a cable-backed endpoint pair into a separate Cable scene edge with exact evidence', () => {
    const pair = { from_connection_point_id: 'a-1', from_member_index: 1, to_connection_point_id: 'b-1', to_member_index: 1, connection_id: 'connection', connection_member_id: 'member', cable_ref: ref('Cable', 'cable'), cable_display_name: 'C-1' };
    const source = document([pair]);
    const scene = presentationSceneDocument(source);

    expect(scene.edges).toMatchObject([{ id: 'collapsed-cable:cable', kind: 'cable', cableNode: { source_refs: [ref('Cable', 'cable')] }, endpointPair: { connection_member_id: 'member' }, projectionEdge: source.edges[0] }]);
  });

  it('keeps an ordinary endpoint pair as an ordinary scene edge', () => {
    const scene = presentationSceneDocument(document([{ from_connection_point_id: 'a-1', from_member_index: 1, to_connection_point_id: 'b-1', to_member_index: 1, connection_id: 'connection', connection_member_id: 'member' }]));
    expect(scene.edges).toMatchObject([{ id: 'ab::member::member', kind: 'projection', endpointPair: { connection_member_id: 'member' } }]);
  });

  it('keeps parallel Cables separate and preserves each Cable and ConnectionMember', () => {
    const scene = presentationSceneDocument(document([
      { from_connection_point_id: 'a-1', from_member_index: 1, to_connection_point_id: 'b-1', to_member_index: 1, connection_id: 'connection-one', connection_member_id: 'member-one', cable_ref: ref('Cable', 'cable-one') },
      { from_connection_point_id: 'a-2', from_member_index: 1, to_connection_point_id: 'b-2', to_member_index: 1, connection_id: 'connection-two', connection_member_id: 'member-two', cable_ref: ref('Cable', 'cable-two') },
    ]));
    expect(scene.edges).toMatchObject([
      { id: 'collapsed-cable:cable-one', cableNode: { source_refs: [ref('Cable', 'cable-one')] }, endpointPair: { connection_member_id: 'member-one' } },
      { id: 'collapsed-cable:cable-two', cableNode: { source_refs: [ref('Cable', 'cable-two')] }, endpointPair: { connection_member_id: 'member-two' } },
    ]);
  });

  it('merges multiple endpoint pairs for one Cable while retaining every member evidence', () => {
    const source = document([
      { from_connection_point_id: 'a-1', from_member_index: 1, to_connection_point_id: 'b-1', to_member_index: 1, connection_id: 'connection', connection_member_id: 'member-one', cable_ref: ref('Cable', 'cable') },
      { from_connection_point_id: 'a-2', from_member_index: 2, to_connection_point_id: 'b-2', to_member_index: 2, connection_id: 'connection', connection_member_id: 'member-two', cable_ref: ref('Cable', 'cable') },
    ]);
    const scene = presentationSceneDocument(source);
    const cableEdges = scene.edges.filter((edge) => edge.kind === 'cable');

    expect(cableEdges).toHaveLength(1);
    expect(new Set(scene.edges.map((edge) => edge.id)).size).toBe(scene.edges.length);
    expect(cableEdges[0]).toMatchObject({
      id: 'collapsed-cable:cable',
      endpointPair: { connection_member_id: 'member-one' },
      supportingProjectionEdgeIds: ['ab'],
      cableEvidence: [
        { endpointPair: { connection_member_id: 'member-one' }, projectionEdge: source.edges[0] },
        { endpointPair: { connection_member_id: 'member-two' }, projectionEdge: source.edges[0] },
      ],
    });
  });

  it('leaves L2 projection edges one-to-one even when they contain artificial endpoint pairs', () => {
    const source: TopologyProjectionDocument = {
      ...document([{ from_connection_point_id: 'a-1', from_member_index: 1, to_connection_point_id: 'b-1', to_member_index: 1, connection_id: 'connection', connection_member_id: 'member', cable_ref: ref('Cable', 'cable') }]),
      layer: 'L2', detail_level: 'DEVICE',
    };
    const scene = presentationSceneDocument(source);

    expect(scene.edges).toEqual([{ id: 'ab', source: 'a', target: 'b', kind: 'projection', projectionEdge: source.edges[0] }]);
    expect(scene.composites).toEqual([]);
  });

  it('keeps an off-map continuation as an evidence-backed presentation edge', () => {
    const source = document();
    source.l1_off_map_continuations = [{ id: 'continuation', local_node_id: 'a', local_physical_object_ref: ref('PhysicalObject', 'a'), local_connection_point_ref: ref('ConnectionPoint', 'a-1'), local_connection_point_display_name: 'A1', cable_ref: ref('Cable', 'cable'), cable_display_name: 'C-1', remote_physical_object_ref: ref('PhysicalObject', 'remote'), remote_display_name: 'Remote', remote_connection_point_ref: ref('ConnectionPoint', 'remote-1'), remote_connection_point_display_name: 'R1', source_refs: [ref('ConnectionMember', 'member')] }];
    expect(presentationSceneDocument(source).edges.at(-1)).toMatchObject({ id: 'off-map-continuation:continuation', kind: 'off-map-continuation', source: 'a', target: 'a', continuation: source.l1_off_map_continuations[0] });
  });
});
