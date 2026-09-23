import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, localeStorageKey } from '../i18n';
import type { LocationDataSource } from '../topology/locationTypes';
import type { ObjectBlueprintDataSource } from '../topology/objectBlueprintTypes';
import { NewInfrastructureObjectPage } from './NewInfrastructureObjectPage';

const blueprint = { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp-1' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v-4' }, name: 'Switch 24', version_number: 4, default_physical_object_class: 'switch', body: { kind: 'RECTANGLE' as const, width: 240, height: 40 }, slot_count: 24, internal_link_count: 12, version_count: 4 };
const locations = [
  { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'campus' }, name: 'Campus', type: null, parent_location_ref: null },
  { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'rack' }, name: 'Rack 4', type: 'rack', parent_location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'campus' } },
];
const locationSource = (): LocationDataSource => ({ loadLocations: vi.fn().mockResolvedValue(locations), createLocation: vi.fn(), previewLocationSeries: vi.fn(), createLocationSeries: vi.fn(), updateLocation: vi.fn(), reparentLocation: vi.fn(), deleteLocation: vi.fn(), loadPhysicalObjectLocation: vi.fn(), setPhysicalObjectLocation: vi.fn() });
const source = (instantiateObjectBlueprint = vi.fn()): ObjectBlueprintDataSource => ({ loadObjectBlueprints: vi.fn().mockResolvedValue({ schema_version: '1.0', blueprints: [blueprint] }), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint: vi.fn(), instantiateObjectBlueprint });
const LocationProbe = () => <output data-testid="location">{useLocation().pathname}</output>;
const renderPage = (dataSource = source(), locationDataSource = locationSource(), route = '/infrastructure/objects/new') => render(<I18nProvider><MemoryRouter initialEntries={[route]}><NewInfrastructureObjectPage objectBlueprintDataSource={dataSource} locationDataSource={locationDataSource} /><LocationProbe /></MemoryRouter></I18nProvider>);

describe('NewInfrastructureObjectPage', () => {
  afterEach(() => localStorage.clear());

  it('opens a page create state with the list-document summary instead of the old dialog', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать шаблон' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Создать объект из «Switch 24»' })).toBeInTheDocument();
    expect(screen.getByText('Версия: v4')).toBeInTheDocument();
    expect(screen.getByText('switch')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Вернуться к выбору шаблона' })).toBeInTheDocument();
  });

  it('selects an arbitrary-depth Location through search and creates once with its canonical id', async () => {
    const instantiateObjectBlueprint = vi.fn().mockResolvedValue({ schema_version: '1.0' as const, blueprint_ref: blueprint.blueprint_ref, version_ref: blueprint.version_ref, physical_object_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject' as const, entity_id: 'object-1' }, slots: [] });
    renderPage(source(instantiateObjectBlueprint));
    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать шаблон' }));
    await userEvent.type(screen.getByLabelText('Поиск'), 'campus / rack');
    await userEvent.click(screen.getByRole('radio', { name: /Rack 4/ }));
    expect(screen.getByText('Campus / Rack 4')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Имя экземпляра'), ' SW1 ');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(instantiateObjectBlueprint).toHaveBeenCalledTimes(1);
    expect(instantiateObjectBlueprint).toHaveBeenCalledWith('bp-1', 'v-4', { display_name: 'SW1', location_id: 'rack' });
    expect(await screen.findByTestId('location')).toHaveTextContent('/infrastructure/objects/object-1');
  });

  it('allows a missing Location and sends the unchanged instantiation contract', async () => {
    const instantiateObjectBlueprint = vi.fn().mockResolvedValue({ schema_version: '1.0' as const, blueprint_ref: blueprint.blueprint_ref, version_ref: blueprint.version_ref, physical_object_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject' as const, entity_id: 'object-2' }, slots: [] });
    renderPage(source(instantiateObjectBlueprint));
    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать шаблон' }));
    await userEvent.type(screen.getByLabelText('Имя экземпляра'), ' SW2 ');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(instantiateObjectBlueprint).toHaveBeenCalledWith('bp-1', 'v-4', { display_name: 'SW2' });
  });

  it('keeps the form state after a backend failure without replaying the create operation', async () => {
    const instantiateObjectBlueprint = vi.fn().mockRejectedValue(new Error('backend unavailable'));
    renderPage(source(instantiateObjectBlueprint));
    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать шаблон' }));
    await userEvent.click(screen.getByRole('button', { name: 'Развернуть Campus' }));
    await userEvent.click(screen.getByRole('radio', { name: /Rack 4/ }));
    await userEvent.type(screen.getByLabelText('Имя экземпляра'), 'SW3');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось создать объект.');
    expect(screen.getByLabelText('Имя экземпляра')).toHaveValue('SW3');
    expect(screen.getByRole('radio', { name: /Rack 4/ })).toHaveAttribute('aria-checked', 'true');
    expect(instantiateObjectBlueprint).toHaveBeenCalledTimes(1);
  });

  it('opens the same create state for a blueprint/version deep link', async () => {
    renderPage(source(), locationSource(), '/infrastructure/objects/new?blueprint=bp-1&version=v-4');
    expect(await screen.findByRole('heading', { name: 'Создать объект из «Switch 24»' })).toBeInTheDocument();
  });

  it('uses localized loading errors without exposing datasource diagnostics', async () => {
    localStorage.setItem(localeStorageKey, 'en');
    renderPage({ ...source(), loadObjectBlueprints: vi.fn().mockRejectedValue(new Error('backend unavailable')) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load blueprints.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('backend unavailable');
  });
});
