import { describe, expect, it } from 'vitest';
import {
  LAYOUT_NODE_HEIGHT,
  LAYOUT_NODE_WIDTH,
  applyCollapsedCompositePresentation,
  compositeFrameGeometry,
  toFlowProjection,
} from './layout';
import { presentationSceneDocument } from './presentationScene';
import type { PresentationSceneDocument } from './presentationScene';
import type {
  TopologyDetailLevel,
  TopologyLayer,
  TopologyProjectionDocument,
  TopologyProjectionEdge,
} from './types';

const documentFor = (
  nodeIds: string[],
  pairs: Array<[string, string]>,
  layer: TopologyLayer = 'L2',
  detailLevel: TopologyDetailLevel = 'DEVICE',
): TopologyProjectionDocument => ({
  schema_version: '1.0',
  layer,
  detail_level: detailLevel,
  nodes: nodeIds.map((id) => ({
    id,
    kind: detailLevel === 'DEVICE' ? 'NETWORK_DEVICE' : 'PHYSICAL_OBJECT',
    label: id,
    source_refs: [],
    attributes: {},
  })),
  edges: pairs.map(([source, target], index): TopologyProjectionEdge => ({
    id: `edge-${index}-${source}-${target}`,
    from_node_id: source,
    to_node_id: target,
    kind: layer === 'L1' ? 'PHYSICAL_CONNECTION' : 'L2_DEVICE_LINK',
    aggregate: false,
    source_refs: [],
    attributes: {},
  })),
  gaps: [],
  warnings: [],
});

const position = async (document: TopologyProjectionDocument, id: string) => {
  const flow = await toFlowProjection(presentationSceneDocument(document));
  return flow.nodes.find((node) => node.id === id)!.position;
};

const bounds = async (document: TopologyProjectionDocument, ids: string[]) => {
  const flow = await toFlowProjection(presentationSceneDocument(document));
  const nodes = flow.nodes.filter((node) => ids.includes(node.id));
  return {
    left: Math.min(...nodes.map((node) => node.position.x)),
    right: Math.max(...nodes.map((node) => node.position.x + LAYOUT_NODE_WIDTH)),
    top: Math.min(...nodes.map((node) => node.position.y)),
    bottom: Math.max(...nodes.map((node) => node.position.y + LAYOUT_NODE_HEIGHT)),
  };
};

