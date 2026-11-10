import { act, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DeviceNode } from './DeviceNode';
import { ForegroundCableRoutes } from './FloatingTopologyEdge';
import { RuntimePortTypes } from './RuntimePortTypes';
import css from '../styles.css?raw';

let nodes: any[] = [];
vi.mock('@xyflow/react', () => ({
  Handle: () => null, NodeResizer: () => null,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  useNodes: () => nodes,
  useInternalNode: (id: string) => nodes.find(n => n.id === id),
  useViewport: () => ({ zoom: 1 }),
  useReactFlow: () => ({ screenToFlowPosition: (p: any) => p, flowToScreenPosition: (p: any) => p }),
  ViewportPortal: ({ children }: any) => children,
}));
afterEach(() => vi.restoreAllMocks());
const catalog = [
  { id: 'active', name: 'Copper', color: '#123456', is_active: true },
  { id: 'archived', name: 'Fiber', color: '#ab4567', is_active: false },
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
const cable: any = { id: 'cable', source: 'object', target: 'object', data: { cableNode: { id: 'cable' } } };

it.each([false, true])('keeps the visible top layer typed through cable lifecycle, trace, wiring and projection replacement (catalog late=%s)', async late => {
  let resolve!: (value: any) => void;
  const response = { ok: true, json: async () => catalog } as Response;
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => late ? new Promise(r => { resolve = r; }) : Promise.resolve(response));
  nodes = [makeNode()];
  const scene = (edges: any[] = [], state?: string) => {
    nodes[0].data.physicalPortStates = state ? { p0: state, p1: state, p2: state } : undefined;
    return <RuntimePortTypes><style>{css}</style><DeviceNode {...{ data: nodes[0].data, selected: true, width: 200 } as any} /><ForegroundCableRoutes edges={edges} physicalPortStates={nodes[0].data.physicalPortStates} /></RuntimePortTypes>;
  };
  const view = render(scene());
  const check = (foreground: boolean) => {
    const selector = foreground ? '.cable-route-port-marker' : '.blueprint-map-node__port';
    const markers = [...view.container.querySelectorAll(selector)];
    expect(markers).toHaveLength(3);
    markers.forEach((marker, i) => {
      expect(getComputedStyle(marker)[foreground ? 'fill' : 'backgroundColor']).toBe(['rgb(18, 52, 86)', 'rgb(171, 69, 103)', 'rgb(24, 56, 58)'][i]);
      if (foreground) expect(marker.tagName).toBe(i === 1 ? 'circle' : 'rect');
      else expect(getComputedStyle(marker).borderRadius).toBe(i === 1 ? '50%' : '1px');
    });
    if (foreground) {
      expect(getComputedStyle(view.container.querySelector('.cable-routes-foreground')!).zIndex).toBe('1001');
      expect(view.container.querySelector('.cable-route-port-markers')!.previousElementSibling).toHaveAttribute('data-testid', 'foreground-cable-cable');
    }
  };
  if (late) {
    view.rerender(scene([cable]));
    nodes = [makeNode()]; // projection may arrive before the catalog
    view.rerender(scene([cable]));
    await act(async () => resolve(response));
    await waitFor(() => check(true));
    view.rerender(scene());
  }
  await waitFor(() => check(false));
  view.rerender(scene([cable])); check(true);
  for (const state of ['eligible', 'source', 'destination', 'unavailable']) {
    nodes = [makeNode()]; // fresh projection, same canonical assignments
    nodes[0].data.traceHighlighted = true;
    view.rerender(scene([{ ...cable, data: { ...cable.data, cablePresentationEmphasis: 'traced', cableRoute: { waypoints: [{ x: 250, y: 50 }] } } }], state));
    check(true); check(false);
  }
  view.rerender(scene([])); check(false);
  // Another cable keeps the foreground layer alive after deleting this cable.
  view.rerender(scene([{ ...cable, id: 'other', source: 'absent', target: 'absent' }]));
  expect(view.container.querySelectorAll('.cable-route-port-marker')).toHaveLength(3);
  expect(getComputedStyle(view.container.querySelector('.cable-route-port-marker')!).fill).toBe('rgb(18, 52, 86)');
});
