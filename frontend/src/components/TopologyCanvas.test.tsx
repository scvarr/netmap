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
  ReactFlow: ({ nodes, onNodeClick, onNodesChange, onNodeDragStop, children }: {
    nodes: FlowProjection['nodes'];
    onNodeClick: (event: unknown, node: FlowProjection['nodes'][number]) => void;
    onNodesChange: (changes: unknown[]) => void;
    onNodeDragStop: (event: unknown, node: FlowProjection['nodes'][number]) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="flow">
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
});
