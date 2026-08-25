import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FloatingTopologyEdge } from './FloatingTopologyEdge';

const source = { internals: { positionAbsolute: { x: 0, y: 0 } }, measured: { width: 100, height: 100 }, data: { projection: { id: 'source', kind: 'PHYSICAL_OBJECT', label: 'source', source_refs: [], attributes: {} } } };
const target = { internals: { positionAbsolute: { x: 300, y: 0 } }, measured: { width: 100, height: 100 }, data: { projection: { id: 'target', kind: 'PHYSICAL_OBJECT', label: 'target', source_refs: [], attributes: {} } } };

vi.mock('@xyflow/react', () => ({
  BaseEdge: () => <path data-testid="base-edge" />,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  getStraightPath: () => ['straight'],
  useInternalNode: (id: string) => id === 'source' ? source : target,
  useReactFlow: () => ({ screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x + 1000, y: y + 2000 }) }),
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
});
