import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { InfrastructureObjectDetailPage } from './InfrastructureObjectDetailPage';
import type { CatalogInventoryDocument } from '../topology/catalogInventoryTypes';
import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';

const objectId = '00000000-0000-0000-0000-000000000101';
const ref = { ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject' as const, entity_id: objectId };
const details = (className = 'switch'): PhysicalObjectDetailsDocument => ({
  schema_version: '1.0', physical_object: { source_ref: ref, label: 'SW1', class: className },
  connection_points: [], owned_interface_count: 0, gaps: [], warnings: [],
});
const inventory = (memberships: CatalogInventoryDocument['equipment'][number]['map_memberships'] = []): CatalogInventoryDocument => ({
  schema_version: '1.0', equipment: [{ physical_object_ref: ref, label: 'SW1', class: 'switch', map_memberships: memberships }], cables: [], gaps: [], warnings: [],
});

const renderPage = (objectDetails = details(), catalog = { loadCatalogInventory: vi.fn().mockResolvedValue(inventory()) }) => {
  render(
    <MemoryRouter initialEntries={[`/infrastructure/objects/${objectId}`]}>
      <Routes>
        <Route path="infrastructure/objects/:physicalObjectId" element={<InfrastructureObjectDetailPage
          dataSource={{ loadProjection: vi.fn().mockResolvedValue({ schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [], edges: [], gaps: [], warnings: [] }) }}
          deviceDetailsDataSource={{ loadDeviceDetails: vi.fn() }}
          physicalObjectDetailsDataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(objectDetails) }}
          catalogInventoryDataSource={catalog}
        />} />
      </Routes>
    </MemoryRouter>,
  );
  return catalog;
};

describe('InfrastructureObjectDetailPage Saved Map membership', () => {
  it('shows authoritative equipment memberships with exact SavedMap links', async () => {
    renderPage(details(), { loadCatalogInventory: vi.fn().mockResolvedValue(inventory([
      { map_ref: { entity_type: 'SavedMap', entity_id: 'map-2' }, name: 'Карта 10' },
      { map_ref: { entity_type: 'SavedMap', entity_id: 'map-1' }, name: 'Карта 2' },
    ])) });

    const first = await screen.findByRole('link', { name: 'Карта 2' });
    expect(first).toHaveAttribute('href', `/map?map=map-1&view=physical&focus=${objectId}`);
    expect(screen.getByRole('link', { name: 'Карта 10' })).toHaveAttribute('href', `/map?map=map-2&view=physical&focus=${objectId}`);
    expect(screen.queryByRole('link', { name: 'Показать на карте' })).not.toBeInTheDocument();
    expect(screen.queryByText(`/map?view=physical&focus=${objectId}`)).not.toBeInTheDocument();
  });

  it('shows authoritative empty equipment memberships without a generic map action', async () => {
    renderPage();

    expect(await screen.findByText('На картах: нет')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Показать на карте' })).not.toBeInTheDocument();
  });

  it('keeps cables outside explicit MapPlacement presentation', async () => {
    renderPage(details('cable'));

    expect(await screen.findByText('Кабель отображается на физических картах через свои подключения и отдельно на карту не размещается.')).toBeInTheDocument();
    expect(screen.queryByText('На картах: нет')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Показать на карте' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Добавить на карту/ })).not.toBeInTheDocument();
  });

  it('keeps Object Detail visible when inventory loading fails and retries only inventory', async () => {
    const catalog = { loadCatalogInventory: vi.fn().mockRejectedValueOnce(new Error('inventory offline')).mockResolvedValueOnce(inventory()) };
    renderPage(details(), catalog);

    expect(await screen.findByRole('heading', { name: 'SW1' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить данные о размещении на картах: inventory offline');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(catalog.loadCatalogInventory).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('На картах: нет')).toBeInTheDocument();
  });
});
