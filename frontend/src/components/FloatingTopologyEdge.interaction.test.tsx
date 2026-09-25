import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FloatingTopologyEdge, ForegroundCableRoutes, WiringRoute, layoutGeometryFeedback } from './FloatingTopologyEdge';
import type { MapCableRouteWaypoint } from '../topology/savedMapTypes';

const markerPoints = ['eligible', 'source', 'destination', 'unavailable'].map((id) => ({ connection_point_id: id, display_name: id, cardinality: 1, external_connection_count: 0 }));
const source = { internals: { positionAbsolute: { x: 0, y: 0 } }, measured: { width: 100, height: 100 }, data: { projection: { id: 'source', kind: 'PHYSICAL_OBJECT', label: 'source', source_refs: [], attributes: { connection_points: markerPoints } } } };
const target = { internals: { positionAbsolute: { x: 300, y: 0 } }, measured: { width: 100, height: 100 }, data: { projection: { id: 'target', kind: 'PHYSICAL_OBJECT', label: 'target', source_refs: [], attributes: { connection_points: markerPoints } } } };
let activeNodes: Record<string, any> = { source, target };
let viewportZoom = 1;

vi.mock('@xyflow/react', () => ({
  BaseEdge: ({ interactionWidth, path, style }: any) => <path data-testid="base-edge" data-interaction-width={interactionWidth} d={path} style={style} />,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  getStraightPath: () => ['straight'],
  useInternalNode: (id: string) => activeNodes[id],
  useNodes: () => Object.entries(activeNodes).map(([id, node]: [string, any]) => ({ id, data: node.data, position: node.internals.positionAbsolute, measured: node.measured })),
  useReactFlow: () => ({ screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x + 1000, y: y + 2000 }), flowToScreenPosition: ({ x, y }: { x: number; y: number }) => ({ x: x - 1000, y: y - 2000 }), getViewport: () => ({ zoom: viewportZoom }) }),
  useViewport: () => ({ zoom: viewportZoom }),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const editor = (waypoints: MapCableRouteWaypoint[]) => ({
  cablePhysicalObjectId: 'cable', waypoints, selectedWaypointIndex: null,
  onWaypointSelect: vi.fn(), onWaypointMove: vi.fn(), onWaypointInsert: vi.fn(),
});
const edgeProps = (draft: ReturnType<typeof editor>) => ({ id: 'cable', source: 'source', target: 'target', data: { projection: { id: 'edge', from_node_id: 'source', to_node_id: 'target', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: {} }, cableRouteDraft: draft } });
const renderEdge = (draft = editor([])) => render(<svg><FloatingTopologyEdge {...edgeProps(draft) as any} /></svg>);

const blueprintNode = (id: string, x: number, physicalObjectId: string, slot: { connectionPointId: string; kind: 'CONNECTION_POINT' | 'NETWORK_PORT'; renderedX: number; attachmentX: number; side: 'LEFT' | 'RIGHT' }) => ({
  internals: { positionAbsolute: { x, y: 0 } },
  measured: { width: 100, height: 100 },
  data: { projection: {
    id,
    kind: 'PHYSICAL_OBJECT',
    label: id,
    source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: physicalObjectId }],
    attributes: { blueprint_presentation: { blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: `${id}-bp` }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: `${id}-v` }, body: { kind: 'RECTANGLE', width: 100, height: 100 }, slots: [{ slot_key: slot.connectionPointId, display_name: slot.connectionPointId, kind: slot.kind, connection_point_id: slot.connectionPointId, rendered_position: { x: slot.renderedX, y: .5 }, external_attachment: { x: slot.attachmentX, y: .5, side: slot.side } }] } },
  } },
});

const withNodes = (nodes: Record<string, any>, run: () => void) => {
  const previous = activeNodes;
  activeNodes = nodes;
  try { run(); } finally { activeNodes = previous; }
};

