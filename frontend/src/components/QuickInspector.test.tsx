import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { QuickInspector } from './QuickInspector';
import type { TopologyProjectionDocument, TopologyProjectionNode } from '../topology/types';

const node = (className?: string): TopologyProjectionNode => ({
  id: 'node', kind: 'PHYSICAL_OBJECT', label: className === 'cable' ? 'cable-01' : 'PC1',
  attributes: { class: className, connection_point_count: 1, owned_interface_count: 0 },
  source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'object-1' }],
});
const document = (layer: 'L1' | 'L2', item = node()): TopologyProjectionDocument => ({
  schema_version: '1.0', layer, detail_level: layer === 'L1' ? 'PHYSICAL_OBJECT' : 'DEVICE', nodes: [item], edges: [], gaps: [], warnings: [],
});

describe('QuickInspector physical delete', () => {
  it('confirms physical object name and delegates only after confirmation', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<BrowserRouter><QuickInspector document={document('L1')} selection={{ type: 'node', item: node() }} onClose={vi.fn()} onSelectNode={vi.fn()} onDeletePhysicalObject={remove} /></BrowserRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(confirm).toHaveBeenCalledWith('Удалить объект «PC1»?');
    expect(remove).toHaveBeenCalledWith('object-1');
  });

  it('uses cable wording, retains selection on conflict, and does not expose delete on logical map', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('MODEL_ERROR: PhysicalObject is in use'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const cable = node('cable');
    const { rerender } = render(<BrowserRouter><QuickInspector document={document('L1', cable)} selection={{ type: 'node', item: cable }} onClose={vi.fn()} onSelectNode={vi.fn()} onDeletePhysicalObject={remove} /></BrowserRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(window.confirm).toHaveBeenCalledWith('Удалить кабель «cable-01» и разорвать соединение?');
    expect(await screen.findByRole('alert')).toHaveTextContent('PhysicalObject is in use');
    expect(screen.getByRole('heading', { name: 'cable-01' })).toBeInTheDocument();
    rerender(<BrowserRouter><QuickInspector document={document('L2')} selection={{ type: 'node', item: node() }} onClose={vi.fn()} onSelectNode={vi.fn()} onDeletePhysicalObject={remove} /></BrowserRouter>);
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
  });
});
