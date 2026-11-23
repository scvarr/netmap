import { act, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DeviceNode } from './DeviceNode';
import { ForegroundCableRoutes } from './FloatingTopologyEdge';
import { RuntimePortTypes } from './RuntimePortTypes';
import { cableOccupiedPortIds } from '../topology/physicalPortPresentation';
import type { PhysicalEndpointPair, TopologyProjectionDocument } from '../topology/types';
import css from '../styles.css?raw';

let nodes: any[] = [];
vi.mock('@xyflow/react', () => ({
  Handle: () => null, NodeResizeControl: () => null,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  useNodes: () => nodes,
  useInternalNode: (id: string) => nodes.find(n => n.id === id),
  useViewport: () => ({ zoom: 1 }),
  useReactFlow: () => ({ screenToFlowPosition: (p: any) => p, flowToScreenPosition: (p: any) => p }),
  ViewportPortal: ({ children }: any) => children,
}));
afterEach(() => vi.restoreAllMocks());
const catalog = [
  { id: 'active', name: 'Copper', color: '#123456', is_active: true, medium: 'COPPER', members: ['1'], cardinality: 1, fiber_mode: null, compatibility_mode: 'UNDEFINED' },
  { id: 'archived', name: 'Fiber', color: '#ab4567', is_active: false, medium: 'COPPER', members: ['1'], cardinality: 1, fiber_mode: null, compatibility_mode: 'UNDEFINED' },
];
const makeNode = () => ({
  id: 'object', position: { x: 0, y: 0 }, internals: { positionAbsolute: { x: 0, y: 0 } }, measured: { width: 200, height: 120 },
  data: { projection: { id: 'object', kind: 'PHYSICAL_OBJECT', label: 'Object', source_refs: [], attributes: {
    blueprint_presentation: { body: { width: 200, height: 100 },
      panels: [{ panel_key: 'front', display_name: 'Front', x: 0, y: 0, width: 200, height: 100 }],
      slots: ['active', 'archived', undefined].map((type, i) => ({
        slot_key: `p${i}`, connection_point_id: `p${i}`, display_name: `Port ${i}`, port_type_id: type,
        kind: i === 1 ? 'CONNECTION_POINT' : 'NETWORK_PORT', panel_key: 'front',
        panel_local_position: { x: .2 + i * .3, y: .5 }, rendered_position: { x: .2 + i * .3, y: .5 },
        external_attachment: { x: 1, y: .5, side: 'RIGHT' },
      })),
    },
  } } },
});
const pair = (from: string, to: string, cableId?: string): PhysicalEndpointPair => ({
  from_connection_point_id: from, to_connection_point_id: to,
  from_member_index: 1, to_member_index: 1,
  connection_id: cableId ?? 'direct', connection_member_id: cableId ?? 'direct',
  cable_ref: cableId ? { ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: cableId } : undefined,
});

const projectionFor = (pairs: PhysicalEndpointPair[]): TopologyProjectionDocument => ({
  schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [], gaps: [], warnings: [],
  edges: [{ id: 'edge', from_node_id: 'object', to_node_id: 'generic', kind: 'L1_PHYSICAL_LINK',
    aggregate: true, source_refs: [], attributes: { endpoint_pairs: pairs } }],
});

const makeGeneric = () => ({
  id: 'generic', position: { x: 350, y: 0 }, internals: { positionAbsolute: { x: 350, y: 0 } },
  measured: { width: 212, height: 144 },
  data: { projection: { id: 'generic', kind: 'PHYSICAL_OBJECT', label: 'Generic', source_refs: [], attributes: {
    connection_points: ['g0', 'g1'].map(id => ({
      connection_point_id: id, display_name: id, cardinality: 1, external_connection_count: 1,
    })),
  } } },
});

it('derives occupancy from exact local and off-map Cable refs', () => {
  const document = projectionFor([
    pair('a', 'b', 'cable'), pair('direct-a', 'direct-b'),
    { ...pair('mock-a', 'mock-b'), cable_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'Cable', entity_id: 'mock' } },
  ]);
  const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT', entity_type, entity_id });
  document.l1_off_map_continuations = [{
    id: 'continuation', local_node_id: 'object', local_physical_object_ref: ref('PhysicalObject', 'object'),
    local_connection_point_ref: ref('ConnectionPoint', 'local'), local_connection_point_display_name: 'Local',
    cable_ref: ref('Cable', 'off-map'), cable_display_name: 'Remote link',
    remote_physical_object_ref: ref('PhysicalObject', 'remote-object'), remote_display_name: 'Remote',
    remote_connection_point_ref: ref('ConnectionPoint', 'remote'), remote_connection_point_display_name: 'Remote point',
    source_refs: [],
  }];
  expect([...cableOccupiedPortIds(document)]).toEqual(['a', 'b', 'local']);
});

