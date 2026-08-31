import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { PhysicalObjectLocationSection } from './PhysicalObjectLocationSection';

const objectId = 'object-1'; const ref = (id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: id });
const moscow = { location_ref: ref('moscow'), name: 'Москва', type: null, parent_location_ref: null }; const dc = { location_ref: ref('dc'), name: 'ЦОД-1', type: null, parent_location_ref: ref('moscow') }; const rack = { location_ref: ref('rack'), name: 'Стойка 4', type: 'стойка', parent_location_ref: ref('dc') };
const association = (id: string | null) => ({ physical_object_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject' as const, entity_id: objectId }, location_ref: id ? ref(id) : null });
const source = (overrides = {}) => ({ loadLocations: vi.fn().mockResolvedValue([moscow, dc, rack]), loadPhysicalObjectLocation: vi.fn().mockResolvedValue(association('rack')), setPhysicalObjectLocation: vi.fn().mockResolvedValue(association('dc')), createLocation: vi.fn(), updateLocation: vi.fn(), reparentLocation: vi.fn(), deleteLocation: vi.fn(), ...overrides });
const renderSection = (dataSource = source()) => { render(<I18nProvider><PhysicalObjectLocationSection physicalObjectId={objectId} dataSource={dataSource} /></I18nProvider>); return dataSource; };

describe('PhysicalObjectLocationSection', () => {
  it('renders the hierarchy, opens the current path, and keeps ancestor context for a path search', async () => {
    renderSection(); await screen.findByText('Москва / ЦОД-1 / Стойка 4'); await userEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(screen.getByRole('radio', { name: /Стойка 4/ })).toHaveAttribute('aria-checked', 'true'); expect(screen.getByRole('button', { name: 'Свернуть Москва' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Поиск'), 'цод-1 / стойка'); expect(screen.getByRole('radio', { name: 'Москва' })).toBeInTheDocument(); expect(screen.getByRole('radio', { name: /Стойка 4/ })).toBeInTheDocument();
  });

  it('changes association only after explicit save', async () => {
    const dataSource = renderSection(); await screen.findByText('Москва / ЦОД-1 / Стойка 4'); await userEvent.click(screen.getByRole('button', { name: 'Изменить' })); await userEvent.click(screen.getByRole('radio', { name: 'Москва' })); expect(dataSource.setPhysicalObjectLocation).not.toHaveBeenCalled(); await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сохранить' })); expect(dataSource.setPhysicalObjectLocation).toHaveBeenCalledWith(objectId, 'moscow');
  });

  it('creates a direct child, reloads locations, selects it as draft, and waits for save', async () => {
    const child = { location_ref: ref('new-child'), name: 'Новая стойка', type: 'rack', parent_location_ref: ref('dc') }; const dataSource = source({ createLocation: vi.fn().mockResolvedValue(child), loadLocations: vi.fn().mockResolvedValueOnce([moscow, dc, rack]).mockResolvedValueOnce([moscow, dc, rack, child]) }); renderSection(dataSource); await screen.findByText('Москва / ЦОД-1 / Стойка 4'); await userEvent.click(screen.getByRole('button', { name: 'Изменить' })); await userEvent.click(screen.getByRole('button', { name: 'Добавить дочернее: ЦОД-1' })); await userEvent.type(screen.getByLabelText('Название'), 'Новая стойка'); await userEvent.click(screen.getByRole('button', { name: 'Сохранить' })); await waitFor(() => expect(dataSource.createLocation).toHaveBeenCalledWith({ name: 'Новая стойка', type: null, parent_location_id: 'dc' })); expect(dataSource.loadLocations).toHaveBeenCalledTimes(2); expect(screen.getByRole('radio', { name: /Новая стойка/ })).toHaveAttribute('aria-checked', 'true'); expect(dataSource.setPhysicalObjectLocation).not.toHaveBeenCalled();
  });

  it('creates a root with null parent and retries only the authoritative reload after its failure', async () => {
    const root = { location_ref: ref('root-2'), name: 'Санкт-Петербург', type: null, parent_location_ref: null }; const loadLocations = vi.fn().mockResolvedValueOnce([moscow, dc, rack]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([moscow, dc, rack, root]); const createLocation = vi.fn().mockResolvedValue(root); const dataSource = source({ loadLocations, createLocation }); renderSection(dataSource); await screen.findByText('Москва / ЦОД-1 / Стойка 4'); await userEvent.click(screen.getByRole('button', { name: 'Изменить' })); await userEvent.click(screen.getByRole('button', { name: 'Создать местоположение' })); await userEvent.type(screen.getByLabelText('Название'), 'Санкт-Петербург'); await userEvent.click(screen.getByRole('button', { name: 'Сохранить' })); expect(await screen.findByRole('alert')).toHaveTextContent('список местоположений не удалось обновить'); expect(createLocation).toHaveBeenCalledTimes(1); expect(createLocation).toHaveBeenCalledWith({ name: 'Санкт-Петербург', type: null, parent_location_id: null }); await userEvent.click(screen.getByRole('button', { name: 'Повторить обновление' })); await waitFor(() => expect(loadLocations).toHaveBeenCalledTimes(3)); expect(createLocation).toHaveBeenCalledTimes(1); expect(screen.getByRole('radio', { name: 'Санкт-Петербург' })).toHaveAttribute('aria-checked', 'true'); expect(dataSource.setPhysicalObjectLocation).not.toHaveBeenCalled();
  });

  it('does not replay a confirmed assignment after refresh failure and preserves direct clear lifecycle', async () => {
    const loadLocations = vi.fn().mockResolvedValueOnce([moscow, dc, rack]).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([moscow, dc, rack]); const dataSource = source({ loadLocations }); renderSection(dataSource); await screen.findByText('Москва / ЦОД-1 / Стойка 4'); await userEvent.click(screen.getByRole('button', { name: 'Очистить' })); expect(await screen.findByText(/данные не удалось обновить/)).toBeInTheDocument(); expect(dataSource.setPhysicalObjectLocation).toHaveBeenCalledWith(objectId, null); await userEvent.click(screen.getByRole('button', { name: 'Повторить обновление' })); await waitFor(() => expect(loadLocations).toHaveBeenCalledTimes(3)); expect(dataSource.setPhysicalObjectLocation).toHaveBeenCalledTimes(1);
  });

  it('keeps the authoritative path after a failed direct clear without refresh or replay', async () => {
    const loadLocations = vi.fn().mockResolvedValue([moscow, dc, rack]); const loadPhysicalObjectLocation = vi.fn().mockResolvedValue(association('rack')); const setPhysicalObjectLocation = vi.fn().mockRejectedValue(new Error('write rejected')); const dataSource = source({ loadLocations, loadPhysicalObjectLocation, setPhysicalObjectLocation }); renderSection(dataSource); await screen.findByText('Москва / ЦОД-1 / Стойка 4'); await userEvent.click(screen.getByRole('button', { name: 'Очистить' })); expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить местоположение: write rejected'); expect(screen.getByText('Москва / ЦОД-1 / Стойка 4')).toBeInTheDocument(); expect(setPhysicalObjectLocation).toHaveBeenCalledTimes(1); expect(setPhysicalObjectLocation).toHaveBeenCalledWith(objectId, null); expect(loadLocations).toHaveBeenCalledTimes(1); expect(loadPhysicalObjectLocation).toHaveBeenCalledTimes(1);
  });
});
