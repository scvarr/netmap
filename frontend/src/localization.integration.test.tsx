import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider, useI18n } from './i18n';
import { MapPage } from './pages/MapPage';
import { InfrastructureObjectsPage } from './pages/InfrastructureObjectsPage';
import { NewBaseTemplatePage } from './pages/NewBaseTemplatePage';

function LocaleControls() {
  const { setLocale } = useI18n();
  return <><button onClick={() => setLocale('en')}>English</button><button onClick={() => setLocale('ru')}>Русский</button></>;
}

const renderLocalized = (ui: React.ReactNode) => render(<I18nProvider><LocaleControls />{ui}</I18nProvider>);
const canonicalRef = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });

beforeEach(() => window.localStorage.clear());
afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals(); });

describe('RU/EN localization integration', () => {
  it('switches the Map surface to English and restores Russian without translating a map name', async () => {
    const map = { map_ref: { entity_type: 'SavedMap' as const, entity_id: 'map-1' }, name: 'Карта', created_at: 'now', updated_at: 'now', placements: [] };
    renderLocalized(<MemoryRouter initialEntries={['/map?map=map-1&view=physical']}><MapPage dataSource={{ loadProjection: vi.fn() }} savedMapDataSource={{ listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), createMap: vi.fn(), deleteMap: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), setPositionLock: vi.fn(), createTextAnnotation: vi.fn(), replaceTextAnnotation: vi.fn(), deleteTextAnnotation: vi.fn(), removePlacement: vi.fn() }} /></MemoryRouter>);

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
    vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).endsWith('/module-port-types') ? ['Custom / 42'].map(name => ({ id: name, name, is_active: true })) : [
      { id: 'copper', name: 'Copper', color: '#336699', is_active: true, cardinality: 1 },
    ])));
    const createBaseTemplate = vi.fn().mockResolvedValue({});
    renderLocalized(<MemoryRouter><NewBaseTemplatePage dataSource={{ loadBaseTemplates: vi.fn(), loadBaseTemplateRevision: vi.fn(), createBaseTemplate }} /></MemoryRouter>);

    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { name: 'Create base template' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Blueprint name'), 'Карта');
    await userEvent.selectOptions(await screen.findByLabelText('Port type'), 'copper');
    await userEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await userEvent.selectOptions(screen.getAllByLabelText('Endpoint kind')[0], 'MODULE_PORT');
    await userEvent.selectOptions(screen.getByLabelText('Module port compatibility'), 'Custom / 42');
    await userEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save blueprint' }));

    await waitFor(() => expect(createBaseTemplate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Карта',
      panels: [expect.objectContaining({ panel_number: 1, display_name: 'Панель 1' })],
      slots: [expect.objectContaining({ kind: 'NETWORK_PORT', display_name: '1-1', port_type_id: 'copper' })],
      bays: [expect.objectContaining({ kind: 'PLACED', display_name: '1-2', mount_kind: 'MODULE_PORT' as const, module_port_type_id: 'Custom / 42' })],
    })));
  });
});
