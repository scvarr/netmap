import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopologyCanvas } from './TopologyCanvas';
import type { FlowProjection, TopologyLayoutEngine } from '../topology/layout';
import type { TopologyProjectionDocument, TopologyProjectionNode } from '../topology/types';
import type { PresentationSceneDocument } from '../topology/presentationScene';
import type { TopologyLayoutStore } from '../topology/layoutStore';

const { fitViewMock, getZoomMock, screenTransform } = vi.hoisted(() => ({
  fitViewMock: vi.fn(),
  getZoomMock: vi.fn(() => 1),
  screenTransform: { scale: 1, offsetX: 0, offsetY: 0 },
}));

vi.mock('@xyflow/react', () => ({
  applyNodeChanges: (changes: Array<{ id: string; position?: { x: number; y: number }; dimensions?: { width?: number; height?: number } }>, nodes: FlowProjection['nodes']) => (
    nodes.map((node) => {
      const change = changes.find((item) => item.id === node.id);
      return change?.position
        ? { ...node, position: change.position }
        : change?.dimensions
          ? { ...node, measured: { width: change.dimensions.width, height: change.dimensions.height } }
          : node;
    })
  ),
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  BaseEdge: () => null,
  Controls: () => null,
  getStraightPath: () => ['', 0, 0],
  Handle: () => null,
  MiniMap: (props: { className?: string; position?: string }) => <div data-testid="minimap" data-class={props.className} data-position={props.position} />,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  ReactFlow: ({ nodes, edges, onNodeClick, onEdgeClick, onNodeContextMenu, onPaneContextMenu, onNodesChange, onNodeDragStart, onNodeDragStop, onPaneClick, onPaneMouseMove, children }: {
    nodes: FlowProjection['nodes'];
    edges: FlowProjection['edges'];
    onNodeClick: (event: unknown, node: FlowProjection['nodes'][number]) => void;
    onEdgeClick?: (event: unknown, edge: FlowProjection['edges'][number]) => void;
    onNodeContextMenu?: (event: { preventDefault(): void }, node: FlowProjection['nodes'][number]) => void;
    onPaneContextMenu?: (event: { preventDefault(): void; clientX: number; clientY: number }) => void;
    onNodesChange: (changes: unknown[]) => void;
    onNodeDragStart: (event: unknown, node: FlowProjection['nodes'][number]) => void;
    onNodeDragStop: (event: unknown, node: FlowProjection['nodes'][number]) => void;
    onPaneClick?: (event: { clientX: number; clientY: number; shiftKey: boolean; ctrlKey: boolean }) => void;
    onPaneMouseMove?: (event: { clientX: number; clientY: number; shiftKey: boolean; ctrlKey: boolean }) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="flow">
      <svg>{edges.map((edge) => <path key={edge.id} data-testid={`svg-path-${edge.id}`} d="M0,0L1,1" />)}</svg>
      {edges.map((edge) => <button key={`edge-${edge.id}`} onClick={() => onEdgeClick?.({}, edge)}>edge {edge.id}</button>)}
      {edges.map((edge) => <output key={`route-${edge.id}`} data-testid={`route-${edge.id}`}>{edge.data?.cableRoute ? JSON.stringify(edge.data.cableRoute.waypoints) : 'no-route'}</output>)}
      {edges.map((edge) => <output key={`traced-${edge.id}`} data-testid={`traced-${edge.id}`}>{String(Boolean(edge.animated))}</output>)}
      {edges.map((edge) => <output key={`emphasis-${edge.id}`} data-testid={`emphasis-${edge.id}`}>{edge.data?.cablePresentationEmphasis ?? 'none'}</output>)}
      {nodes.map((node) => (
        <div key={node.id}>
          <button onClick={() => onNodeClick({}, node)}>{node.id}</button>
          <button onClick={() => onNodeContextMenu?.({ preventDefault: vi.fn() }, node)}>context {node.id}</button>
          <span data-testid={`position-${node.id}`}>{node.position.x},{node.position.y}</span>
          <span data-testid={`location-path-${node.id}`}>{node.data.locationPresentationPath ?? ''}</span>
          <span data-testid={`parent-${node.id}`}>{node.parentId ?? 'none'}</span>
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
          <button onClick={() => onNodesChange([{ id: node.id, type: 'dimensions', dimensions: { width: 178, height: 112 } }])}>measure {node.id}</button>
        </div>
      ))}
      <button onClick={(event) => onPaneMouseMove?.({ clientX: event.clientX || 30, clientY: event.clientY || 40, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey })} onMouseMove={(event) => onPaneMouseMove?.({ clientX: event.clientX || 30, clientY: event.clientY || 40, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey })}>move pane</button>
      <button onClick={(event) => onPaneClick?.({ clientX: event.clientX || 10, clientY: event.clientY || 20, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey })}>click pane</button>
      <button onClick={() => onPaneContextMenu?.({ preventDefault: vi.fn(), clientX: 10, clientY: 20 })}>context pane</button>
      {children}
    </div>
  ),
  useInternalNode: () => undefined,
  useNodes: () => [],
  useReactFlow: () => ({
    fitView: fitViewMock,
    getZoom: getZoomMock,
    screenToFlowPosition: (position: { x: number; y: number }) => ({ x: (position.x - screenTransform.offsetX) / screenTransform.scale, y: (position.y - screenTransform.offsetY) / screenTransform.scale }),
    flowToScreenPosition: (position: { x: number; y: number }) => ({ x: position.x * screenTransform.scale + screenTransform.offsetX, y: position.y * screenTransform.scale + screenTransform.offsetY }),
  }),
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

const flowFor = (scene: PresentationSceneDocument): FlowProjection => ({
  nodes: scene.nodes.map((projection) => ({ id: projection.id, type: 'device', position: { x: 0, y: 0 }, data: { projection } })),
  edges: [],
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
};

afterEach(() => {
  fitViewMock.mockClear();
  getZoomMock.mockClear();
  screenTransform.scale = 1;
  screenTransform.offsetX = 0;
  screenTransform.offsetY = 0;
});

describe('TopologyCanvas async layout boundary', () => {
  it('renders only physical SavedMap frames and follows controlled drag, rollback and blueprint resize', async () => {
    const projection: TopologyProjectionNode = {
      id: 'physical-framed', kind: 'PHYSICAL_OBJECT', label: 'Server',
      source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'server' }],
      attributes: { blueprint_presentation: { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint', entity_id: 'blueprint' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion', entity_id: 'version' }, body: { kind: 'RECTANGLE' as const, width: 100, height: 50 }, slots: [] } },
    };
    const peer: TopologyProjectionNode = { id: 'physical-peer', kind: 'PHYSICAL_OBJECT', label: 'Peer', source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'peer' }], attributes: {} };
    const document: TopologyProjectionDocument = { ...documentFor('physical-framed'), nodes: [projection, peer] };
    const locationFrameInput = {
      locations: [{ location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'room' }, name: 'Room', type: null, parent_location_ref: null }, { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'unit' }, name: 'Unit', type: null, parent_location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'room' } }],
      placements: [{ physical_object_ref: projection.source_refs[0], location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'unit' }, positions: {} }, { physical_object_ref: peer.source_refs[0], location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'room' }, positions: {} }],
    };
    const layoutEngine: TopologyLayoutEngine = async (scene) => flowFor(scene);
    const props = { document, selection: null, onSelectionChange: vi.fn(), layoutEngine, locationFrameInput, positionSnapshot: locationFrameInput.placements, positionOverrides: { 'physical-framed': { x: 10, y: 20 }, 'physical-peer': { x: 80, y: 300 } }, displayWidthOverrides: { 'physical-framed': 200 } };
    const view = render(<TopologyCanvas {...props} />);
    await screen.findByRole('button', { name: 'physical-framed' });
    const frame = () => globalThis.document.querySelector('.location-frame') as HTMLElement;
    expect(frame()).toHaveTextContent('Room');
    expect(globalThis.document.querySelectorAll('.location-frame')).toHaveLength(1);
    expect(screen.getByTestId('location-path-physical-framed')).toHaveTextContent('Unit');
    expect(globalThis.document.querySelector('.location-caption')).toBeNull();
    const initialLeft = Number.parseFloat(frame().style.left);
    const initialWidth = Number.parseFloat(frame().style.width);
    expect(frame().closest('[aria-hidden="true"]')).not.toBeNull();
    expect(frame().className).toBe('location-frame');
    fireEvent.click(screen.getByRole('button', { name: 'drag physical-framed' }));
    expect(Number.parseFloat(frame().style.left) - initialLeft).toBe(32);
    expect(screen.getByTestId('location-path-physical-framed')).toHaveTextContent('Unit');
    view.rerender(<TopologyCanvas {...props} positionOverrides={{ 'physical-framed': { x: 10, y: 20 } }} authoritativePositionRevision={1} />);
    await waitFor(() => expect(Number.parseFloat(frame().style.left)).toBe(initialLeft));
    view.rerender(<TopologyCanvas {...props} positionSnapshot={[...locationFrameInput.placements]} positionOverrides={{ 'physical-framed': { x: 200, y: 100 } }} authoritativePositionRevision={1} />);
    await waitFor(() => expect(screen.getByTestId('position-physical-framed')).toHaveTextContent('200,100'));
    view.rerender(<TopologyCanvas {...props} displayWidthOverrides={{ 'physical-framed': 320 }} authoritativePositionRevision={1} />);
    await waitFor(() => expect(Number.parseFloat(frame().style.width)).toBeGreaterThan(initialWidth));
    view.rerender(<TopologyCanvas {...props} document={{ ...document, layer: 'L2', detail_level: 'DEVICE' }} />);
    await waitFor(() => expect(globalThis.document.querySelector('.location-frame')).toBeNull());
    expect(screen.getByTestId('location-path-physical-framed')).toBeEmptyDOMElement();
    view.rerender(<TopologyCanvas {...props} locationFrameInput={undefined} />);
    await waitFor(() => expect(screen.getByTestId('location-path-physical-framed')).toBeEmptyDOMElement());
  });
  it('reveals a requested physical object once without refitting unrelated rerenders', async () => {
    const object = {
      ...documentFor('physical-focus').nodes[0],
      source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'object-id' }],
    };
    const document = { ...documentFor('physical-focus'), nodes: [object] };
    const view = render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} />);
    await screen.findByRole('button', { name: 'physical-focus' });
    fitViewMock.mockClear();

    view.rerender(<TopologyCanvas document={document} selection={{ type: 'node', item: object }} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} focusPhysicalObjectId="object-id" />);
    await waitFor(() => expect(fitViewMock).toHaveBeenCalledWith(expect.objectContaining({ nodes: [expect.objectContaining({ id: 'physical-focus' })], padding: .15, maxZoom: 1 })));
    view.rerender(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} focusPhysicalObjectId="object-id" />);
    expect(fitViewMock.mock.calls.filter(([options]) => options.nodes?.[0]?.id === 'physical-focus')).toHaveLength(1);
  });

  it('docks the minimap above the trace control at the bottom right', async () => {
    render(<TopologyCanvas document={documentFor('physical-minimap')} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} />);
    expect(await screen.findByTestId('minimap')).toHaveAttribute('data-position', 'bottom-right');
    expect(screen.getByTestId('minimap')).toHaveAttribute('data-class', 'topology-canvas__minimap');
  });
  it('enriches only a collapsed cable edge from current SavedMap routes without rerunning layout', async () => {
    const document: TopologyProjectionDocument = {
      ...documentFor('physical-route'),
      nodes: [
        { id: 'left', kind: 'PHYSICAL_OBJECT', label: 'left', source_refs: [], attributes: {} },
        { id: 'right', kind: 'PHYSICAL_OBJECT', label: 'right', source_refs: [], attributes: {} },
      ],
    };
    const cableNode = {
      id: 'cable-node', kind: 'CABLE', label: 'not-an-identity',
      source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'Cable', entity_id: 'cable-id' }],
      attributes: {},
    };
    const cableEdge = {
      id: 'collapsed-cable:cable-node', source: 'left', target: 'right', type: 'floating' as const,
      data: { projection: { id: 'presentation:cable-node', from_node_id: 'left', to_node_id: 'right', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: {} }, cableNode },
    };
    const layoutEngine: TopologyLayoutEngine = vi.fn(async () => ({
      nodes: document.nodes.map((projection) => ({ id: projection.id, type: 'device' as const, position: { x: 0, y: 0 }, data: { projection } })),
      edges: [cableEdge],
    }));
    const explicitStraightRoute = { cable_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Cable', entity_id: 'cable-id' }, view: 'L1/PHYSICAL_OBJECT' as const, waypoints: [] };
    const view = render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={layoutEngine} cableRoutes={[explicitStraightRoute]} />);
    expect(await screen.findByTestId('route-collapsed-cable:cable-node')).toHaveTextContent('[]');
    view.rerender(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={layoutEngine} cableRoutes={[]} />);
    expect(screen.getByTestId('route-collapsed-cable:cable-node')).toHaveTextContent('no-route');
    expect(layoutEngine).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['blueprint to blueprint', false, false],
    ['blueprint to generic', false, true],
    ['cable-bearing edge between blueprint nodes', true, false],
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
    const document: TopologyProjectionDocument = { ...base, nodes: [left, right], edges: [{ ...directEdge, attributes: { endpoint_pairs: [{ ...directEdge.attributes.endpoint_pairs![0], ...(collapsedCable ? { cable_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Cable', entity_id: 'cable' } } : {}) }] } }] };
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => (await import('../topology/layout')).toFlowProjection(input)} />);
    expect(await screen.findByTestId(collapsedCable ? 'svg-path-collapsed-cable:cable' : 'svg-path-left-right::member::member')).toHaveAttribute('d', 'M0,0L1,1');
  });

  it('does not apply a stale layout after a fast projection switch', async () => {
    const logical = documentFor('logical-A');
    const physical = documentFor('physical-B');
    const logicalResult = deferred<FlowProjection>();
    const physicalResult = deferred<FlowProjection>();
    const layoutEngine: TopologyLayoutEngine = vi.fn((scene) => (
      scene.layer === 'L1' ? physicalResult.promise : logicalResult.promise
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

    await act(async () => { physicalResult.resolve(flowFor((await import('../topology/presentationScene')).presentationSceneDocument(physical))); });
    expect(screen.getByRole('button', { name: 'physical-B' })).toBeInTheDocument();

    await act(async () => { logicalResult.resolve(flowFor((await import('../topology/presentationScene')).presentationSceneDocument(logical))); });
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
    const layoutEngine: TopologyLayoutEngine = vi.fn((scene) => scene.nodes[0]?.id === first.nodes[0]?.id ? Promise.resolve(flowFor(scene)) : next.promise);
    const view = render(<TopologyCanvas document={first} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} />);
    await screen.findByTestId('flow');
    await waitFor(() => expect(fitViewMock).toHaveBeenCalledTimes(1));
    view.rerender(<TopologyCanvas document={refreshed} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} />);
    expect(screen.getByTestId('flow')).toBeInTheDocument();
    expect(fitViewMock).toHaveBeenCalledTimes(1);
    await act(async () => { next.resolve(flowFor((await import('../topology/presentationScene')).presentationSceneDocument(refreshed))); });
    await screen.findByTestId('flow');
    expect(fitViewMock).toHaveBeenCalledTimes(1);
  });

  it('does not move the viewport when selection changes in a scene', async () => {
    fitViewMock.mockClear();
    const first = documentFor('physical-A');
    const second = { ...first.nodes[0], id: 'physical-B' };
    const document = { ...first, nodes: [first.nodes[0], second] };
    const layoutEngine: TopologyLayoutEngine = vi.fn(async (scene) => flowFor(scene));
    const view = render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} />);
    await screen.findByTestId('flow');
    await waitFor(() => expect(fitViewMock).toHaveBeenCalledTimes(1));

    view.rerender(<TopologyCanvas document={document} selection={{ type: 'node', item: document.nodes[0] }} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} />);
    expect(fitViewMock).toHaveBeenCalledTimes(1);

    view.rerender(<TopologyCanvas document={document} selection={{ type: 'node', item: document.nodes[1] }} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} />);
    expect(fitViewMock).toHaveBeenCalledTimes(1);

    view.rerender(<TopologyCanvas document={document} selection={{ type: 'node', item: document.nodes[1] }} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} traceOverlay={{ highlightedNodeIds: new Set(['physical-B']), highlightedEdgeIds: new Set(), highlightedConnectionMemberIds: new Set(), highlightedCableIds: new Set() }} />);
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
    view.rerender(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} sceneKey="map-a/physical" layoutEngine={layoutEngine} traceOverlay={{ highlightedNodeIds: new Set(['physical-A']), highlightedEdgeIds: new Set(), highlightedConnectionMemberIds: new Set(['member-1']), highlightedCableIds: new Set() }} />);
    expect(screen.getByTestId('highlighted-members-physical-A')).toHaveTextContent('member-1');
    expect(layoutEngine).toHaveBeenCalledTimes(1);
    expect(fitViewMock).toHaveBeenCalledTimes(1);
  });

  it('traces only the selected Cable when parallel Cables share supporting projection edges', async () => {
    const document: TopologyProjectionDocument = {
      schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', gaps: [], warnings: [],
      nodes: [{ id: 'a', kind: 'PHYSICAL_OBJECT', label: 'A', source_refs: [], attributes: {} }, { id: 'b', kind: 'PHYSICAL_OBJECT', label: 'B', source_refs: [], attributes: {} }], edges: [],
    };
    const cable = (id: string) => ({ id: `cable:${id}`, kind: 'CABLE', label: id, source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'Cable', entity_id: id }], attributes: {} });
    const layoutEngine: TopologyLayoutEngine = vi.fn(async () => ({
      nodes: flowFor((await import('../topology/presentationScene')).presentationSceneDocument(document)).nodes,
      edges: ['cable-one', 'cable-two'].map((id) => ({
        id: `collapsed-cable:cable:${id}`, source: 'a', target: 'b', type: 'floating' as const,
        data: { projection: { id: 'shared-edge', from_node_id: 'a', to_node_id: 'b', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: {} }, cableNode: cable(id), supportingEdgeIds: ['shared-edge'] },
      })),
    }));
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={layoutEngine} traceOverlay={{ highlightedNodeIds: new Set(), highlightedEdgeIds: new Set(['shared-edge']), highlightedConnectionMemberIds: new Set(), highlightedCableIds: new Set(['cable-one']) }} />);

    await screen.findByTestId('flow');
    expect(screen.getByTestId('traced-collapsed-cable:cable:cable-one')).toHaveTextContent('true');
    expect(screen.getByTestId('traced-collapsed-cable:cable:cable-two')).toHaveTextContent('false');
  });

  it('emphasizes only directly attached Cables while explicit selection and trace retain priority', async () => {
    const document: TopologyProjectionDocument = {
      schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', gaps: [], warnings: [],
      nodes: [{ id: 'a', kind: 'PHYSICAL_OBJECT', label: 'A', source_refs: [], attributes: {} }, { id: 'b', kind: 'PHYSICAL_OBJECT', label: 'B', source_refs: [], attributes: {} }], edges: [],
    };
    const cable = (id: string) => ({ id: `cable:${id}`, kind: 'CABLE', label: id, source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'Cable', entity_id: id }], attributes: {} });
    const layoutEngine: TopologyLayoutEngine = vi.fn(async () => ({
      nodes: flowFor((await import('../topology/presentationScene')).presentationSceneDocument(document)).nodes,
      edges: ['attached', 'unrelated', 'traced'].map((id) => ({ id, source: 'a', target: 'b', type: 'floating' as const, data: { cableNode: cable(id) } })),
    }));
    const view = render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={layoutEngine} directlyAttachedCableIds={new Set(['attached', 'traced'])} traceOverlay={{ highlightedNodeIds: new Set(), highlightedEdgeIds: new Set(), highlightedConnectionMemberIds: new Set(), highlightedCableIds: new Set(['traced']) }} />);
    await screen.findByTestId('flow');
    expect(screen.getByTestId('emphasis-attached')).toHaveTextContent('attached');
    expect(screen.getByTestId('emphasis-unrelated')).toHaveTextContent('normal');
    expect(screen.getByTestId('emphasis-traced')).toHaveTextContent('traced');
    view.rerender(<TopologyCanvas document={document} selection={{ type: 'node', item: cable('attached') }} onSelectionChange={vi.fn()} layoutEngine={layoutEngine} directlyAttachedCableIds={new Set(['attached'])} />);
    expect(screen.getByTestId('emphasis-attached')).toHaveTextContent('selected');
    view.rerender(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={layoutEngine} directlyAttachedCableIds={new Set()} />);
    expect(screen.getByTestId('emphasis-attached')).toHaveTextContent('normal');
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

  it('fits a viewport request only after the next current layout, once with the existing options', async () => {
    fitViewMock.mockClear();
    const document = documentFor('physical-A');
    const next = deferred<FlowProjection>();
    const layoutEngine = vi.fn<TopologyLayoutEngine>().mockImplementation(async (scene) => flowFor(scene));
    const props = { document, selection: null, onSelectionChange: vi.fn(), layoutEngine, sceneKey: 'same-map' };
    const view = render(<TopologyCanvas {...props} viewportFitRevision={0} />);
    await waitFor(() => expect(fitViewMock).toHaveBeenCalledTimes(1));
    fitViewMock.mockClear();
    layoutEngine.mockReturnValueOnce(next.promise);
    view.rerender(<TopologyCanvas {...props} viewportFitRevision={1} />);
    expect(layoutEngine).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'physical-A' })).toBeInTheDocument();
    expect(fitViewMock).not.toHaveBeenCalled();
    const projection = flowFor(layoutEngine.mock.calls[1][0]);
    await act(async () => next.resolve(projection));
    expect(fitViewMock).toHaveBeenCalledExactlyOnceWith({ duration: 300, maxZoom: 1.1, padding: 0.2 });
    view.rerender(<TopologyCanvas {...props} viewportFitRevision={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'measure physical-A' }));
    expect(fitViewMock).toHaveBeenCalledTimes(1);
    // An ordinary refresh with the same token must not consume the request again.
    view.rerender(<TopologyCanvas {...props} document={{ ...document }} viewportFitRevision={1} />);
    await waitFor(() => expect(layoutEngine).toHaveBeenCalledTimes(3));
    expect(fitViewMock).toHaveBeenCalledTimes(1);
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
  it('keeps text annotation placement and selection active on the physical canvas', async () => {
    const place = vi.fn();
    const select = vi.fn();
    const annotation = { annotation_ref: { entity_type: 'MapTextAnnotation' as const, entity_id: 'text-a' }, text: 'Note', position: { x: 12, y: 34 }, text_color: '#123456', font_size: 16 };
    render(<TopologyCanvas document={documentFor('physical-text')} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} textAnnotations={[annotation]} annotationMode={{ annotationPlacement: true, onAnnotationPlace: place, onAnnotationSelect: select }} />);
    await screen.findByTestId('map-text-annotation-text-a');
    fireEvent.click(screen.getByRole('button', { name: 'click pane' }), { clientX: 10, clientY: 20 });
    expect(place).toHaveBeenCalledWith({ x: 10, y: 20 });
    fireEvent.click(screen.getByTestId('map-text-annotation-text-a'));
    expect(select).toHaveBeenCalledWith('text-a');
  });
});
