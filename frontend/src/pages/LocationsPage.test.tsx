import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { LocationsPage } from './LocationsPage';

const root = { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'moscow' }, name: 'Москва', type: 'город', parent_location_ref: null };
const child = { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'dc' }, name: 'ЦОД-1', type: 'my arbitrary type', parent_location_ref: root.location_ref };
const grandchild = { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'rack' }, name: 'Стойка 01', type: null, parent_location_ref: child.location_ref };
const secondRoot = { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'piter' }, name: 'Санкт-Петербург', type: null, parent_location_ref: null };
const source = (overrides: Record<string, unknown> = {}) => ({ loadLocations: vi.fn().mockResolvedValue([root, child, grandchild, secondRoot]), createLocation: vi.fn().mockResolvedValue(root), updateLocation: vi.fn().mockResolvedValue(root), reparentLocation: vi.fn().mockResolvedValue(root), deleteLocation: vi.fn().mockResolvedValue(undefined), loadPhysicalObjectLocation: vi.fn(), setPhysicalObjectLocation: vi.fn(), ...overrides });
const renderPage = (dataSource: any) => render(<MemoryRouter><I18nProvider><LocationsPage dataSource={dataSource} /></I18nProvider></MemoryRouter>);

describe('LocationsPage', () => {
  it('renders an arbitrary-depth tree and preserves arbitrary user type through root and child creation', async () => {
    const dataSource = source(); renderPage(dataSource);
    expect(await screen.findByText('Стойка 01')).toBeInTheDocument();
    expect(screen.getByText('my arbitrary type')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Создать местоположение' }));
    await userEvent.type(screen.getByLabelText('Название'), '  Независимое  ');
    await userEvent.type(screen.getByLabelText('Тип'), 'своя категория');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(dataSource.createLocation).toHaveBeenCalledWith({ name: 'Независимое', type: 'своя категория', parent_location_id: null }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Добавить дочернее' })[0]);
    await userEvent.type(screen.getByLabelText('Название'), 'Этаж 1');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(dataSource.createLocation).toHaveBeenLastCalledWith({ name: 'Этаж 1', type: null, parent_location_id: 'moscow' }));
  });

  it('edits and clears type, reparents and detaches only through explicit calls', async () => {
    const dataSource = source(); renderPage(dataSource); await screen.findByText('ЦОД-1');
    await userEvent.click(screen.getAllByRole('button', { name: 'Изменить' })[1]);
    await userEvent.clear(screen.getByLabelText('Тип')); await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(dataSource.updateLocation).toHaveBeenCalledWith('dc', { name: 'ЦОД-1', type: null }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Изменить родителя' })[1]);
    await userEvent.selectOptions(screen.getByLabelText('Родительское местоположение'), 'piter'); await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(dataSource.reparentLocation).toHaveBeenCalledWith('dc', 'piter'));
    await userEvent.click(screen.getAllByRole('button', { name: 'Изменить родителя' })[1]);
    await userEvent.selectOptions(screen.getByLabelText('Родительское местоположение'), ''); await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(dataSource.reparentLocation).toHaveBeenLastCalledWith('dc', null));
  });

  it('keeps a write acknowledgement separate from refresh retry and surfaces deletion validation', async () => {
    const reload = vi.fn().mockResolvedValueOnce([root]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([root]);
    const dataSource = source({ loadLocations: reload, deleteLocation: vi.fn().mockRejectedValue(new Error('Location has child Locations')) }); renderPage(dataSource); await screen.findByText('Москва');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить дочернее' })); await userEvent.type(screen.getByLabelText('Название'), 'Этаж'); await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText(/список местоположений не удалось обновить/); expect(dataSource.createLocation).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Повторить обновление' })); await waitFor(() => expect(reload).toHaveBeenCalledTimes(3)); expect(dataSource.createLocation).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' })); await userEvent.click(screen.getByRole('dialog').querySelector('button:last-child')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Location has child Locations');
  });
});