describe('direct cable route edge interaction', () => {
  it('renders a cable to a Location proxy without treating the proxy as a port-bearing object', () => {
    const proxy = { internals: { positionAbsolute: { x: 0, y: 0 } }, measured: { width: 110, height: 30 }, data: { projection: null, locationProxy: { locationId: 'room', label: 'Room', hiddenObjectCount: 1 } } };
    const cable = { id: 'real-cable', source: 'proxy', target: 'target', data: { cableNode: { id: 'canonical-cable' }, cableRoute: { waypoints: [{ x: 180, y: 20 }] } } };
    withNodes({ proxy, target }, () => {
      const { container } = render(<ForegroundCableRoutes edges={[cable] as any} />);
      expect(container.querySelector('[data-testid="foreground-cable-real-cable"]')).not.toBeNull();
      expect(container.querySelectorAll('.cable-route-port-marker')).toHaveLength(markerPoints.length);
      expect(container.querySelector('.cable-route-foreground')).toHaveAttribute('d', expect.stringContaining('L 180 20'));
      const anchor = container.querySelector('.cable-route-foreground')?.getAttribute('d')?.match(/^M ([\d.]+) ([\d.]+) /);
      expect(anchor).not.toBeNull();
      expect(Number(anchor![1])).toBe(proxy.measured.width);
      expect(Number(anchor![2])).toBeGreaterThanOrEqual(0);
      expect(Number(anchor![2])).toBeLessThanOrEqual(proxy.measured.height);
    });
  });
  it('anchors a real cable between two compact Location proxies', () => {
    const proxy = (id: string, x: number) => ({ internals: { positionAbsolute: { x, y: 0 } }, measured: { width: 110, height: 30 }, data: { projection: null, locationProxy: { locationId: id, label: id, hiddenObjectCount: 1 } } });
    const cable = { id: 'between-proxies', source: 'left', target: 'right', data: { cableNode: { id: 'canonical-cable' } } };
    withNodes({ left: proxy('left', 0), right: proxy('right', 300) }, () => {
      const { container } = render(<ForegroundCableRoutes edges={[cable] as any} />);
      expect(container.querySelector('.cable-route-foreground')).toHaveAttribute('d', 'M 110 15 L 300 15');
    });
  });
  it('exposes one source-target segment for zero waypoints and three segments for two', () => {
    const zero = renderEdge();
    expect(zero.container.querySelectorAll('.cable-route-segment-hit')).toHaveLength(1);
    zero.unmount();
    const two = renderEdge(editor([{ x: 100, y: 50 }, { x: 200, y: 50 }]));
    expect(two.container.querySelectorAll('.cable-route-segment-hit')).toHaveLength(3);
    expect(two.container.querySelectorAll('.cable-route-waypoint')).toHaveLength(2);
  });

  it('inserts at the exact clicked segment index using flow coordinates', () => {
    const draft = editor([{ x: 100, y: 50 }, { x: 200, y: 50 }]);
    const { container } = renderEdge(draft);
    const segments = container.querySelectorAll('.cable-route-segment-hit');
    fireEvent.pointerDown(segments[0], { clientX: 1, clientY: 2 });
    fireEvent.pointerDown(segments[1], { clientX: 3, clientY: 4 });
    fireEvent.pointerDown(segments[2], { clientX: 5, clientY: 6 });
    expect(draft.onWaypointInsert).toHaveBeenNthCalledWith(1, 0, { x: 1001, y: 2002 });
    expect(draft.onWaypointInsert).toHaveBeenNthCalledWith(2, 1, { x: 1003, y: 2004 });
    expect(draft.onWaypointInsert).toHaveBeenNthCalledWith(3, 2, { x: 1005, y: 2006 });
  });

  it('captures waypoint drag, selects it, and does not insert or bubble to the canvas', () => {
    const draft = editor([{ x: 100, y: 50 }]);
    const onCanvasPointerDown = vi.fn();
    const { container } = render(<svg onPointerDown={onCanvasPointerDown}><FloatingTopologyEdge {...edgeProps(draft) as any} /></svg>);
    const handle = container.querySelector('.cable-route-waypoint') as SVGCircleElement;
    Object.assign(handle, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1, clientY: 2 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 7, clientY: 8 });
    expect(draft.onWaypointSelect).toHaveBeenCalledWith(0);
    expect(draft.onWaypointMove).toHaveBeenCalledWith(0, { x: 1007, y: 2008 });
    expect(draft.onWaypointInsert).not.toHaveBeenCalled();
    expect(onCanvasPointerDown).not.toHaveBeenCalled();
  });

  it('uses the shared magnetic segment assist for route insertion and waypoint moves', () => {
    const draft = editor([{ x: 100, y: 50 }]);
    const edge = { ...edgeProps(draft), data: { ...edgeProps(draft).data, cableNode: { id: 'cable-node' } } };
    const { container } = render(<ForegroundCableRoutes edges={[edge] as any} />);
    const segment = container.querySelector('.cable-route-segment-hit')!;
    fireEvent(segment, new MouseEvent('pointerdown', { bubbles: true, clientX: -797, clientY: -1932, shiftKey: true }));
    expect(draft.onWaypointInsert).toHaveBeenCalledWith(0, { x: 200, y: 50 });
    const handle = container.querySelector('.cable-route-waypoint-hit') as SVGCircleElement;
    Object.assign(handle, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent(handle, new MouseEvent('pointermove', { bubbles: true, clientX: -797, clientY: -1932, shiftKey: true }));
    expect(draft.onWaypointMove).toHaveBeenLastCalledWith(0, { x: 200, y: 50 });
    expect(container.querySelector('.cable-route-geometry-feedback')).toHaveTextContent('0° · 100');
    fireEvent(handle, new MouseEvent('pointermove', { bubbles: true, clientX: -797, clientY: -1932, shiftKey: true, ctrlKey: true }));
    expect(draft.onWaypointMove).toHaveBeenLastCalledWith(0, { x: 203, y: 68 });
  });

  it('snaps drag and exact-index insertion to foreign geometry, then clears transient feedback', () => {
    const draft = editor([{ x: 150, y: 50 }, { x: 170, y: 50 }]);
    const editing = { ...edgeProps(draft), data: { ...edgeProps(draft).data, cableNode: { id: 'editing-node' } } };
    const foreign = { ...editing, id: 'foreign', data: { cableNode: { id: 'foreign-node' }, cableRoute: { waypoints: [{ x: 200, y: 100 }] } } };
    const view = render(<ForegroundCableRoutes edges={[foreign, editing] as any} />);
    const handles = view.container.querySelectorAll('.cable-route-waypoint-hit');
    const handle = handles[0] as SVGCircleElement;
    Object.assign(handle, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -800, clientY: -1902 });
    expect(draft.onWaypointMove).toHaveBeenLastCalledWith(0, { x: 200, y: 100 });
    expect(view.container.querySelector('.cable-route-foreign-waypoint-feedback')).toHaveAttribute('pointer-events', 'none');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -750, clientY: -1924 });
    expect(draft.onWaypointMove.mock.lastCall?.[1].x).toBeCloseTo(249.6);
    expect(draft.onWaypointMove.mock.lastCall?.[1].y).toBeCloseTo(75.2);
    expect(view.container.querySelector('.cable-route-foreign-segment-feedback')).toHaveAttribute('pointer-events', 'none');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -500, clientY: -1800 });
    expect(view.container.querySelector('[class*="cable-route-foreign-"]')).toBeNull();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -800, clientY: -1902 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(view.container.querySelector('[class*="cable-route-foreign-"]')).toBeNull();

    const editorSegments = view.container.querySelector('[data-testid="foreground-cable-cable"]')!.querySelectorAll('.cable-route-segment-hit');
    fireEvent.pointerDown(editorSegments[1], { clientX: -800, clientY: -1899 });
    expect(draft.onWaypointInsert).toHaveBeenLastCalledWith(1, { x: 200, y: 100 });
    fireEvent.pointerDown(editorSegments[2], { clientX: -750, clientY: -1924 });
    expect(draft.onWaypointInsert.mock.lastCall?.[0]).toBe(2);
    expect(draft.onWaypointInsert.mock.lastCall?.[1].x).toBeCloseTo(249.6);
    expect(draft.onWaypointInsert.mock.lastCall?.[1].y).toBeCloseTo(75.2);
  });

  it('excludes its own waypoints and uses straight foreign cables as segment targets', () => {
    const draft = editor([{ x: 200, y: 100 }]);
    const editing = { ...edgeProps(draft), data: { ...edgeProps(draft).data, cableNode: { id: 'editing-node' } } };
    const foreign = { ...editing, id: 'straight', data: { cableNode: { id: 'foreign-node' } } };
    const view = render(<ForegroundCableRoutes edges={[editing] as any} />);
    const handle = view.container.querySelector('.cable-route-waypoint-hit') as SVGCircleElement;
    Object.assign(handle, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -800, clientY: -1900 });
    expect(view.container.querySelector('[class*="cable-route-foreign-"]')).toBeNull();
    view.rerender(<ForegroundCableRoutes edges={[editing, foreign] as any} />);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -780, clientY: -1947 });
    expect(draft.onWaypointMove).toHaveBeenLastCalledWith(0, { x: 220, y: 50 });
    expect(view.container.querySelector('.cable-route-foreign-segment-feedback')).not.toBeNull();
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(view.container.querySelector('[class*="cable-route-foreign-"]')).toBeNull();
  });

  it('keeps the visible waypoint compact while its independent hit target is substantially larger', () => {
    const draft = editor([{ x: 100, y: 50 }]);
    const edge = { ...edgeProps(draft), data: { ...edgeProps(draft).data, cableNode: { id: 'cable-node' } } };
    const { container } = render(<ForegroundCableRoutes edges={[edge] as any} />);
    expect(container.querySelector('.cable-route-waypoint')).toHaveAttribute('r', '3.5');
    expect(container.querySelector('.cable-route-waypoint-hit')).toHaveAttribute('r', '18');
  });
  it('shows a compact boundary diamond with a large hit area and constrains its drag to the perimeter', () => {
    const anchor = { x: 100, y: 50, anchor: { location_id: 'room', edge: 'right' as const, offset: .5 } };
    const draft = { ...editor([anchor]), boundaryFrames: [{ locationId: 'room', bounds: { x: 0, y: 0, width: 100, height: 100 } }] };
    const edge = { ...edgeProps(draft), data: { ...edgeProps(draft).data, cableNode: { id: 'cable-node' } } };
    const { container } = render(<ForegroundCableRoutes edges={[edge] as any} />);
    expect(container.querySelector('rect.cable-route-waypoint--boundary')).toHaveAttribute('width', '6');
    expect(container.querySelector('rect.cable-route-waypoint--boundary')).toHaveAttribute('height', '6');
    expect(container.querySelector('circle.cable-route-waypoint')).toBeNull();
    const handle = container.querySelector('.cable-route-waypoint-hit') as SVGCircleElement;
    expect(handle).toHaveAttribute('r', '18');
    Object.assign(handle, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -870, clientY: -1930 });
    expect(draft.onWaypointMove).toHaveBeenLastCalledWith(0, expect.objectContaining({ x: 100, anchor: expect.objectContaining({ location_id: 'room', edge: 'right' }) }));
    expect(container.querySelector('.cable-route-geometry-feedback')).toHaveTextContent(/° · /);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -950, clientY: -2001 });
    const fortyFive = draft.onWaypointMove.mock.lastCall?.[1];
    expect(fortyFive?.x).toBeCloseTo(50);
    expect(fortyFive).toMatchObject({ y: 0, anchor: { edge: 'top' } });
    expect(fortyFive?.anchor?.offset).toBeCloseTo(.5);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -913, clientY: -2001 });
    const fifteen = draft.onWaypointMove.mock.lastCall?.[1];
    expect(fifteen?.x).toBeCloseTo(100 - 50 * Math.tan(Math.PI / 12));
    expect(fifteen).toMatchObject({ y: 0, anchor: { edge: 'top' } });
  });

  it('keeps normal cables visual-only in the foreground and puts edit controls above object bodies', () => {
    const normalDraft = edgeProps(editor([]));
    const { cableRouteDraft: _unused, ...normalData } = normalDraft.data;
    const normal = { ...normalDraft, data: { ...normalData, cableNode: { id: 'cable-node' } } };
    const selected = { ...normal, id: 'selected-cable', selected: true };
    const draft = editor([{ x: 100, y: 50 }]);
    const editing = { ...edgeProps(draft), id: 'editing-cable', data: { ...edgeProps(draft).data, cableNode: { id: 'editing-node' } } };
    const { container } = render(<ForegroundCableRoutes edges={[normal, selected, editing] as any} />);
    expect(container.querySelector('[data-testid="foreground-cable-cable"]')).toHaveAttribute('data-emphasis', 'normal');
    expect(container.querySelector('[data-testid="foreground-cable-selected-cable"]')).toHaveAttribute('data-emphasis', 'selected');
    expect(container.querySelector('[data-testid="foreground-cable-editing-cable"]')).toHaveAttribute('data-emphasis', 'editing');
    expect(container.querySelectorAll('.cable-route-segment-hit')).toHaveLength(2);
    expect(container.querySelector('.cable-route-foreground--normal')).toHaveStyle({ pointerEvents: 'none' });
  });

  it('preserves every wiring port state in the foreground repaint', () => {
    const base = edgeProps(editor([]));
    const edge = { ...base, data: { ...base.data, cableNode: { id: 'cable-node' } } };
    const { container } = render(<ForegroundCableRoutes edges={[edge] as any} physicalPortStates={{ eligible: 'eligible', source: 'source', destination: 'destination', unavailable: 'unavailable' }} />);
    for (const state of ['eligible', 'source', 'destination', 'unavailable']) {
      expect(container.querySelector(`.cable-route-port-marker--wiring-${state}`)).toBeInTheDocument();
    }
  });

  it('uses Blueprint rendered ports directly for a zero-waypoint route without attachment geometry', () => {
    const blueprintSource = blueprintNode('source', 0, 'source-object', { connectionPointId: 'source-port', kind: 'NETWORK_PORT', renderedX: .25, attachmentX: 1, side: 'RIGHT' });
    const blueprintTarget = blueprintNode('target', 300, 'target-object', { connectionPointId: 'target-port', kind: 'CONNECTION_POINT', renderedX: .75, attachmentX: 0, side: 'LEFT' });
    withNodes({ source: blueprintSource, target: blueprintTarget }, () => {
      const draft = editor([]);
      const edge = { id: 'blueprint-cable', source: 'source', target: 'target', data: { projection: { id: 'edge', from_node_id: 'source', to_node_id: 'target', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: {} }, cableNode: { id: 'cable-node' }, endpointPair: { from_connection_point_id: 'source-port', to_connection_point_id: 'target-port' }, cableRouteDraft: draft } };
      const { container } = render(<ForegroundCableRoutes edges={[edge] as any} physicalPortStates={{ 'source-port': 'source', 'target-port': 'destination' }} />);
      const markers = container.querySelectorAll('.cable-route-port-marker');
      expect(markers).toHaveLength(2);
      expect(markers[0]).toHaveAttribute('x', '21.5');
      expect(markers[0].tagName).toBe('rect');
      expect(markers[0]).toHaveClass('cable-route-port-marker--network', 'cable-route-port-marker--wiring-source');
      expect(markers[0]).toHaveAttribute('pointer-events', 'none');
      expect(markers[1]).toHaveAttribute('cx', '375');
      expect(markers[1].tagName).toBe('circle');
      expect(markers[1]).toHaveClass('cable-route-port-marker--wiring-destination');
      expect(container.querySelector('.cable-route-port-marker[cx="100"]')).toBeNull();
      expect(container.querySelector('.cable-route-port-marker[cx="300"]')).toBeNull();
      expect(container.querySelector('.cable-route-foreground')).toHaveAttribute('d', 'M 25 64 L 375 64');
      expect(container.querySelectorAll('.cable-route-segment-hit')).toHaveLength(1);
      expect(container.querySelectorAll('.cable-route-waypoint')).toHaveLength(0);
    });
  });

  it('draws a new zero-waypoint Blueprint wiring draft directly port-to-port', () => {
    const blueprintSource = blueprintNode('source', 0, 'source-object', { connectionPointId: 'source-port', kind: 'NETWORK_PORT', renderedX: .25, attachmentX: 1, side: 'RIGHT' });
    const blueprintTarget = blueprintNode('target', 300, 'target-object', { connectionPointId: 'target-port', kind: 'CONNECTION_POINT', renderedX: .75, attachmentX: 0, side: 'LEFT' });
    withNodes({ source: blueprintSource, target: blueprintTarget }, () => {
      const { container } = render(<svg><WiringRoute source={{ physicalObjectId: 'source-object', connectionPointId: 'source-port' }} target={{ physicalObjectId: 'target-object', connectionPointId: 'target-port' }} waypoints={[]} selectedWaypointIndex={null} onWaypointSelect={vi.fn()} onWaypointMove={vi.fn()} /></svg>);
      expect(container.querySelector('.wiring-route-preview')).toHaveAttribute('d', 'M 25 64 L 375 64');
      expect(container.querySelectorAll('.cable-route-waypoint')).toHaveLength(0);
    });
  });

  it('adds bends and edit hit segments only for explicit user waypoints', () => {
    const blueprintSource = blueprintNode('source', 0, 'source-object', { connectionPointId: 'source-port', kind: 'NETWORK_PORT', renderedX: .25, attachmentX: 1, side: 'RIGHT' });
    const blueprintTarget = blueprintNode('target', 300, 'target-object', { connectionPointId: 'target-port', kind: 'CONNECTION_POINT', renderedX: .75, attachmentX: 0, side: 'LEFT' });
    withNodes({ source: blueprintSource, target: blueprintTarget }, () => {
      const draft = editor([{ x: 200, y: 100 }]);
      const edge = { id: 'blueprint-cable', source: 'source', target: 'target', data: { projection: { id: 'edge', from_node_id: 'source', to_node_id: 'target', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: {} }, cableNode: { id: 'cable-node' }, endpointPair: { from_connection_point_id: 'source-port', to_connection_point_id: 'target-port' }, cableRouteDraft: draft } };
      const { container } = render(<ForegroundCableRoutes edges={[edge] as any} />);
      expect(container.querySelector('.cable-route-foreground')).toHaveAttribute('d', 'M 25 64 L 200 100 L 375 64');
      expect(container.querySelectorAll('.cable-route-segment-hit')).toHaveLength(2);
      expect(container.querySelectorAll('.cable-route-waypoint')).toHaveLength(1);
    });
  });

  it('keeps normal cable selection on its visible stroke while preserving editor targets', () => {
    const bare = edgeProps(editor([]));
    const { cableRouteDraft: _unused, ...data } = bare.data;
    const normal = { ...bare, data: { ...data, cableNode: { id: 'normal' } }, style: { strokeWidth: 2 } };
    const nearby = { ...normal, id: 'nearby', data: { ...normal.data, cableRoute: { waypoints: [{ x: 200, y: 54 }] } } };
    const crossing = { ...normal, id: 'crossing', data: { ...normal.data, cableRoute: { waypoints: [{ x: 200, y: 90 }] } } };
    const onCableClick = vi.fn();
    const { container } = render(<ForegroundCableRoutes edges={[nearby, crossing, normal] as any} onCableClick={onCableClick} />);
    const paths = [...container.querySelectorAll('.cable-route-foreground')] as SVGPathElement[];
    expect(paths).toHaveLength(3);
    expect(paths.every((path) => path.style.pointerEvents === 'stroke' && Number(path.style.strokeWidth) === 2)).toBe(true);
    fireEvent.click(paths[0]);
    fireEvent.click(paths[1]);
    expect(onCableClick.mock.calls.map((call) => call[1].id)).toEqual(['nearby', 'crossing']);
    const base = render(<svg><FloatingTopologyEdge {...normal as any} /></svg>);
    expect(base.getByTestId('base-edge')).toHaveAttribute('data-interaction-width', '2');
    base.unmount();
    for (const width of [3, 4]) {
      const emphasized = render(<svg><FloatingTopologyEdge {...{ ...normal, style: { strokeWidth: width } } as any} /></svg>);
      expect(emphasized.getByTestId('base-edge')).toHaveAttribute('data-interaction-width', String(width));
      emphasized.unmount();
    }
    const draft = editor([{ x: 200, y: 50 }]);
    const editing = { ...normal, data: { ...normal.data, cableRouteDraft: draft } };
    const editorView = render(<ForegroundCableRoutes edges={[editing] as any} />);
    expect(editorView.container.querySelector('.cable-route-segment-hit')).toHaveAttribute('stroke-width', '22');
    expect(editorView.container.querySelector('.cable-route-waypoint-hit')).toHaveAttribute('r', '18');
  });

  it('forwards a right click on the foreground Cable to its context menu handler', () => {
    const bare = edgeProps(editor([]));
    const { cableRouteDraft: _unused, ...data } = bare.data;
    const edge = { ...bare, data: { ...data, cableNode: { id: 'cable' } }, style: { strokeWidth: 2 } };
    const onCableContextMenu = vi.fn((event: React.MouseEvent<SVGElement>) => event.preventDefault());
    const onAncestorContextMenu = vi.fn();
    const { container } = render(<div onContextMenu={onAncestorContextMenu}><ForegroundCableRoutes edges={[edge] as any} onCableContextMenu={onCableContextMenu} /></div>);
    const path = container.querySelector('.cable-route-foreground')!;
    expect(path).toHaveStyle({ pointerEvents: 'stroke' });
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 50 });
    fireEvent(path, event);
    expect(onCableContextMenu).toHaveBeenCalledWith(expect.anything(), edge);
    expect(event.defaultPrevented).toBe(true);
    expect(onAncestorContextMenu).not.toHaveBeenCalled();
    const draft = editor([{ x: 200, y: 50 }]);
    const editing = { ...edge, data: { ...edge.data, cableRouteDraft: draft } };
    const editingView = render(<ForegroundCableRoutes edges={[editing] as any} onCableContextMenu={onCableContextMenu} />);
    const segment = editingView.container.querySelector('.cable-route-segment-hit')!;
    fireEvent.pointerDown(segment, { button: 2 });
    fireEvent.contextMenu(segment);
    expect(draft.onWaypointInsert).not.toHaveBeenCalled();
    const waypoint = editingView.container.querySelector('.cable-route-waypoint-hit')!;
    fireEvent.pointerDown(waypoint, { button: 2 });
    fireEvent.contextMenu(waypoint);
    expect(draft.onWaypointSelect).not.toHaveBeenCalled();
    expect(onCableContextMenu).toHaveBeenCalledTimes(3);
  });

  it('orders visual Cable states independently of edges order and follows selection changes', () => {
    const bare = edgeProps(editor([]));
    const { cableRouteDraft: _unused, ...data } = bare.data;
    const make = (id: string, emphasis: string, selected = false) => ({ ...bare, id, selected, data: { ...data, cableNode: { id }, cablePresentationEmphasis: emphasis } });
    const editing = { ...make('editing', 'editing'), data: { ...make('editing', 'editing').data, cableRouteDraft: editor([]) } };
    const normal = make('normal', 'normal');
    const selected = make('selected', 'selected', true);
    const attached = make('attached', 'attached');
    const traced = make('traced', 'traced');
    const wiring = { source: { physicalObjectId: 'source-object', connectionPointId: 'source-port' }, waypoints: [], selectedWaypointIndex: null, onWaypointSelect: vi.fn(), onWaypointMove: vi.fn() };
    const order = (root: HTMLElement) => [...root.querySelectorAll('[data-testid^="foreground-cable-"]')].map((node) => node.getAttribute('data-testid'));
    const view = render(<ForegroundCableRoutes edges={[selected, editing, traced, normal, attached] as any} wiringRoute={wiring} />);
    expect(order(view.container)).toEqual(['foreground-cable-normal', 'foreground-cable-traced', 'foreground-cable-attached', 'foreground-cable-selected', 'foreground-cable-editing']);
    expect(view.container.querySelector('[data-testid="foreground-wiring-route"]')!.compareDocumentPosition(view.container.querySelector('.cable-route-feedback-layer')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    view.rerender(<ForegroundCableRoutes edges={[make('selected', 'normal'), editing, traced, make('normal', 'selected', true), attached] as any} wiringRoute={wiring} />);
    expect(order(view.container).at(-2)).toBe('foreground-cable-normal');
    expect(order(view.container).at(-1)).toBe('foreground-cable-editing');
  });

  it('keeps feedback size in screen pixels, suppresses short and overlapping labels, and paints it last', () => {
    const feedback = (start: number, end: number) => ({ start: { x: start, y: 50 }, end: { x: end, y: 50 }, assist: {} as any });
    expect(layoutGeometryFeedback([feedback(0, 20)], 1)).toHaveLength(0);
    expect(layoutGeometryFeedback([feedback(0, 200), feedback(10, 190)], 1)).toHaveLength(1);
    const draft = editor([{ x: 100, y: 50 }]);
    const base = edgeProps(draft);
    const edge = { ...base, data: { ...base.data, cableNode: { id: 'cable' } } };
    const view = render(<ForegroundCableRoutes edges={[edge] as any} />);
    const handle = view.container.querySelector('.cable-route-waypoint-hit') as SVGCircleElement;
    Object.assign(handle, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent(handle, new MouseEvent('pointermove', { bubbles: true, clientX: -797, clientY: -1932, shiftKey: true }));
    const label = view.container.querySelector('.cable-route-geometry-feedback')!;
    expect(label).toHaveAttribute('font-size', '12');
    expect(label).toHaveAttribute('stroke-width', '3');
    expect(view.container.querySelector('.cable-route-feedback-layer')?.previousElementSibling).toHaveClass('cable-route-port-markers');
    viewportZoom = 4;
    fireEvent(handle, new MouseEvent('pointermove', { bubbles: true, clientX: -797, clientY: -1932, shiftKey: true }));
    expect(view.container.querySelector('.cable-route-geometry-feedback')).toHaveAttribute('font-size', '3');
    expect(view.container.querySelector('.cable-route-geometry-feedback')).toHaveAttribute('stroke-width', '0.75');
    viewportZoom = 1;
  });
});
