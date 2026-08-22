import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopologyCanvas } from './TopologyCanvas';
import type { FlowProjection, TopologyLayoutEngine } from '../topology/layout';
import type { TopologyProjectionDocument } from '../topology/types';

vi.mock('@xyflow/react', () => ({
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  MiniMap: () => null,
  ReactFlow: ({ nodes, onNodeClick }: {
    nodes: FlowProjection['nodes'];
    onNodeClick: (event: unknown, node: FlowProjection['nodes'][number]) => void;
  }) => (
    <div data-testid="flow">
      {nodes.map((node) => (
        <button key={node.id} onClick={() => onNodeClick({}, node)}>{node.id}</button>
      ))}
    </div>
  ),
  useReactFlow: () => ({ fitView: vi.fn() }),
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
});
