import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { PhysicalObjectLocationSection } from './PhysicalObjectLocationSection';

const objectId = 'object-1'; const moscow = { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'moscow' }, name: 'Москва', type: null, parent_location_ref: null }; const dc = { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'dc' }, name: 'ЦОД-1', type: null, parent_location_ref: moscow.location_ref };
const association = (locationId: string | null) => ({ physical_object_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject' as const, entity_id: objectId }, location_ref: locationId ? (locationId === 'dc' ? dc.location_ref : moscow.location_ref) : null });

describe('PhysicalObjectLocationSection', () => {
  it('keeps the authoritative path visible and reports a failed direct clear without refresh or replay', async () => {
    const loadLocations = vi.fn().mockResolvedValue([moscow, dc]); const loadPhysicalObjectLocation = vi.fn().mockResolvedValue(association('dc')); const setPhysicalObjectLocation = vi.fn().mockRejectedValue(new Error('canonical write rejected'));
    render(<I18nProvider><PhysicalObjectLocationSection physicalObjectId={objectId} dataSource={{ loadLocations, loadPhysicalObjectLocation, setPhysicalObjectLocation, createLocation: vi.fn(), updateLocation: vi.fn(), reparentLocation: vi.fn(), deleteLocation: vi.fn() }} /></I18nProvider>);
    expect(await screen.findByText('Москва / ЦОД-1')).toBeInTheDocument();
    expect(loadLocations).toHaveBeenCalledTimes(1); expect(loadPhysicalObjectLocation).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Очистить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить местоположение: canonical write rejected');
    expect(screen.getByText('Москва / ЦОД-1')).toBeInTheDocument();
    expect(setPhysicalObjectLocation).toHaveBeenCalledTimes(1); expect(setPhysicalObjectLocation).toHaveBeenCalledWith(objectId, null);
    expect(loadLocations).toHaveBeenCalledTimes(1); expect(loadPhysicalObjectLocation).toHaveBeenCalledTimes(1);
  });

  it('shows canonical hierarchy and assigns then clears Location without replaying a write after refresh failure', async () => {
    const loadLocations = vi.fn().mockResolvedValueOnce([moscow, dc]).mockRejectedValueOnce(new Error('catalog offline')).mockResolvedValue([moscow, dc]);
    const loadPhysicalObjectLocation = vi.fn().mockResolvedValue(association('dc')); const setPhysicalObjectLocation = vi.fn().mockResolvedValue(association('moscow'));
    render(<I18nProvider><PhysicalObjectLocationSection physicalObjectId={objectId} dataSource={{ loadLocations, loadPhysicalObjectLocation, setPhysicalObjectLocation, createLocation: vi.fn(), updateLocation: vi.fn(), reparentLocation: vi.fn(), deleteLocation: vi.fn() }} /></I18nProvider>);
    expect(await screen.findByText('Москва / ЦОД-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Изменить' })); const dialog = screen.getByRole('dialog'); await userEvent.selectOptions(within(dialog).getByLabelText('Местоположение'), 'moscow'); await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText(/данные не удалось обновить/)).toBeInTheDocument(); expect(setPhysicalObjectLocation).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Повторить обновление' })); await waitFor(() => expect(loadLocations).toHaveBeenCalledTimes(3)); expect(setPhysicalObjectLocation).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Очистить' })); await waitFor(() => expect(setPhysicalObjectLocation).toHaveBeenLastCalledWith(objectId, null));
  });
});