describe('ELK topology layout', () => {
  it('derives collapsed boundary children inside an effective presentation frame without changing their authoritative positions', () => {
    const a = { id: 'a', kind: 'PHYSICAL_OBJECT', label: 'A', source_refs: [], attributes: {} } as any;
    const b = { id: 'b', kind: 'PHYSICAL_OBJECT', label: 'B', source_refs: [], attributes: {} } as any;
    const frame = { id: 'map-composite:rack', kind: 'MAP_COMPOSITE', label: 'Rack', source_refs: [], attributes: { composite_id: 'rack', width: 280, height: 180 } } as any;
    const scene: PresentationSceneDocument = { layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [a, b, frame], edges: [{ id: 'bc', source: 'b', target: 'outside', kind: 'projection' }], composites: [{ id: 'rack', displayName: 'Rack', memberNodeIds: ['a', 'b'], boundaryNodeIds: ['a', 'b'], compositionBasis: 'presentation' }] };
    const result = applyCollapsedCompositePresentation({ nodes: [
      { id: 'a', type: 'device' as const, position: { x: 100, y: 600 }, width: 212, height: 144, data: { projection: a } },
      { id: 'b', type: 'device' as const, position: { x: 380, y: 640 }, width: 212, height: 144, data: { projection: b } },
      { id: frame.id, type: 'device' as const, position: { x: 30, y: 40 }, width: 280, height: 180, data: { projection: frame } },
    ], edges: [{ id: 'bc', source: 'b', target: 'outside', type: 'floating', data: {} }] }, scene);

    const derivedA = result.nodes.find((node) => node.id === 'a')!;
    const derivedB = result.nodes.find((node) => node.id === 'b')!;
    const derivedFrame = result.nodes.find((node) => node.id === frame.id)!;
    expect(derivedA).toMatchObject({ parentId: frame.id, extent: 'parent' });
    expect(derivedB).toMatchObject({ parentId: frame.id, extent: 'parent' });
    expect(derivedA.position.x).toBeLessThan(derivedB.position.x);
    expect(derivedFrame.width).toBe(512);
    expect(derivedFrame.height).toBe(238);
    expect(derivedA.position.x).toBeGreaterThanOrEqual(0);
    expect(derivedA.position.y).toBe(44);
    expect(derivedB.position.x + 212).toBeLessThanOrEqual(derivedFrame.width!);
    expect(derivedB.position.y + 144).toBeLessThanOrEqual(derivedFrame.height!);
    expect(result.edges[0]).toMatchObject({ source: 'b', target: 'outside' });
  });

  it('fits collapsed content below the header instead of retaining a stale oversized frame', () => {
    const frame = { id: 'map-composite:rack', kind: 'MAP_COMPOSITE', label: 'Rack', source_refs: [], attributes: { composite_id: 'rack', width: 280, height: 900 } } as any;
    const member = { id: 'boundary', kind: 'PHYSICAL_OBJECT', label: 'PP1', source_refs: [], attributes: {} } as any;
    const scene: PresentationSceneDocument = { layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [frame, member], edges: [], composites: [{ id: 'rack', displayName: 'Rack', memberNodeIds: ['boundary'], boundaryNodeIds: ['boundary'], compositionBasis: 'presentation' }] };
    const result = applyCollapsedCompositePresentation({ nodes: [
      { id: frame.id, type: 'composite' as const, position: { x: 10, y: 20 }, width: 280, height: 900, data: { projection: frame } },
      { id: member.id, type: 'device' as const, position: { x: 300, y: 400 }, width: 120, height: 50, data: { projection: member } },
    ], edges: [] }, scene);
    const derivedFrame = result.nodes.find((node) => node.id === frame.id)!;
    const derivedMember = result.nodes.find((node) => node.id === member.id)!;
    expect(derivedFrame).toMatchObject({ width: 200, height: 104 });
    expect(derivedMember.position).toEqual({ x: 40, y: 44 });
  });

  it('derives an expanded outline from all members without touching their positions', () => {
    const geometry = compositeFrameGeometry([
      { x: 100, y: 200, width: 120, height: 50 },
      { x: 500, y: 600, width: 300, height: 70 },
    ]);
    expect(geometry).toEqual({ x: 90, y: 156, width: 720, height: 524 });
  });

  it('receives already-formed scene edges without inspecting projection endpoint pairs', async () => {
    const scene: PresentationSceneDocument = {
      layer: 'L1', detail_level: 'PHYSICAL_OBJECT',
      nodes: documentFor(['A', 'B'], [], 'L1', 'PHYSICAL_OBJECT').nodes,
      edges: [{ id: 'displayed-cable', source: 'A', target: 'B', kind: 'cable' }],
      composites: [],
    };

    const flow = await toFlowProjection(scene);
    expect(flow.edges).toMatchObject([{ id: 'displayed-cable', data: { cableNode: undefined, endpointPair: undefined } }]);
  });

  it('places the middle node between both endpoints for A-X-B regardless of edge DTO direction', async () => {
    const document = documentFor(['A', 'X', 'B'], [['X', 'A'], ['B', 'X']]);
    const [a, x, b] = await Promise.all(['A', 'X', 'B'].map((id) => position(document, id)));

    expect(x.x).toBeGreaterThan(Math.min(a.x, b.x));
    expect(x.x).toBeLessThan(Math.max(a.x, b.x));
  });

  it('lays out a branch without overlapping X, B, and C', async () => {
    const flow = await toFlowProjection(presentationSceneDocument(documentFor(
      ['A', 'X', 'B', 'C'],
      [['A', 'X'], ['X', 'B'], ['X', 'C']],
    )));
    const x = flow.nodes.find((node) => node.id === 'X')!.position;
    const leaves = flow.nodes.filter((node) => ['B', 'C'].includes(node.id));

    expect(leaves.every((node) => node.position.x > x.x)).toBe(true);
    expect(Math.abs(leaves[0].position.y - leaves[1].position.y)).toBeGreaterThanOrEqual(
      LAYOUT_NODE_HEIGHT,
    );
  });

  it('packs disconnected components without overlap', async () => {
    const document = documentFor(
      ['A', 'B', 'C', 'D'],
      [['A', 'B'], ['C', 'D']],
    );
    const [first, second] = await Promise.all([
      bounds(document, ['A', 'B']),
      bounds(document, ['C', 'D']),
    ]);
    const separated = first.right <= second.left
      || second.right <= first.left
      || first.bottom <= second.top
      || second.bottom <= first.top;

    expect(separated).toBe(true);
  });

  it('places an isolated node as a separate non-overlapping component', async () => {
    const document = documentFor(['A', 'B', 'isolated'], [['A', 'B']]);
    const [connected, isolated] = await Promise.all([
      bounds(document, ['A', 'B']),
      bounds(document, ['isolated']),
    ]);

    expect(Number.isFinite(isolated.left)).toBe(true);
    expect(
      connected.right <= isolated.left
      || isolated.right <= connected.left
      || connected.bottom <= isolated.top
      || isolated.bottom <= connected.top,
    ).toBe(true);
  });

  it('is deterministic for identical projection input', async () => {
    const document = documentFor(
      ['C', 'A', 'X', 'B'],
      [['X', 'C'], ['B', 'X'], ['X', 'A']],
    );
    const first = await toFlowProjection(presentationSceneDocument(document));
    const second = await toFlowProjection(presentationSceneDocument(structuredClone(document)));

    expect(second.nodes.map(({ id, position: nodePosition }) => ({ id, nodePosition }))).toEqual(
      first.nodes.map(({ id, position: nodePosition }) => ({ id, nodePosition })),
    );
  });

  it('uses default display dimensions for Blueprints while generic nodes keep the fallback', async () => {
    const document = documentFor(['panel', 'cable', 'manual'], [], 'L1', 'PHYSICAL_OBJECT');
    document.nodes[0].attributes.blueprint_presentation = { blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'v' }, body: { kind: 'RECTANGLE', width: 480, height: 70 }, slots: [{ slot_key: 'front', display_name: 'Front', kind: 'CONNECTION_POINT', connection_point_id: 'front', rendered_position: { x: .5, y: .5 }, external_attachment: { x: .5, y: 0, side: 'TOP' } }] };
    document.nodes[1].attributes.blueprint_presentation = { ...document.nodes[0].attributes.blueprint_presentation, body: { kind: 'RECTANGLE', width: 120, height: 6 } };
    const flow = await toFlowProjection(presentationSceneDocument(document));
    expect(flow.nodes.find((node) => node.id === 'panel')).toMatchObject({ width: 240, height: 35 });
    expect(flow.nodes.find((node) => node.id === 'cable')).toMatchObject({ width: 240, height: 12 });
    expect(flow.nodes.find((node) => node.id === 'manual')).toMatchObject({ width: undefined, height: undefined });
  });

  it('keeps an off-map continuation as a presentation edge without adding a remote node', async () => {
    const document = documentFor(['local'], [], 'L1', 'PHYSICAL_OBJECT');
    document.l1_off_map_continuations = [{
      id: 'local-cable-remote', local_node_id: 'local',
      local_physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'local-object' },
      local_connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'local-port' },
      local_connection_point_display_name: 'Rear',
      cable_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: 'cable' }, cable_display_name: 'cable-17',
      remote_physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'remote-object' }, remote_display_name: 'PP1',
      remote_connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'remote-port' }, remote_connection_point_display_name: 'A07',
      source_refs: [],
    }];
    document.nodes[0].attributes.connection_points = [{ connection_point_id: 'local-port', display_name: 'Rear', cardinality: 1, external_connection_count: 1 }];

    const flow = await toFlowProjection(presentationSceneDocument(document));

    expect(flow.nodes.map((node) => node.id)).toEqual(['local']);
    expect(flow.edges).toMatchObject([{ id: 'off-map-continuation:local-cable-remote', source: 'local', target: 'local', type: 'continuation', data: { continuation: { cable_display_name: 'cable-17', remote_display_name: 'PP1' } } }]);
  });

  it.each([
    ['logical', 'L2', 'DEVICE'],
    ['physical', 'L1', 'PHYSICAL_OBJECT'],
  ] as const)('lays out %s projections through the same graph boundary', async (_, layer, detail) => {
    const flow = await toFlowProjection(presentationSceneDocument(documentFor(
      ['A', 'X', 'B'],
      [['A', 'X'], ['X', 'B']],
      layer,
      detail,
    )));

    expect(flow.nodes).toHaveLength(3);
    expect(flow.edges).toHaveLength(2);
    expect(flow.nodes.find((node) => node.id === 'X')!.position.x)
      .toBeGreaterThan(flow.nodes.find((node) => node.id === 'A')!.position.x);
  });
});
