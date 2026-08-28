import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopologyCanvas } from './TopologyCanvas';
import type { FlowProjection, TopologyLayoutEngine } from '../topology/layout';
import type { TopologyProjectionDocument } from '../topology/types';
import type { TopologyLayoutStore } from '../topology/layoutStore';

const { fitViewMock } = vi.hoisted(() => ({ fitViewMock: vi.fn() }));

vi.mock('@xyflow/react', () => ({
  applyNodeChanges: (changes: Array<{ id: string; position?: { x: number; y: number } }>, nodes: FlowProjection['nodes']) => (
    nodes.map((node) => {
      const change = changes.find((item) => item.id === node.id);
      return change?.position ? { ...node, position: change.position } : node;
    })
  ),
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  BaseEdge: () => null,
  Controls: () => null,
  getStraightPath: () => ['', 0, 0],
  Handle: () => null,
  MiniMap: () => null,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  ReactFlow: ({ nodes, edges, onNodeClick, onNodesChange, onNodeDragStart, onNodeDragStop, children }: {
    nodes: FlowProjection['nodes'];
    edges: FlowProjection['edges'];
    onNodeClick: (event: unknown, node: FlowProjection['nodes'][number]) => void;
    onNodesChange: (changes: unknown[]) => void;
    onNodeDragStart: (event: unknown, node: FlowProjection['nodes'][number]) => void;
    onNodeDragStop: (event: unknown, node: FlowProjection['nodes'][number]) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="flow">
      <svg>{edges.map((edge) => <path key={edge.id} data-testid={`svg-path-${edge.id}`} d="M0,0L1,1" />)}</svg>
      {edges.map((edge) => <output key={`route-${edge.id}`} data-testid={`route-${edge.id}`}>{edge.data?.cableRoute ? JSON.stringify(edge.data.cableRoute.waypoints) : 'no-route'}</output>)}
      {nodes.map((node) => (
        <div key={node.id}>
          <button onClick={() => onNodeClick({}, node)}>{node.id}</button>
          <span data-testid={`position-${node.id}`}>{node.position.x},{node.position.y}</span>
          <span data-testid={`highlighted-members-${node.id}`}>{[...(node.data.traceHighlightedConnectionMemberIds ?? [])].join(',')}</span>
          <span data-testid={`draggable-${node.id}`}>{String(node.draggable !== false)}</span>
          <button onClick={() => {
            if (node.draggable === false) return;
            onNodeDragStart({}, node);
            const position = node.id === 'collision-source' ? { x: 50, y: 0 } : node.id === 'touch-source' ? { x: 100, y: 0 } : { x: 42, y: 84 };
            const dragged = { ...node, position };
            onNodesChange([{ id: node.id, type: 'position', position: dragged.position }]);
            onNodeDragStop({}, dragged);
          }}>drag {node.id}</button>
        </div>
      ))}
      {children}
    </div>
  ),
  useInternalNode: () => undefined,
  useNodes: () => [],
  useReactFlow: () => ({ fitView: fitViewMock }),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const documentFor = (id: string): TopologyProjectionDocument => ({
  schema_version: '1.0',
  layer: id.startsWith('physical') ? 'L1' : 'L2',
  detail_level: id.startsWith('physical') ? 'PHYSICAL_OBJECT' : 'DEVICE',
  nodes: [{ id, kind: 'NODE', label: id, source_refs: [], attributes: {} }],
  edges: [],
  gaps: [],
  warnings: [],
});

const flowFor = (document: TopologyProjectionDocument): FlowProjection => ({
  nodes: document.nodes.map((projection) => ({
    id: projection.id,
    type: 'device',
    position: { x: 0, y: 0 },
    data: { projection },
  })),
  edges: [],
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
};

describe('TopologyCanvas async layout boundary', () => {
  it('enriches only a collapsed cable edge from current SavedMap routes without rerunning layout', async () => {
    const document: TopologyProjectionDocument = {
      ...documentFor('physical-route'),
      nodes: [
        { id: 'left', kind: 'PHYSICAL_OBJECT', label: 'left', source_refs: [], attributes: {} },
        { id: 'right', kind: 'PHYSICAL_OBJECT', label: 'right', source_refs: [], attributes: {} },
      ],
    };
    const cableNode = {
      id: 'cable-node', kind: 'PHYSICAL_OBJECT', label: 'not-an-identity',
      source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'cable-id' }],
      attributes: { class: 'cable' },
    };
    const cableEdge = {
      id: 'collapsed-cable:cable-node', source: 'left', target: 'right', type: 'floating' as const,
      data: { projection: { id: 'presentation:cable-node', from_node_id: 'left', to_node_id: 'right', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: {} }, cableNode },
    };
    const layoutEngine: TopologyLayoutEngine = vi.fn(async () => ({
      nodes: document.nodes.map((projection) => ({ id: projection.id, type: 'device' as const, position: { x: 0, y: 0 }, data: { projection } })),
      edges: [cableEdge],
    }));
    const explicitStraightRoute = { cable_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'cable-id' }, view: 'L1/PHYSICAL_OBJECT' as const, waypoints: [] };
    const view = render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={layoutEngine} cableRoutes={[explicitStraightRoute]} />);
    expect(await screen.findByTestId('route-collapsed-cable:cable-node')).toHaveTextContent('[]');
    view.rerender(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={layoutEngine} cableRoutes={[]} />);
    expect(screen.getByTestId('route-collapsed-cable:cable-node')).toHaveTextContent('no-route');
    expect(layoutEngine).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['blueprint to blueprint', false, false],
    ['blueprint to generic', false, true],
    ['collapsed cable between blueprint nodes', true, false],
  ])('renders an SVG path for %s', async (_, collapsedCable, genericTarget) => {
    const blueprint = (id: string, point: string) => ({
      id, kind: 'PHYSICAL_OBJECT', label: id, source_refs: [], attributes: {
        blueprint_presentation: { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint', entity_id: `${id}-bp` }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion', entity_id: `${id}-v` }, body: { kind: 'RECTANGLE' as const, width: 120, height: 40 }, slots: [{ slot_key: 'port', display_name: 'port', kind: 'CONNECTION_POINT' as const, rendered_position: { x: .5, y: .5 }, external_attachment: { x: 1, y: .5, side: 'RIGHT' as const }, connection_point_id: point }] },
      },
    });
    const left = blueprint('left', 'left-cp');
    const right = genericTarget ? { ...blueprint('right', 'right-cp'), attributes: {} } : blueprint('right', 'right-cp');
    const directEdge = { id: 'left-right', from_node_id: 'left', to_node_id: 'right', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: { endpoint_pairs: [{ from_connection_point_id: 'left-cp', from_member_index: 1, to_connection_point_id: 'right-cp', to_member_index: 1, connection_id: 'connection', connection_member_id: 'member' }] } };
    const base: TopologyProjectionDocument = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [], edges: [], gaps: [], warnings: [] };
    const document: TopologyProjectionDocument = collapsedCable ? {
      ...base, nodes: [left, { id: 'cable', kind: 'PHYSICAL_OBJECT', label: 'cable', source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'cable-a' }, { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'cable-b' }], attributes: { class: 'cable', connection_point_count: 2 } }, right], edges: [
        { ...directEdge, id: 'left-cable', to_node_id: 'cable', attributes: { endpoint_pairs: [{ ...directEdge.attributes.endpoint_pairs![0], to_connection_point_id: 'cable-a' }] } },
        { ...directEdge, id: 'cable-right', from_node_id: 'cable', attributes: { endpoint_pairs: [{ ...directEdge.attributes.endpoint_pairs![0], from_connection_point_id: 'cable-b' }] } },
      ],
    } : { ...base, nodes: [left, right], edges: [directEdge] };
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => (await import('../topology/layout')).toFlowProjection(input)} />);
    expect(await screen.findByTestId(collapsedCable ? 'svg-path-collapsed-cable:cable' : 'svg-path-left-right::member::member')).toHaveAttribute('d', 'M0,0L1,1');
  });

  it('does not apply a stale layout after a fast projection switch', async () => {
    const logical = documentFor('logical-A');
    const physical = documentFor('physical-B');
    const logicalResult = deferred<FlowProjection>();
    const physicalResult = deferred<FlowProjection>();
    const layoutEngine: TopologyLayoutEngine = vi.fn((document) => (
      document.layer === 'L1' ? physicalResult.promise : logicalResult.promise
    ));
    const onSelectionChange = vi.fn();
    const view = render(
      <TopologyCanvas
        document={logical}
        selection={null}
        onSelectionChange={onSelectionChange}
        layoutEngine={layoutEngine}
      />,
    );
    view.rerender(
      <TopologyCanvas
        document={physical}
        selection={null}
        onSelectionChange={onSelectionChange}
        layoutEngine={layoutEngine}
      />,
    );

    await act(async () => { physicalResult.resolve(flowFor(physical)); });
    expect(screen.getByRole('button', { name: 'physical-B' })).toBeInTheDocument();

    await act(async () => { logicalResult.resolve(flowFor(logical)); });
    expect(screen.queryByRole('button', { name: 'logical-A' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'physical-B' })).toBeInTheDocument();
  });

  it('preserves node selection callbacks after layout', async () => {
    const document = documentFor('logical-A');
    const onSelectionChange = vi.fn();
    render(
      <TopologyCanvas
        document={document}
        selection={null}
        onSelectionChange={onSelectionChange}
        layoutEngine={async (input) => flowFor(input)}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'logical-A' }));
    expect(onSelectionChange).toHaveBeenCalledWith({ type: 'node', item: document.nodes[0] });
  });

  it('applies stored overrides and saves a manual drag for the current view', async () => {
    const document = documentFor('logical-A');
    const store: TopologyLayoutStore = {
      load: vi.fn().mockReturnValue({ 'logical-A': { x: 10, y: 20 } }),
      save: vi.fn(),
      clear: vi.fn(),
    };
    render(
      <TopologyCanvas
        document={document}
        selection={null}
        onSelectionChange={vi.fn()}
        layoutEngine={async (input) => flowFor(input)}
        layoutStore={store}
      />,
    );

    expect(await screen.findByTestId('position-logical-A')).toHaveTextContent('10,20');
    fireEvent.click(screen.getByRole('button', { name: 'drag logical-A' }));

    expect(store.save).toHaveBeenCalledWith('L2/DEVICE', {
      'logical-A': { x: 42, y: 84 },
    });
    expect(screen.getByTestId('position-logical-A')).toHaveTextContent('42,84');
  });

  it('auto-layout clears only the current view, reruns ELK, and fits the canvas', async () => {
    fitViewMock.mockClear();
    const document = documentFor('physical-A');
    const layoutEngine: TopologyLayoutEngine = vi.fn(async (input) => flowFor(input));
    const store: TopologyLayoutStore = {
      load: vi.fn().mockReturnValue({}),
      save: vi.fn(),
      clear: vi.fn(),
    };
    render(
      <TopologyCanvas
        document={document}
        selection={null}
        onSelectionChange={vi.fn()}
        layoutEngine={layoutEngine}
        layoutStore={store}
      />,
    );
    await screen.findByRole('button', { name: 'physical-A' });

    fireEvent.click(screen.getByRole('button', { name: 'Авторазмещение' }));

    await waitFor(() => expect(layoutEngine).toHaveBeenCalledTimes(2));
    expect(store.clear).toHaveBeenCalledWith('L1/PHYSICAL_OBJECT');
    await waitFor(() => expect(fitViewMock).toHaveBeenCalled());
  });

  it('does not rerun layout for a new position override object in the same scene', async () => {
    const document = documentFor('physical-A');
    const layoutEngine: TopologyLayoutEngine = vi.fn(async (input) => flowFor(input));
    const view = render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" positionOverrides={{ 'physical-A': { x: 1, y: 2 } }} layoutEngine={layoutEngine} />);
    await screen.findByRole('button', { name: 'physical-A' });
    view.rerender(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" positionOverrides={{ 'physical-A': { x: 42, y: 84 } }} layoutEngine={layoutEngine} />);
    expect(layoutEngine).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('position-physical-A')).toHaveTextContent('1,2');
  });

  it('keeps React Flow mounted and does not refit when a same-scene document refreshes', async () => {
    fitViewMock.mockClear();
    const first = documentFor('physical-A');
    const refreshed = { ...documentFor('physical-A'), warnings: ['refreshed'] };
    const next = deferred<FlowProjection>();
    const layoutEngine: TopologyLayoutEngine = vi.fn((document) => document === first ? Promise.resolve(flowFor(document)) : next.promise);
    const view = render(<TopologyCanvas document={first} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} />);
    await screen.findByTestId('flow');
    await waitFor(() => expect(fitViewMock).toHaveBeenCalledTimes(1));
    view.rerender(<TopologyCanvas document={refreshed} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} />);
    expect(screen.getByTestId('flow')).toBeInTheDocument();
    expect(fitViewMock).toHaveBeenCalledTimes(1);
    await act(async () => { next.resolve(flowFor(refreshed)); });
    await screen.findByTestId('flow');
    expect(fitViewMock).toHaveBeenCalledTimes(1);
  });

  it('does not move the viewport when selection changes in a scene', async () => {
    fitViewMock.mockClear();
    const first = documentFor('physical-A');
    const second = { ...first.nodes[0], id: 'physical-B' };
    const document = { ...first, nodes: [first.nodes[0], second] };
    const layoutEngine: TopologyLayoutEngine = vi.fn(async (document) => flowFor(document));
    const view = render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} />);
    await screen.findByTestId('flow');
    await waitFor(() => expect(fitViewMock).toHaveBeenCalledTimes(1));

    view.rerender(<TopologyCanvas document={document} selection={{ type: 'node', item: document.nodes[0] }} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} />);
    expect(fitViewMock).toHaveBeenCalledTimes(1);

    view.rerender(<TopologyCanvas document={document} selection={{ type: 'node', item: document.nodes[1] }} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} />);
    expect(fitViewMock).toHaveBeenCalledTimes(1);

    view.rerender(<TopologyCanvas document={document} selection={{ type: 'node', item: document.nodes[1] }} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} traceOverlay={{ highlightedNodeIds: new Set(['physical-B']), highlightedEdgeIds: new Set(), highlightedConnectionMemberIds: new Set() }} />);
    expect(fitViewMock).toHaveBeenCalledTimes(1);

    view.rerender(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} />);
    expect(fitViewMock).toHaveBeenCalledTimes(1);
  });

  it('passes exact trace-member highlighting without rerunning layout or fitting the scene', async () => {
    fitViewMock.mockClear();
    const document = documentFor('physical-A');
    const layoutEngine: TopologyLayoutEngine = vi.fn(async (input) => flowFor(input));
    const view = render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} />);
    await screen.findByTestId('flow');
    await waitFor(() => expect(fitViewMock).toHaveBeenCalledTimes(1));
    view.rerender(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} traceOverlay={{ highlightedNodeIds: new Set(['physical-A']), highlightedEdgeIds: new Set(), highlightedConnectionMemberIds: new Set(['member-1']) }} />);
    expect(screen.getByTestId('highlighted-members-physical-A')).toHaveTextContent('member-1');
    expect(layoutEngine).toHaveBeenCalledTimes(1);
    expect(fitViewMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a locked node selectable but prevents its drag without rebuilding the scene', async () => {
    const document = {
      ...documentFor('physical-A'),
      nodes: [{ ...documentFor('physical-A').nodes[0], source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'object-a' }] }],
    };
    const onSelectionChange = vi.fn();
    const onPhysicalNodeDragStop = vi.fn();
    const layoutEngine: TopologyLayoutEngine = vi.fn(async (input) => flowFor(input));
    const view = render(
      <TopologyCanvas
        document={document}
        selection={null}
        onSelectionChange={onSelectionChange}
        layoutEngine={layoutEngine}
        draggableNodeIds={new Set(['physical-A'])}
        lockedNodeIds={new Set(['physical-A'])}
        onPhysicalNodeDragStop={onPhysicalNodeDragStop}
      />,
    );

    await screen.findByRole('button', { name: 'physical-A' });
    expect(screen.getByTestId('draggable-physical-A')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('button', { name: 'physical-A' }));
    expect(onSelectionChange).toHaveBeenCalledWith({ type: 'node', item: document.nodes[0] });
    fireEvent.click(screen.getByRole('button', { name: 'drag physical-A' }));
    expect(onPhysicalNodeDragStop).not.toHaveBeenCalled();

    view.rerender(
      <TopologyCanvas
        document={document}
        selection={null}
        onSelectionChange={onSelectionChange}
        layoutEngine={layoutEngine}
        draggableNodeIds={new Set(['physical-A'])}
        lockedNodeIds={new Set()}
        onPhysicalNodeDragStop={onPhysicalNodeDragStop}
      />,
    );
    expect(screen.getByTestId('draggable-physical-A')).toHaveTextContent('true');
    fireEvent.click(screen.getByRole('button', { name: 'drag physical-A' }));
    expect(onPhysicalNodeDragStop).toHaveBeenCalledTimes(1);
    expect(onPhysicalNodeDragStop).toHaveBeenCalledWith('object-a', { x: 42, y: 84 });
    expect(layoutEngine).toHaveBeenCalledTimes(1);
  });

  it('rejects an overlapping final drop locally and restores the confirmed position', async () => {
    fitViewMock.mockClear();
    const source = { ...documentFor('physical-A').nodes[0], id: 'collision-source', source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'source-object' }] };
    const blocker = { ...source, id: 'collision-blocker', source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'blocker-object' }] };
    const document = { ...documentFor('physical-A'), nodes: [source, blocker] };
    const layoutEngine: TopologyLayoutEngine = vi.fn(async () => ({ nodes: [
      { id: source.id, type: 'device' as const, position: { x: 0, y: 0 }, data: { projection: source } },
      { id: blocker.id, type: 'device' as const, position: { x: 50, y: 0 }, data: { projection: blocker } },
    ], edges: [] }));
    const onPhysicalNodeDragStop = vi.fn();
    const onNodeCollisionRejected = vi.fn();
    const onSelectionChange = vi.fn();
    render(<TopologyCanvas document={document} selection={{ type: 'node', item: source }} onSelectionChange={onSelectionChange} sceneKey="map-a/physical" layoutEngine={layoutEngine} draggableNodeIds={new Set([source.id, blocker.id])} onPhysicalNodeDragStop={onPhysicalNodeDragStop} onNodeCollisionRejected={onNodeCollisionRejected} />);

    await screen.findByRole('button', { name: 'drag collision-source' });
    await waitFor(() => expect(fitViewMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'drag collision-source' }));
    await waitFor(() => expect(screen.getByTestId('position-collision-source')).toHaveTextContent('0,0'));
    expect(onPhysicalNodeDragStop).not.toHaveBeenCalled();
    expect(onNodeCollisionRejected).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(fitViewMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a free or boundary-touching final drop exactly once', async () => {
    const source = { ...documentFor('physical-A').nodes[0], id: 'touch-source', source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'source-object' }] };
    const blocker = { ...source, id: 'touch-blocker', source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'blocker-object' }] };
    const document = { ...documentFor('physical-A'), nodes: [source, blocker] };
    const layoutEngine: TopologyLayoutEngine = vi.fn(async () => ({ nodes: [
      { id: source.id, type: 'device' as const, position: { x: 0, y: 0 }, data: { projection: source } },
      { id: blocker.id, type: 'device' as const, position: { x: 312, y: 0 }, data: { projection: blocker } },
    ], edges: [] }));
    const onPhysicalNodeDragStop = vi.fn();
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={layoutEngine} draggableNodeIds={new Set([source.id, blocker.id])} onPhysicalNodeDragStop={onPhysicalNodeDragStop} />);

    fireEvent.click(await screen.findByRole('button', { name: 'drag touch-source' }));
    expect(onPhysicalNodeDragStop).toHaveBeenCalledTimes(1);
    expect(onPhysicalNodeDragStop).toHaveBeenCalledWith('source-object', { x: 100, y: 0 });
  });

  it('fits each new scene once and applies an explicit authoritative rollback without ELK', async () => {
    fitViewMock.mockClear();
    const document = documentFor('physical-A');
    const layoutEngine: TopologyLayoutEngine = vi.fn(async (input) => flowFor(input));
    const view = render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" positionOverrides={{ 'physical-A': { x: 10, y: 20 } }} authoritativePositionRevision={0} layoutEngine={layoutEngine} />);
    await screen.findByRole('button', { name: 'physical-A' });
    await waitFor(() => expect(fitViewMock).toHaveBeenCalledTimes(1));
    view.rerender(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/logical" positionOverrides={{ 'physical-A': { x: 10, y: 20 } }} authoritativePositionRevision={0} layoutEngine={layoutEngine} />);
    await waitFor(() => expect(fitViewMock).toHaveBeenCalledTimes(2));
    view.rerender(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/logical" positionOverrides={{ 'physical-A': { x: 99, y: 77 } }} authoritativePositionRevision={1} layoutEngine={layoutEngine} />);
    await waitFor(() => expect(screen.getByTestId('position-physical-A')).toHaveTextContent('99,77'));
    expect(layoutEngine).toHaveBeenCalledTimes(1);
    expect(fitViewMock).toHaveBeenCalledTimes(2);
  });
});