const rgb = (color: string) => {
  const span = document.createElement('span');
  span.style.color = color;
  return span.style.color;
};

it.each([false, true])('paints both layers from refreshed Cable evidence, including late PortTypes (%s)', async late => {
  let resolve!: (value: Response) => void;
  const response = { ok: true, json: async () => catalog } as Response;
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => late ? new Promise(r => { resolve = r; }) : Promise.resolve(response));

  const scene = (pairs: PhysicalEndpointPair[] = [], wiring: Record<string, 'source' | 'destination' | 'unavailable'> = {}, traced = false) => {
    nodes = [makeNode(), makeGeneric()];
    const occupied = cableOccupiedPortIds(projectionFor(pairs));
    const internal = { ...pair('p0', 'p1'), source_refs: [] };
    nodes[0].data.projection.attributes.internal_l1_links = [internal];
    for (const node of nodes) {
      node.data.cableOccupiedPortIds = occupied;
      node.data.physicalPortStates = wiring;
      node.data.traceHighlightedConnectionMemberIds = traced ? new Set([internal.connection_member_id]) : undefined;
    }
    return <RuntimePortTypes><style>{css}</style>
      {nodes.map(node => <DeviceNode key={node.id} {...node} selected width={node.measured.width} />)}
      <ForegroundCableRoutes edges={[]} physicalPortStates={wiring} />
    </RuntimePortTypes>;
  };
  const view = render(scene());
  const check = (id: string, shape: 'circle' | 'rect', fill: string, outline: string) => {
    const markers = view.container.querySelectorAll('[data-connection-point-id="' + id + '"]');
    expect(markers).toHaveLength(2);
    const [base, overlay] = Array.from(markers, marker => getComputedStyle(marker));
    expect(base.backgroundColor).toBe(rgb(fill));
    expect(base.borderTopColor).toBe(rgb(outline));
    expect(rgb(overlay.fill)).toBe(rgb(fill));
    expect(rgb(overlay.stroke)).toBe(rgb(outline));
    expect(markers[1].tagName).toBe(shape);
  };
  if (late) {
    check('p0', 'rect', '#0a1518', '#18383a');
    await act(async () => resolve(response));
  }
  await waitFor(() => check('p0', 'rect', '#0a1518', '#123456'));
  check('p1', 'circle', '#0a1518', '#ab4567');
  check('p2', 'rect', '#0a1518', '#18383a');
  check('g0', 'circle', '#0a1518', '#18383a');

  view.rerender(scene([], { p0: 'source', p1: 'destination', g0: 'unavailable' }));
  check('p0', 'rect', '#0a1518', '#fff');
  check('p1', 'circle', '#0a1518', '#fff');
  expect(getComputedStyle(view.container.querySelector('.cable-route-port-marker[data-connection-point-id="g0"]')!).opacity).toBe('0.35');
  view.rerender(scene());
  check('p0', 'rect', '#0a1518', '#123456');

  const first = pair('p0', 'g0', 'created');
  const second = pair('p0', 'g1', 'another');
  const circleCable = pair('p1', 'other-panel-port', 'circle-cable');
  view.rerender(scene([first, second, circleCable], {}, true));
  check('p0', 'rect', '#123456', '#fff2bc');
  check('p1', 'circle', '#ab4567', '#fff2bc');
  check('g0', 'circle', '#18383a', '#e6fffb');
  view.rerender(scene([first, second, circleCable], { p0: 'source', p1: 'destination' }, true));
  check('p0', 'rect', '#123456', '#fff');
  check('p1', 'circle', '#ab4567', '#fff');
  view.rerender(scene([second, circleCable]));
  check('p0', 'rect', '#123456', '#e6fffb');
  check('p1', 'circle', '#ab4567', '#e6fffb');
  check('g0', 'circle', '#0a1518', '#18383a');
  view.rerender(scene());
  check('p0', 'rect', '#0a1518', '#123456');
  check('p1', 'circle', '#0a1518', '#ab4567');
});
