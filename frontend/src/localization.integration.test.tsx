import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider, useI18n } from './i18n';
import { MapPage } from './pages/MapPage';
import { InfrastructureObjectsPage } from './pages/InfrastructureObjectsPage';
import { NewObjectBlueprintPage } from './pages/NewObjectBlueprintPage';

function LocaleControls() {
  const { setLocale } = useI18n();
  return <><button onClick={() => setLocale('en')}>English</button><button onClick={() => setLocale('ru')}>Русский</button></>;
}

const renderLocalized = (ui: React.ReactNode) => render(<I18nProvider><LocaleControls />{ui}</I18nProvider>);
const canonicalRef = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('RU/EN localization integration', () => {
  it('switches the Map surface to English and restores Russian without translating a map name', async () => {
    const map = { map_ref: { entity_type: 'SavedMap' as const, entity_id: 'map-1' }, name: 'Карта', created_at: 'now', updated_at: 'now', placements: [] };
    renderLocalized(<MemoryRouter initialEntries={['/map?map=map-1&view=physical']}><MapPage dataSource={{ loadProjection: vi.fn() }} savedMapDataSource={{ listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), createMap: vi.fn(), deleteMap: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), setPositionLock: vi.fn(), setCableRoute: vi.fn(), deleteCableRoute: vi.fn(), removePlacement: vi.fn() }} /></MemoryRouter>);

    await screen.findByLabelText('Карты');
    expect(screen.getByRole('option', { name: 'Карта' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByLabelText('Maps')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trace' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Карта' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Русский' }));
    expect(screen.getByLabelText('Карты')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Трассировка' })).toBeInTheDocument();
  });

  it('switches the Catalog/Object surface to English without translating backend names', async () => {
    const inventory = { schema_version: '1.0' as const, equipment: [{ physical_object_ref: canonicalRef('PhysicalObject', 'object-1'), label: 'Карта', map_memberships: [{ map_ref: { entity_type: 'SavedMap', entity_id: 'map-1' }, name: 'Карта' }] }], cables: [], gaps: [], warnings: [] };
    renderLocalized(<MemoryRouter><InfrastructureObjectsPage catalogInventoryDataSource={{ loadCatalogInventory: vi.fn().mockResolvedValue(inventory) }} /></MemoryRouter>);

    await screen.findByText('Карта');
    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { name: 'Catalog' })).toBeInTheDocument();
    expect(screen.getByLabelText('Map')).toBeInTheDocument();
    expect(screen.getAllByText('Карта').length).toBeGreaterThanOrEqual(2);
  });

  it('localizes the composition editor while submitting canonical Blueprint values', async () => {
    const createObjectBlueprint = vi.fn().mockResolvedValue({});
    const portBlockDataSource = { loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, port_blocks: [{ port_block_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'PortBlock' as const, entity_id: 'pb-1' }, name: 'Patch', version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'PortBlockVersion' as const, entity_id: 'v-1' }, version_number: 1, port_count: 1, version_count: 1 }] }), loadPortBlockVersions: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, versions: [{ port_block_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'PortBlock' as const, entity_id: 'pb-1' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'PortBlockVersion' as const, entity_id: 'v-1' }, version_number: 1, port_count: 1 }] }), loadPortBlockVersion: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, port_block_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'PortBlock' as const, entity_id: 'pb-1' }, name: 'Patch', version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'PortBlockVersion' as const, entity_id: 'v-1' }, version_number: 1, ports: [{ local_id: 'p1', display_label: 'P1', kind: 'NETWORK_PORT' as const, row: 1 as const, column: 1, layout_order: 1 }] }), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() };
    renderLocalized(<MemoryRouter><NewObjectBlueprintPage dataSource={{ loadObjectBlueprints: vi.fn(), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint }} portBlockDataSource={portBlockDataSource} /></MemoryRouter>);

    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { name: 'Create object blueprint' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Blueprint name'), 'Карта');
    expect(screen.getByLabelText('Logical Port Block')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Logical Port Block'), 'pb-1');
    expect(screen.queryByLabelText('Exact version')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add Port Block' }));
    await waitFor(() => expect(document.querySelectorAll('.blueprint-composition-canvas__block')).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Save blueprint' }));

    expect(createObjectBlueprint).toHaveBeenCalledWith(expect.objectContaining({ name: 'Карта', composition: { instances: [expect.objectContaining({ port_block_version_ref: expect.objectContaining({ entity_type: 'PortBlockVersion', entity_id: 'v-1' }) })] } }));
  });
});
