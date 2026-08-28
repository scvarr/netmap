import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FloatingTopologyEdge, ForegroundCableRoutes, WiringRoute } from './FloatingTopologyEdge';

const markerPoints = ['eligible', 'source', 'destination', 'unavailable'].map((id) => ({ connection_point_id: id, display_name: id, cardinality: 1, external_connection_count: 0 }));
const source = { internals: { positionAbsolute: { x: 0, y: 0 } }, measured: { width: 100, height: 100 }, data: { projection: { id: 'source', kind: 'PHYSICAL_OBJECT', label: 'source', source_refs: [], attributes: { connection_points: markerPoints } } } };
const target = { internals: { positionAbsolute: { x: 300, y: 0 } }, measured: { width: 100, height: 100 }, data: { projection: { id: 'target', kind: 'PHYSICAL_OBJECT', label: 'target', source_refs: [], attributes: { connection_points: markerPoints } } } };
let activeNodes: Record<string, any> = { source, target };

vi.mock('@xyflow/react', () => ({
  BaseEdge: () => <path data-testid="base-edge" />,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  getStraightPath: () => ['straight'],
  useInternalNode: (id: string) => activeNodes[id],
  useNodes: () => Object.values(activeNodes).map((node: any) => ({ id: node.data.projection.id, data: node.data })),
  useReactFlow: () => ({ screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x + 1000, y: y + 2000 }) }),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const editor = (waypoints: Array<{ x: number; y: number }>) => ({
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
      expect(container.querySelector('.cable-route-foreground')).toHaveAttribute('d', 'M 25 50 L 375 50');
      expect(container.querySelectorAll('.cable-route-segment-hit')).toHaveLength(1);
      expect(container.querySelectorAll('.cable-route-waypoint')).toHaveLength(0);
    });
  });

  it('draws a new zero-waypoint Blueprint wiring draft directly port-to-port', () => {
    const blueprintSource = blueprintNode('source', 0, 'source-object', { connectionPointId: 'source-port', kind: 'NETWORK_PORT', renderedX: .25, attachmentX: 1, side: 'RIGHT' });
    const blueprintTarget = blueprintNode('target', 300, 'target-object', { connectionPointId: 'target-port', kind: 'CONNECTION_POINT', renderedX: .75, attachmentX: 0, side: 'LEFT' });
    withNodes({ source: blueprintSource, target: blueprintTarget }, () => {
      const { container } = render(<svg><WiringRoute source={{ physicalObjectId: 'source-object', connectionPointId: 'source-port' }} target={{ physicalObjectId: 'target-object', connectionPointId: 'target-port' }} waypoints={[]} selectedWaypointIndex={null} onWaypointSelect={vi.fn()} onWaypointMove={vi.fn()} /></svg>);
      expect(container.querySelector('.wiring-route-preview')).toHaveAttribute('d', 'M 25 50 L 375 50');
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
      expect(container.querySelector('.cable-route-foreground')).toHaveAttribute('d', 'M 25 50 L 200 100 L 375 50');
      expect(container.querySelectorAll('.cable-route-segment-hit')).toHaveLength(2);
      expect(container.querySelectorAll('.cable-route-waypoint')).toHaveLength(1);
    });
  });
});
