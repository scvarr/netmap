import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type {
  TopologyDataSource,
  TopologyProjectionDocument,
  TopologySelection,
} from './topology/types';

vi.mock('./components/HealthIndicator', () => ({
  HealthIndicator: () => <div>Backend доступен</div>,
}));

vi.mock('./components/TopologyCanvas', () => ({
  TopologyCanvas: ({ document, onSelectionChange }: {
    document: TopologyProjectionDocument;
    onSelectionChange: (selection: TopologySelection) => void;
  }) => (
    <div aria-label="Логическая схема сети">
      {document.nodes.map((node) => <span key={node.id}>{node.label}</span>)}
      {document.nodes[0] && (
        <button onClick={() => onSelectionChange({ type: 'node', item: document.nodes[0] })}>
          Выбрать узел
        </button>
      )}
      {document.edges[0] && (
        <button onClick={() => onSelectionChange({ type: 'edge', item: document.edges[0] })}>
          Выбрать связь
        </button>
      )}
    </div>
  ),
}));

const document: TopologyProjectionDocument = {
  schema_version: '1.0',
  layer: 'L2',
  detail_level: 'DEVICE',
  nodes: [{
    id: 'projection-device-a',
    kind: 'NETWORK_DEVICE',
    label: 'PhysicalObject abcdef12',
    source_refs: [{
      ref_type: 'CANONICAL_FACT',
      entity_type: 'NetworkInterfacePhysicalOwner',
      entity_id: '00000000-0000-0000-0000-000000000001',
    }],
    attributes: { interface_count: 2 },
  }],
  edges: [{
    id: 'projection-edge-a-b',
    from_node_id: 'projection-device-a',
    to_node_id: 'projection-device-b',
    kind: 'LOGICAL_LINK',
    aggregate: true,
    source_refs: [{
      ref_type: 'CANONICAL_FACT',
      entity_type: 'Connection',
      entity_id: '00000000-0000-0000-0000-000000000002',
    }],
    attributes: { path_count: 1 },
  }],
  gaps: [],
  warnings: [],
};

const dataSourceFor = (result: TopologyProjectionDocument = document): TopologyDataSource => ({
  loadProjection: vi.fn().mockResolvedValue(result),
});

describe('App projection states', () => {
  it('displays topology nodes from an API projection document', async () => {
    render(<App dataSource={dataSourceFor()} />);

    expect(await screen.findByText('PhysicalObject abcdef12')).toBeInTheDocument();
    expect(screen.getByText('Настроенная проекция')).toBeInTheDocument();
    expect(screen.queryByText('Fixture data')).not.toBeInTheDocument();
  });

  it('renders the empty state from an empty API document', async () => {
    render(<App dataSource={dataSourceFor({ ...document, nodes: [], edges: [] })} />);
    expect(await screen.findByText('В этом scope пока пусто')).toBeInTheDocument();
  });

  it('renders the rejected data-source error state', async () => {
    const dataSource: TopologyDataSource = {
      loadProjection: vi.fn().mockRejectedValue(new Error('VALIDATION_ERROR: Unsupported layer')),
    };
    render(<App dataSource={dataSource} />);
    expect(await screen.findByText('VALIDATION_ERROR: Unsupported layer')).toBeInTheDocument();
  });

  it('invokes the data source again on retry', async () => {
    const loadProjection = vi.fn()
      .mockRejectedValueOnce(new Error('backend unavailable'))
      .mockResolvedValueOnce({ ...document, nodes: [], edges: [] });
    render(<App dataSource={{ loadProjection }} />);

    expect(await screen.findByText('backend unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('В этом scope пока пусто')).toBeInTheDocument();
    expect(loadProjection).toHaveBeenCalledTimes(2);
  });

  it('shows projection gaps separately from warnings', async () => {
    render(<App dataSource={dataSourceFor({
      ...document,
      gaps: ['NETWORK_INTERFACE_OWNER_UNKNOWN'],
      warnings: ['Projection is partial'],
    })} />);

    expect(await screen.findByText('NETWORK_INTERFACE_OWNER_UNKNOWN')).toBeInTheDocument();
    expect(screen.getByText('Пробел проекции')).toBeInTheDocument();
    expect(screen.getByText('Projection is partial')).toBeInTheDocument();
  });

  it('keeps node selection and inspector source refs working', async () => {
    render(<App dataSource={dataSourceFor()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать узел' }));

    expect(screen.getByRole('heading', { name: 'PhysicalObject abcdef12' })).toBeInTheDocument();
    expect(screen.getByText('NetworkInterfacePhysicalOwner')).toBeInTheDocument();
  });

  it('keeps edge selection and inspector source refs working', async () => {
    render(<App dataSource={dataSourceFor()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать связь' }));

    expect(screen.getByRole('heading', {
      name: 'projection-device-a → projection-device-b',
    })).toBeInTheDocument();
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('Да')).toBeInTheDocument();
  });
});
