import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FloatingTopologyEdge, ForegroundCableRoutes } from './FloatingTopologyEdge';

const markerPoints = ['eligible', 'source', 'destination', 'unavailable'].map((id) => ({ connection_point_id: id, display_name: id, cardinality: 1, external_connection_count: 0 }));
const source = { internals: { positionAbsolute: { x: 0, y: 0 } }, measured: { width: 100, height: 100 }, data: { projection: { id: 'source', kind: 'PHYSICAL_OBJECT', label: 'source', source_refs: [], attributes: { connection_points: markerPoints } } } };
const target = { internals: { positionAbsolute: { x: 300, y: 0 } }, measured: { width: 100, height: 100 }, data: { projection: { id: 'target', kind: 'PHYSICAL_OBJECT', label: 'target', source_refs: [], attributes: { connection_points: markerPoints } } } };

vi.mock('@xyflow/react', () => ({
  BaseEdge: () => <path data-testid="base-edge" />,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  getStraightPath: () => ['straight'],
  useInternalNode: (id: string) => id === 'source' ? source : target,
  useNodes: () => [{ id: 'source', data: source.data }, { id: 'target', data: target.data }],
  useReactFlow: () => ({ screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x + 1000, y: y + 2000 }) }),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const editor = (waypoints: Array<{ x: number; y: number }>) => ({
  cablePhysicalObjectId: 'cable', waypoints, selectedWaypointIndex: null,
  onWaypointSelect: vi.fn(), onWaypointMove: vi.fn(), onWaypointInsert: vi.fn(),
});
const edgeProps = (draft: ReturnType<typeof editor>) => ({ id: 'cable', source: 'source', target: 'target', data: { projection: { id: 'edge', from_node_id: 'source', to_node_id: 'target', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: {} }, cableRouteDraft: draft } });
const renderEdge = (draft = editor([])) => render(<svg><FloatingTopologyEdge {...edgeProps(draft) as any} /></svg>);

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
});
