import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopologyCanvas } from './TopologyCanvas';
import type { FlowProjection, TopologyLayoutEngine } from '../topology/layout';
import type { TopologyProjectionDocument } from '../topology/types';
import type { PresentationSceneDocument } from '../topology/presentationScene';
import type { TopologyLayoutStore } from '../topology/layoutStore';
import type { MapRegion } from '../topology/savedMapTypes';

const { fitViewMock, screenTransform } = vi.hoisted(() => ({
  fitViewMock: vi.fn(),
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
      {nodes.map((node) => (
        <div key={node.id}>
          <button onClick={() => onNodeClick({}, node)}>{node.id}</button>
          <button onClick={() => onNodeContextMenu?.({ preventDefault: vi.fn() }, node)}>context {node.id}</button>
          <span data-testid={`position-${node.id}`}>{node.position.x},{node.position.y}</span>
          <span data-testid={`parent-${node.id}`}>{node.parentId ?? 'none'}</span>
          <span data-testid={`highlighted-members-${node.id}`}>{[...(node.data.traceHighlightedConnectionMemberIds ?? [])].join(',')}</span>
          <span data-testid={`location-focus-${node.id}`}>{node.data.locationFocus ?? 'none'}</span>
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
  nodes: scene.nodes.map((projection) => ({
    id: projection.id,
    type: 'device',
    position: { x: 0, y: 0 },
    data: { projection },
  })),
  edges: [],
});

const region: MapRegion = {
  region_ref: { entity_type: 'MapRegion', entity_id: 'region-a' },
  label: 'Zone A',
  points: [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 90 }, { x: 10, y: 90 }],
  style: { fill_color: '#123456', fill_opacity: .25, stroke_color: '#abcdef', stroke_width: 3, stroke_style: 'dashed' },
  z_order: 2,
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
};

afterEach(() => {
  screenTransform.scale = 1;
  screenTransform.offsetX = 0;
  screenTransform.offsetY = 0;
});

describe('TopologyCanvas async layout boundary', () => {
  it('docks the minimap above the trace control at the bottom right', async () => {
    render(<TopologyCanvas document={documentFor('physical-minimap')} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} />);
    expect(await screen.findByTestId('minimap')).toHaveAttribute('data-position', 'bottom-right');
    expect(screen.getByTestId('minimap')).toHaveAttribute('data-class', 'topology-canvas__minimap');
  });

  it('marks matching Location objects and dims unrelated objects without topology writes', async () => {
    const matched = { ...documentFor('physical-match').nodes[0], source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'matched-object' }] };
    const unrelated = { ...documentFor('physical-unrelated').nodes[0], source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'unrelated-object' }] };
    const document = { ...documentFor('physical-scene'), nodes: [matched, unrelated] };
    const layoutEngine: TopologyLayoutEngine = vi.fn(async (input) => flowFor(input));
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={layoutEngine} locationFocusObjectIds={new Set(['matched-object'])} />);

    expect(await screen.findByTestId('location-focus-physical-match')).toHaveTextContent('match');
    expect(screen.getByTestId('location-focus-physical-unrelated')).toHaveTextContent('dim');
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

  it('routes composite membership mode only to eligible objects while blocking selection and movement', async () => {
    const object = { ...documentFor('physical-member').nodes[0], source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'object-id' }] };
    const edge = { id: 'edge-id', from_node_id: object.id, to_node_id: object.id, kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: {} };
    const document = { ...documentFor('physical-member'), nodes: [object], edges: [edge] };
    const layoutEngine: TopologyLayoutEngine = async () => ({ nodes: [{ id: object.id, type: 'device', position: { x: 0, y: 0 }, data: { projection: object } }], edges: [{ id: edge.id, source: object.id, target: object.id, type: 'floating', data: { projection: edge } }] });
    const onSelectionChange = vi.fn(); const onPhysicalObjectClick = vi.fn(); const onPhysicalNodeDragStop = vi.fn(); const onPhysicalNodeContextMenu = vi.fn(); const onPhysicalPaneContextMenu = vi.fn();
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={onSelectionChange} layoutEngine={layoutEngine} draggableNodeIds={new Set([object.id])} onPhysicalNodeDragStop={onPhysicalNodeDragStop} onPhysicalNodeContextMenu={onPhysicalNodeContextMenu} onPhysicalPaneContextMenu={onPhysicalPaneContextMenu} compositeMemberSelection={{ selectedPhysicalObjectIds: new Set(), onPhysicalObjectClick }} />);

    fireEvent.click(await screen.findByRole('button', { name: object.id }));
    fireEvent.click(screen.getByRole('button', { name: `edge ${edge.id}` }));
    fireEvent.click(screen.getByRole('button', { name: `drag ${object.id}` }));
    fireEvent.click(screen.getByRole('button', { name: 'click pane' }));
    fireEvent.click(screen.getByRole('button', { name: `context ${object.id}` }));
    fireEvent.click(screen.getByRole('button', { name: 'context pane' }));

    expect(onPhysicalObjectClick).toHaveBeenCalledWith('object-id');
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onPhysicalNodeDragStop).not.toHaveBeenCalled();
    expect(onPhysicalNodeContextMenu).not.toHaveBeenCalled();
    expect(onPhysicalPaneContextMenu).not.toHaveBeenCalled();
    expect(screen.getByTestId(`draggable-${object.id}`)).toHaveTextContent('false');
  });

  it('renders persisted Regions without intercepting normal topology selection', async () => {
    const document = documentFor('physical-region');
    const onSelectionChange = vi.fn();
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={onSelectionChange} layoutEngine={async (input) => flowFor(input)} regions={[region]} />);

    const rendered = await screen.findByTestId('map-region-region-a');
    expect(rendered.querySelector('polygon')).toHaveAttribute('fill', '#123456');
    expect(rendered.querySelector('text')).toHaveTextContent('Zone A');
    fireEvent.click(screen.getByRole('button', { name: 'physical-region' }));
    expect(onSelectionChange).toHaveBeenCalledWith({ type: 'node', item: document.nodes[0] });
  });

  it('replaces topology interaction and cables with real-bounds reference outlines in Region mode', async () => {
    const document: TopologyProjectionDocument = {
      ...documentFor('physical-region-mode'),
      nodes: [{ id: 'object-a', kind: 'PHYSICAL_OBJECT', label: 'Object A', source_refs: [], attributes: {} }],
      edges: [{ id: 'edge-a', from_node_id: 'object-a', to_node_id: 'object-a', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: {} }],
    };
    const layoutEngine: TopologyLayoutEngine = async () => ({
      nodes: [{ id: 'object-a', type: 'device', position: { x: 40, y: 60 }, width: 320, height: 80, data: { projection: document.nodes[0] } }],
      edges: [{ id: 'edge-a', source: 'object-a', target: 'object-a', type: 'floating', data: { projection: document.edges[0] } }],
    });
    const onSelectionChange = vi.fn();
    const view = render(<TopologyCanvas document={document} selection={null} onSelectionChange={onSelectionChange} layoutEngine={layoutEngine} regions={[region]} />);
    await screen.findByRole('button', { name: 'object-a' });
    view.rerender(<TopologyCanvas document={document} selection={null} onSelectionChange={onSelectionChange} layoutEngine={layoutEngine} regions={[region]} regionMode={{ showReferenceOutlines: true }} />);

    expect(await screen.findByTestId('map-reference-outline-object-a')).toHaveAttribute('width', '320');
    expect(screen.getByTestId('map-reference-outline-object-a')).toHaveAttribute('height', '80');
    expect(screen.queryByRole('button', { name: 'object-a' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('svg-path-edge-a')).not.toBeInTheDocument();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('uses React Flow measurement for an ordinary object outline without explicit layout dimensions', async () => {
    const document: TopologyProjectionDocument = {
      ...documentFor('physical-measured-region-mode'),
      nodes: [{ id: 'ordinary-object', kind: 'PHYSICAL_OBJECT', label: 'Ordinary', source_refs: [], attributes: {} }],
    };
    const layoutEngine: TopologyLayoutEngine = async () => ({
      nodes: [{ id: 'ordinary-object', type: 'device', position: { x: 10, y: 20 }, data: { projection: document.nodes[0] } }],
      edges: [],
    });
    const view = render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={layoutEngine} />);
    await screen.findByRole('button', { name: 'ordinary-object' });
    fireEvent.click(screen.getByRole('button', { name: 'measure ordinary-object' }));
    view.rerender(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={layoutEngine} regionMode={{ showReferenceOutlines: true }} />);
    expect(await screen.findByTestId('map-reference-outline-ordinary-object')).toHaveAttribute('x', '10');
    expect(screen.getByTestId('map-reference-outline-ordinary-object')).toHaveAttribute('width', '178');
    expect(screen.getByTestId('map-reference-outline-ordinary-object')).toHaveAttribute('height', '112');
  });

  it('can hide Region-mode object outlines while keeping the persisted Region layer', async () => {
    const document = documentFor('physical-region-hidden');
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} regions={[region]} regionMode={{ showReferenceOutlines: false }} />);
    expect(await screen.findByTestId('map-region-region-a')).toBeInTheDocument();
    expect(screen.queryByTestId('map-reference-outlines')).not.toBeInTheDocument();
  });

  it('renders an active draft above persisted Regions and sends pane points in flow coordinates', async () => {
    const document = documentFor('physical-region-draft');
    const onDraftPoint = vi.fn();
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} regions={[region]} regionMode={{ showReferenceOutlines: true, draft: { status: 'drawing', points: [{ x: 1, y: 2 }, { x: 30, y: 2 }, { x: 30, y: 40 }] }, onDraftPoint }} />);

    expect(await screen.findByTestId('map-region-region-a')).toBeInTheDocument();
    expect(screen.getByTestId('map-reference-outlines')).toBeInTheDocument();
    expect(screen.getByTestId('map-region-draft-fill')).toHaveAttribute('points', '1,2 30,2 30,40');
    expect(screen.getByTestId('map-region-draft-segments')).toBeInTheDocument();
    expect(screen.getByTestId('map-region-draft-close')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'move pane' }));
    expect(screen.getByTestId('map-region-draft-preview')).toHaveAttribute('x2', '30');
    fireEvent.click(screen.getByRole('button', { name: 'click pane' }), { ctrlKey: true });
    expect(onDraftPoint).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it('uses the same screen-axis constrained point for Region draft preview and click', async () => {
    screenTransform.scale = 2;
    screenTransform.offsetX = 100;
    screenTransform.offsetY = 50;
    const onDraftPoint = vi.fn();
    render(<TopologyCanvas document={documentFor('physical-region-shift')} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} regionMode={{ showReferenceOutlines: true, draft: { status: 'drawing', points: [{ x: 10, y: 20 }] }, onDraftPoint }} />);

    await screen.findByTestId('map-region-draft');
    fireEvent.mouseMove(screen.getByRole('button', { name: 'move pane' }), { clientX: 150, clientY: 100, shiftKey: true });
    expect(screen.getByTestId('map-region-draft-preview')).toHaveAttribute('x2', '25');
    expect(screen.getByTestId('map-region-draft-preview')).toHaveAttribute('y2', '20');
    fireEvent.click(screen.getByRole('button', { name: 'click pane' }), { clientX: 150, clientY: 100, shiftKey: true });
    expect(onDraftPoint).toHaveBeenCalledWith({ x: 25, y: 20 });
  });

  it('completes a three-point draft by screen-space click on its first vertex without appending it', async () => {
    const onDraftPoint = vi.fn(); const onCompleteDraft = vi.fn();
    render(<TopologyCanvas document={documentFor('physical-region-close')} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} regionMode={{ showReferenceOutlines: true, draft: { status: 'drawing', points: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 50 }] }, onDraftPoint, onCompleteDraft }} />);
    await screen.findByTestId('map-region-draft');
    fireEvent.mouseMove(screen.getByRole('button', { name: 'move pane' }), { clientX: 17, clientY: 25 });
    expect(screen.getByTestId('map-region-draft-preview')).toHaveAttribute('x2', '10');
    expect(screen.getByTestId('map-region-draft-preview')).toHaveAttribute('y2', '20');
    expect(screen.getByTestId('map-region-draft-vertex-0')).toHaveAttribute('data-closing-target', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'click pane' }), { clientX: 17, clientY: 25 });
    expect(onCompleteDraft).toHaveBeenCalledTimes(1); expect(onDraftPoint).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'click pane' }), { clientX: 80, clientY: 20, ctrlKey: true });
    expect(onDraftPoint).toHaveBeenCalledWith({ x: 80, y: 20 });
  });

  it('uses the same closing hit radius under pan, zoom, and Shift', async () => {
    screenTransform.scale = 2; screenTransform.offsetX = 100; screenTransform.offsetY = 50;
    const onDraftPoint = vi.fn(); const onCompleteDraft = vi.fn();
    render(<TopologyCanvas document={documentFor('physical-region-close-scaled')} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} regionMode={{ showReferenceOutlines: true, draft: { status: 'drawing', points: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 50 }] }, onDraftPoint, onCompleteDraft }} />);
    await screen.findByTestId('map-region-draft');
    fireEvent.click(screen.getByRole('button', { name: 'click pane' }), { clientX: 126, clientY: 94, shiftKey: true });
    expect(onCompleteDraft).toHaveBeenCalledTimes(1); expect(onDraftPoint).not.toHaveBeenCalled();
  });

  it('edits only the active draft through vertex, midpoint, and polygon pointer drags', async () => {
    const onMoveDraftVertex = vi.fn(); const onInsertDraftVertex = vi.fn(); const onTranslateDraft = vi.fn(); const onSelectDraftVertex = vi.fn();
    render(<TopologyCanvas document={documentFor('physical-region-editor')} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} regions={[region]} regionMode={{ showReferenceOutlines: true, editableDraft: true, draft: { status: 'editing', points: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 50 }] }, onMoveDraftVertex, onInsertDraftVertex, onTranslateDraft, onSelectDraftVertex }} />);
    await screen.findByTestId('region-draft-editor');
    fireEvent.pointerDown(screen.getByTestId('region-draft-editor-vertex-1'), { clientX: 40, clientY: 20 }); fireEvent.pointerMove(window, { clientX: 44, clientY: 25, ctrlKey: true }); fireEvent.pointerUp(window);
    expect(onSelectDraftVertex).toHaveBeenCalledWith(1); expect(onMoveDraftVertex).toHaveBeenCalledWith(1, { x: 44, y: 25 });
    fireEvent.pointerDown(screen.getByTestId('region-draft-midpoint-1'), { clientX: 40, clientY: 35 }); fireEvent.pointerMove(window, { clientX: 43, clientY: 37, ctrlKey: true }); fireEvent.pointerUp(window);
    expect(onInsertDraftVertex).toHaveBeenCalledWith(1, { x: 40, y: 35 }); expect(onMoveDraftVertex).toHaveBeenLastCalledWith(2, { x: 43, y: 37 });
    fireEvent.pointerDown(screen.getByTestId('region-draft-editor').querySelector('polygon')!, { clientX: 20, clientY: 25 }); fireEvent.pointerMove(window, { clientX: 24, clientY: 30 }); fireEvent.pointerUp(window);
    expect(onSelectDraftVertex).toHaveBeenLastCalledWith(null); expect(onTranslateDraft).toHaveBeenCalledWith({ x: 4, y: 5 });
  });

  it('uses the dominant screen-space Y delta for a vertical Shift-constrained Region segment', async () => {
    screenTransform.scale = 2;
    screenTransform.offsetX = 100;
    screenTransform.offsetY = 50;
    render(<TopologyCanvas document={documentFor('physical-region-shift-y')} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} regionMode={{ showReferenceOutlines: true, draft: { status: 'drawing', points: [{ x: 10, y: 20 }] }, onDraftPoint: vi.fn() }} />);

    await screen.findByTestId('map-region-draft');
    fireEvent.mouseMove(screen.getByRole('button', { name: 'move pane' }), { clientX: 130, clientY: 120, shiftKey: true });
    expect(screen.getByTestId('map-region-draft-preview')).toHaveAttribute('x2', '10');
    expect(screen.getByTestId('map-region-draft-preview')).toHaveAttribute('y2', '35');
  });

  it('keeps Region points free with Ctrl and does not constrain the first point', async () => {
    screenTransform.scale = 2;
    screenTransform.offsetX = 100;
    screenTransform.offsetY = 50;
    const onDraftPoint = vi.fn();
    const view = render(<TopologyCanvas document={documentFor('physical-region-free')} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} regionMode={{ showReferenceOutlines: true, draft: { status: 'drawing', points: [{ x: 10, y: 20 }] }, onDraftPoint }} />);

    await screen.findByTestId('map-region-draft');
    fireEvent.mouseMove(screen.getByRole('button', { name: 'move pane' }), { clientX: 150, clientY: 120, ctrlKey: true });
    expect(screen.getByTestId('map-region-draft-preview')).toHaveAttribute('x2', '25');
    expect(screen.getByTestId('map-region-draft-preview')).toHaveAttribute('y2', '35');
    view.rerender(<TopologyCanvas document={documentFor('physical-region-first')} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} regionMode={{ showReferenceOutlines: true, draft: { status: 'drawing', points: [] }, onDraftPoint }} />);
    fireEvent.click(screen.getByRole('button', { name: 'click pane' }), { clientX: 151, clientY: 119, shiftKey: true });
    expect(onDraftPoint).toHaveBeenLastCalledWith({ x: 25.5, y: 34.5 });
  });

  it('uses one assisted point and feedback for drawing preview and committed click', async () => {
    const onDraftPoint = vi.fn();
    render(<TopologyCanvas document={documentFor('physical-region-assist')} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} regionMode={{ showReferenceOutlines: true, draft: { status: 'drawing', points: [{ x: 0, y: 0 }] }, onDraftPoint }} />);
    await screen.findByTestId('map-region-draft');
    fireEvent.mouseMove(screen.getByRole('button', { name: 'move pane' }), { clientX: 98, clientY: 18 });
    expect(screen.getByTestId('map-region-draft-assist-feedback')).toHaveAttribute('data-snapped-angle', 'true');
    expect(screen.getByTestId('map-region-draft-assist-feedback')).toHaveAttribute('data-snapped-length', 'true');
    const preview = screen.getByTestId('map-region-draft-preview');
    fireEvent.click(screen.getByRole('button', { name: 'click pane' }), { clientX: 98, clientY: 18 });
    expect(onDraftPoint).toHaveBeenCalledWith({ x: Number(preview.getAttribute('x2')), y: Number(preview.getAttribute('y2')) });
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

  it('routes drag eligibility and stop callbacks separately for synthetic composites', async () => {
    const physical = { ...documentFor('physical-node').nodes[0], source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'object-a' }] };
    const document = { ...documentFor('physical-node'), nodes: [physical] };
    const onPhysicalNodeDragStop = vi.fn(); const onCompositeDragStop = vi.fn();
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} draggableNodeIds={new Set([physical.id])} onPhysicalNodeDragStop={onPhysicalNodeDragStop} onCompositeDragStop={onCompositeDragStop} compositeInputs={[{ id: 'rack', displayName: 'Rack', memberNodeIds: [], collapsed: true, x: 10, y: 20, width: 280, height: 180 }]} />);
    await screen.findByRole('button', { name: physical.id });
    expect(screen.getByTestId(`draggable-${physical.id}`)).toHaveTextContent('true');
    expect(screen.getByTestId('draggable-map-composite:rack')).toHaveTextContent('true');
    fireEvent.click(screen.getByRole('button', { name: 'drag map-composite:rack' }));
    expect(onCompositeDragStop).toHaveBeenCalledWith('rack', { x: 42, y: 84, width: 200, height: 74 });
    expect(onPhysicalNodeDragStop).not.toHaveBeenCalled();
  });

  it('keeps a collapsed boundary object selectable but makes it a non-draggable frame child', async () => {
    const boundary = { ...documentFor('boundary').nodes[0], source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'boundary-object' }] };
    const outside = { ...boundary, id: 'outside', label: 'outside', source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'outside-object' }] };
    const document = { ...documentFor('physical-boundary'), nodes: [boundary, outside], edges: [{ id: 'crossing', from_node_id: boundary.id, to_node_id: outside.id, kind: 'L1_PHYSICAL_LINK' as const, aggregate: false, source_refs: [], attributes: {} }] };
    const onSelectionChange = vi.fn();
    const onPhysicalNodeDragStop = vi.fn();
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={onSelectionChange} layoutEngine={async (input) => flowFor(input)} draggableNodeIds={new Set([boundary.id, outside.id])} onPhysicalNodeDragStop={onPhysicalNodeDragStop} onCompositeDragStop={vi.fn()} compositeInputs={[{ id: 'rack', displayName: 'Rack', memberNodeIds: [boundary.id], collapsed: true, x: 10, y: 20, width: 280, height: 180 }]} />);

    await screen.findByRole('button', { name: boundary.id });
    expect(screen.getByTestId(`parent-${boundary.id}`)).toHaveTextContent('map-composite:rack');
    expect(screen.getByTestId(`draggable-${boundary.id}`)).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('button', { name: boundary.id }));
    expect(onSelectionChange).toHaveBeenCalledWith({ type: 'node', item: boundary });
    fireEvent.click(screen.getByRole('button', { name: `drag ${boundary.id}` }));
    expect(onPhysicalNodeDragStop).not.toHaveBeenCalled();
  });

  it('derives an expanded composite outline behind ordinary independent member nodes', async () => {
    const member = { ...documentFor('member').nodes[0], source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: 'member-object' }] };
    const document = { ...documentFor('physical-member'), nodes: [member] };
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={vi.fn()} layoutEngine={async (input) => flowFor(input)} draggableNodeIds={new Set([member.id])} onPhysicalNodeDragStop={vi.fn()} compositeInputs={[{ id: 'rack', displayName: 'Rack', memberNodeIds: [member.id], collapsed: false, x: 10, y: 20, width: 900, height: 900 }]} />);
    await screen.findByRole('button', { name: member.id });
    expect(screen.getByTestId('parent-member')).toHaveTextContent('none');
    expect(screen.getByTestId('draggable-member')).toHaveTextContent('true');
    expect(screen.getByTestId('position-map-composite:rack')).toHaveTextContent('-10,-44');
    expect(screen.getByTestId('draggable-map-composite:rack')).toHaveTextContent('false');
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
