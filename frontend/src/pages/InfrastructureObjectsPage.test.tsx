import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { InfrastructureObjectsPage } from './InfrastructureObjectsPage';
import type { TopologyProjectionDocument } from '../topology/types';

const document = (nodes = [{
  id: 'node-1', kind: 'PHYSICAL_OBJECT', label: 'PC1', attributes: { class: 'workstation', connection_point_count: 1, owned_interface_count: 0 },
  source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'object-1' }],
}]): TopologyProjectionDocument => ({ schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes, edges: [], gaps: [], warnings: [] });

describe('InfrastructureObjectsPage deletion', () => {
  it('adds a trash action, confirms display label, then reloads authoritatively', async () => {
    const loadProjection = vi.fn().mockResolvedValueOnce(document()).mockResolvedValueOnce(document([]));
    const deletePhysicalObject = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryRouter><InfrastructureObjectsPage dataSource={{ loadProjection }} physicalObjectDeleteDataSource={{ deletePhysicalObject }} /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить PC1' }));
    expect(window.confirm).toHaveBeenCalledWith('Удалить объект «PC1»?');
    expect(deletePhysicalObject).toHaveBeenCalledWith('object-1');
    await waitFor(() => expect(loadProjection).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('В этом scope пока пусто')).toBeInTheDocument();
  });

  it('does not send a request when confirmation is cancelled', async () => {
    const deletePhysicalObject = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MemoryRouter><InfrastructureObjectsPage dataSource={{ loadProjection: vi.fn().mockResolvedValue(document()) }} physicalObjectDeleteDataSource={{ deletePhysicalObject }} /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить PC1' }));
    expect(deletePhysicalObject).not.toHaveBeenCalled();
  });
});
