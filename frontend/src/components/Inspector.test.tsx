import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TopologyProjectionDocument } from '../topology/types';
import { Inspector } from './Inspector';

const document: TopologyProjectionDocument = {
  schema_version: '1.0',
  layer: 'L2',
  detail_level: 'DEVICE',
  nodes: [
    {
      id: 'projection-core-a',
      kind: 'NETWORK_DEVICE',
      label: 'CORE-A',
      status: 'CONFIGURED',
      attributes: { owned_interface_count: 3 },
      source_refs: [{
        ref_type: 'CANONICAL_FACT',
        entity_type: 'PhysicalObject',
        entity_id: 'po-core-a',
      }],
    },
    {
      id: 'projection-device-b',
      kind: 'NETWORK_DEVICE',
      label: 'PhysicalObject abcdef12',
      status: 'CONFIGURED',
      attributes: { label_source: 'TECHNICAL_FALLBACK', owned_interface_count: 2 },
      source_refs: [{
        ref_type: 'CANONICAL_FACT',
        entity_type: 'PhysicalObject',
        entity_id: 'abcdef12-0000-0000-0000-000000000000',
      }],
    },
  ],
  edges: [{
    id: 'projection-edge-a-b',
    from_node_id: 'projection-core-a',
    to_node_id: 'projection-device-b',
    kind: 'L2_DEVICE_CONNECTIVITY',
    aggregate: true,
    status: 'CONFIGURED',
    source_refs: [{
      ref_type: 'CANONICAL_FACT',
      entity_type: 'Connection',
      entity_id: 'connection-a-b',
    }],
    attributes: {
      supporting_path_count: 2,
      supporting_interface_pair_count: 2,
    },
  }],
  gaps: [],
  warnings: [],
};

const renderInspector = (
  selection: Parameters<typeof Inspector>[0]['selection'],
  onSelectNode = vi.fn(),
) => {
  render(
    <Inspector
      document={document}
      selection={selection}
      onSelectNode={onSelectNode}
      onClose={() => undefined}
    />,
  );
  return onSelectNode;
};

describe('Inspector', () => {
  it('shows incident neighbors, interface count, and human status for a device', () => {
    renderInspector({ type: 'node', item: document.nodes[0] });

    expect(screen.getByRole('heading', { name: 'CORE-A' })).toBeInTheDocument();
    expect(screen.getByText('Настроено')).toBeInTheDocument();
    expect(screen.getByText('Интерфейсов').parentElement).toHaveTextContent('3');
    expect(screen.getByText('Связей').parentElement).toHaveTextContent('1');
    const neighbor = screen.getByRole('button', { name: /Устройство abcdef12/ });
    expect(neighbor).toHaveTextContent('Физических путей: 2');
    expect(neighbor).toHaveTextContent('Пар интерфейсов: 2');
  });

  it('changes selection when a neighbor is clicked', async () => {
    const onSelectNode = renderInspector({ type: 'node', item: document.nodes[0] });

    await userEvent.click(screen.getByRole('button', { name: /Устройство abcdef12/ }));

    expect(onSelectNode).toHaveBeenCalledWith(document.nodes[1]);
  });

  it('uses human endpoint labels and explains aggregate supporting data', () => {
    renderInspector({ type: 'edge', item: document.edges[0] });

    expect(screen.getByRole('heading', {
      name: 'CORE-A ↔ Устройство abcdef12',
    })).toBeInTheDocument();
    expect(screen.getByText('Физических путей').parentElement).toHaveTextContent('2');
    expect(screen.getByText('Пар интерфейсов').parentElement).toHaveTextContent('2');
    expect(screen.getByText('Агрегированная').parentElement).toHaveTextContent('Да');
    expect(screen.getByText(/объединяет физические пути/)).toBeInTheDocument();
  });

  it('selects both edge endpoints from the inspector', async () => {
    const onSelectNode = renderInspector({ type: 'edge', item: document.edges[0] });
    const endpoints = screen.getByRole('heading', { name: 'Устройства' }).parentElement!;

    await userEvent.click(within(endpoints).getByRole('button', { name: 'CORE-A' }));
    await userEvent.click(within(endpoints).getByRole('button', { name: 'Устройство abcdef12' }));

    expect(onSelectNode).toHaveBeenNthCalledWith(1, document.nodes[0]);
    expect(onSelectNode).toHaveBeenNthCalledWith(2, document.nodes[1]);
  });

  it('keeps raw source refs and projection IDs in collapsed technical details', async () => {
    renderInspector({ type: 'edge', item: document.edges[0] });

    const details = screen.getByText('Технические детали').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    await userEvent.click(within(details).getByText('Технические детали'));

    expect(details).toHaveAttribute('open');
    expect(within(details).getByText('Connection')).toBeInTheDocument();
    expect(within(details).getByText('connection-a-b')).toBeInTheDocument();
    expect(within(details).getByText('projection-edge-a-b')).toBeInTheDocument();
    expect(within(details).getByText('L2_DEVICE_CONNECTIVITY')).toBeInTheDocument();
  });

  it('closes selection through the inspector control', async () => {
    const onClose = vi.fn();
    render(
      <Inspector
        document={document}
        selection={{ type: 'edge', item: document.edges[0] }}
        onSelectNode={() => undefined}
        onClose={onClose}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Закрыть инспектор' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
