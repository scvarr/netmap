import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { QuickInspector } from './QuickInspector';
import type { L1OffMapContinuation, TopologyProjectionDocument, TopologyProjectionEdge, TopologyProjectionNode } from '../topology/types';

const node = (className?: string): TopologyProjectionNode => ({
  id: 'node', kind: 'PHYSICAL_OBJECT', label: className === 'cable' ? 'cable-01' : 'PC1',
  attributes: { class: className, connection_point_count: 1, owned_interface_count: 0 },
  source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'object-1' }],
});
const document = (layer: 'L1' | 'L2', item = node()): TopologyProjectionDocument => ({
  schema_version: '1.0', layer, detail_level: layer === 'L1' ? 'PHYSICAL_OBJECT' : 'DEVICE', nodes: [item], edges: [], gaps: [], warnings: [],
});

describe('QuickInspector selection detail', () => {
  it('uses Russian labels for internal technical details', async () => {
    render(<BrowserRouter><QuickInspector document={document('L1')} selection={{ type: 'node', item: node() }} onClose={vi.fn()} onSelectNode={vi.fn()} /></BrowserRouter>);
    await userEvent.click(screen.getByText('Технические сведения'));
    expect(screen.getByText('Объект')).toBeInTheDocument();
    expect(screen.getByText('Идентификатор элемента схемы')).toBeInTheDocument();
    expect(screen.getByText('Тип')).toBeInTheDocument();
    expect(screen.queryByText('PhysicalObject')).not.toBeInTheDocument();
    expect(screen.queryByText('Projection ID')).not.toBeInTheDocument();
  });

  it('keeps entity type beside the ID in source reference details', async () => {
    const edge: TopologyProjectionEdge = {
      id: 'edge-1', from_node_id: 'node', to_node_id: 'node-2', kind: 'PHYSICAL_CONNECTION', aggregate: false,
      attributes: {}, status: 'CONFIGURED',
      source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'Connection', entity_id: 'connection-1' }],
    };
    render(<BrowserRouter><QuickInspector document={{ ...document('L1'), edges: [edge] }} selection={{ type: 'edge', item: edge }} onClose={vi.fn()} onSelectNode={vi.fn()} /></BrowserRouter>);
    await userEvent.click(screen.getByText('Технические сведения'));
    expect(screen.getByText('Connection: connection-1')).toBeInTheDocument();
  });

  it('does not expose ordinary destructive actions', () => {
    render(<BrowserRouter><QuickInspector document={document('L1')} selection={{ type: 'node', item: node() }} onClose={vi.fn()} onSelectNode={vi.fn()} /></BrowserRouter>);
    expect(screen.queryByRole('button', { name: 'Удалить объект из NetMap' })).not.toBeInTheDocument();
  });

  it('explains an off-map L1 continuation and can add or open its remote object', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const continuation: L1OffMapContinuation = { id: 'continuation', local_node_id: 'node', local_physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'local' }, local_connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'local-cp' }, local_connection_point_display_name: 'Rear', cable_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: 'cable' }, cable_display_name: 'cable-17', remote_physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'remote' }, remote_display_name: 'PP1', remote_connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'remote-cp' }, remote_connection_point_display_name: 'A07', source_refs: [] };
    render(<BrowserRouter><QuickInspector document={document('L1')} selection={{ type: 'continuation', item: continuation }} onClose={vi.fn()} onSelectNode={vi.fn()} onAddContinuationToMap={add} /></BrowserRouter>);
    expect(screen.getByRole('heading', { name: 'PP1' })).toBeInTheDocument();
    expect(screen.getByText('Подключено:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть объект' })).toHaveAttribute('href', '/infrastructure/objects/remote');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить на карту' }));
    expect(add).toHaveBeenCalledWith('remote');
  });

  it('shows size actions only when MapPage supplies Blueprint presentation state', async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const copy = vi.fn();
    const applyCopied = vi.fn().mockResolvedValue(undefined);
    const applySame = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<BrowserRouter><QuickInspector document={document('L1')} selection={{ type: 'node', item: node() }} onClose={vi.fn()} onSelectNode={vi.fn()} /></BrowserRouter>);
    expect(screen.queryByRole('heading', { name: 'Размер на карте' })).not.toBeInTheDocument();
    rerender(<BrowserRouter><QuickInspector document={document('L1')} selection={{ type: 'node', item: node() }} onClose={vi.fn()} onSelectNode={vi.fn()} blueprintSize={{ displayWidth: 240, copiedDisplayWidth: 320 }} onApplyBlueprintSize={apply} onCopyBlueprintSize={copy} onApplyCopiedBlueprintSize={applyCopied} onApplyBlueprintSizeToSameBlueprint={applySame} /></BrowserRouter>);
    expect(screen.getByRole('spinbutton', { name: 'Ширина' })).toHaveValue(240);
    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Ширина' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Ширина' }), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Применить размер' }));
    expect(apply).toHaveBeenCalledWith(100);
    await userEvent.click(screen.getByRole('button', { name: 'Копировать размер' }));
    await userEvent.click(screen.getByRole('button', { name: 'Применить скопированный размер' }));
    await userEvent.click(screen.getByRole('button', { name: 'Применить к тому же шаблону' }));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(applyCopied).toHaveBeenCalledTimes(1);
    expect(applySame).toHaveBeenCalledTimes(1);
  });
});
