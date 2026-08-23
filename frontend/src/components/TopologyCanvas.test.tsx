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
  ReactFlow: ({ nodes, edges, onNodeClick, onNodesChange, onNodeDragStop, children }: {
    nodes: FlowProjection['nodes'];
    edges: FlowProjection['edges'];
    onNodeClick: (event: unknown, node: FlowProjection['nodes'][number]) => void;
    onNodesChange: (changes: unknown[]) => void;
    onNodeDragStop: (event: unknown, node: FlowProjection['nodes'][number]) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="flow">
      <svg>{edges.map((edge) => <path key={edge.id} data-testid={`svg-path-${edge.id}`} d="M0,0L1,1" />)}</svg>
      {nodes.map((node) => (
        <div key={node.id}>
          <button onClick={() => onNodeClick({}, node)}>{node.id}</button>
          <span data-testid={`position-${node.id}`}>{node.position.x},{node.position.y}</span>
          <button onClick={() => {
            const dragged = { ...node, position: { x: 42, y: 84 } };
            onNodesChange([{ id: node.id, type: 'position', position: dragged.position }]);
            onNodeDragStop({}, dragged);
          }}>drag {node.id}</button>
        </div>
      ))}
      {children}
    </div>
  ),
  useInternalNode: () => undefined,
  useReactFlow: () => ({ fitView: fitViewMock }),
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
  it.each([
    ['blueprint to blueprint', false, false],
    ['blueprint to generic', false, true],
    ['collapsed cable between blueprint nodes', true, false],
  ])('renders an SVG path for %s', async (_, collapsedCable, genericTarget) => {
    const blueprint = (id: string, point: string) => ({
      id, kind: 'PHYSICAL_OBJECT', label: id, source_refs: [], attributes: {
        blueprint_presentation: { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint', entity_id: `${id}-bp` }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion', entity_id: `${id}-v` }, body: { kind: 'RECTANGLE' as const, width: 120, height: 40 }, slots: [{ slot_key: 'port', display_name: 'port', kind: 'CONNECTION_POINT' as const, anchor: { side: 'RIGHT' as const, offset: .5 }, connection_point_id: point }] },
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
