import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { LocationsPage } from './LocationsPage';

const root = { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'moscow' }, name: 'Москва', type: 'город', parent_location_ref: null };
const child = { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'dc' }, name: 'ЦОД-1', type: 'my arbitrary type', parent_location_ref: root.location_ref };
const grandchild = { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'rack' }, name: 'Стойка 01', type: null, parent_location_ref: child.location_ref };
const secondRoot = { location_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: 'piter' }, name: 'Санкт-Петербург', type: null, parent_location_ref: null };
const source = (overrides: Record<string, unknown> = {}) => ({ loadLocations: vi.fn().mockResolvedValue([root, child, grandchild, secondRoot]), createLocation: vi.fn().mockResolvedValue(root), previewLocationSeries: vi.fn().mockResolvedValue({ names: ['U01', 'U02'], conflicts: [] }), createLocationSeries: vi.fn().mockResolvedValue([]), updateLocation: vi.fn().mockResolvedValue(root), reparentLocation: vi.fn().mockResolvedValue(root), deleteLocation: vi.fn().mockResolvedValue(undefined), loadPhysicalObjectLocation: vi.fn(), setPhysicalObjectLocation: vi.fn(), ...overrides });
const renderPage = (dataSource: any) => render(<MemoryRouter><I18nProvider><LocationsPage dataSource={dataSource} /></I18nProvider></MemoryRouter>);

describe('LocationsPage', () => {
  it('previews a child series, blocks conflicts, and refreshes after one atomic write', async () => {
    const newChild = { location_ref: { ...root.location_ref, entity_id: 'u01' }, name: 'U01', type: null, parent_location_ref: grandchild.location_ref };
    const dataSource = source({ loadLocations: vi.fn().mockResolvedValueOnce([root, child, grandchild, secondRoot]).mockResolvedValueOnce([root, child, grandchild, secondRoot, newChild]), previewLocationSeries: vi.fn().mockResolvedValueOnce({ names: ['U01', 'U02'], conflicts: ['U02'] }).mockResolvedValueOnce({ names: ['U01', 'U02'], conflicts: [] }) });
    renderPage(dataSource); await screen.findByText('Стойка 01');
    await userEvent.click(screen.getAllByRole('button', { name: 'Создать серию дочерних' })[2]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Стойка 01' })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).queryByRole('radio', { name: 'Корневое местоположение' })).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Шаблон'), 'U##');
    await userEvent.type(within(dialog).getByLabelText('До'), '2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Показать предварительный просмотр' }));
    await waitFor(() => expect(dataSource.previewLocationSeries).toHaveBeenCalledWith({ parent_location_id: 'rack', pattern: 'U##', from: 1, to: 2, step: 1, type: null }));
    expect(within(dialog).getByRole('list', { name: 'Имена серии' })).toHaveTextContent('U01');
    expect(within(dialog).getByRole('list', { name: 'Имена серии' })).toHaveTextContent('U02');
    expect(within(dialog).getByRole('button', { name: 'Создать серию' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Показать предварительный просмотр' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Создать серию' })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать серию' }));
    await waitFor(() => expect(dataSource.createLocationSeries).toHaveBeenCalledTimes(1));
    expect(dataSource.createLocation).not.toHaveBeenCalled();
    await waitFor(() => expect(dataSource.loadLocations).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('U01')).toBeInTheDocument();
  });

  it('keeps create disabled after a rejected pattern preview', async () => {
    const dataSource = source({ previewLocationSeries: vi.fn().mockRejectedValue(new Error('Pattern must contain exactly one continuous # group')) });
    renderPage(dataSource); await screen.findByText('Стойка 01');
    await userEvent.click(screen.getAllByRole('button', { name: 'Создать серию дочерних' })[2]);
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Шаблон'), '#-#');
    await userEvent.type(within(dialog).getByLabelText('До'), '2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Показать предварительный просмотр' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Pattern must contain exactly one continuous # group');
    expect(within(dialog).getByRole('button', { name: 'Создать серию' })).toBeDisabled();
    expect(dataSource.createLocationSeries).not.toHaveBeenCalled();
  });
  it('renders an arbitrary-depth tree, collapses branches, and preserves arbitrary user type through root creation', async () => {
    const dataSource = source(); renderPage(dataSource);
    expect(await screen.findByText('Стойка 01')).toBeInTheDocument();
    expect(screen.getByText('my arbitrary type')).toBeInTheDocument();
    expect(document.querySelectorAll('.location-tree--root')).toHaveLength(1);
    expect(document.querySelectorAll('.location-tree:not(.location-tree--root)')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Свернуть Москва' }));
    expect(screen.queryByText('ЦОД-1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Развернуть Москва' }));
    expect(await screen.findByText('Стойка 01')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Создать местоположение' }));
    await userEvent.type(screen.getByLabelText('Название'), '  Независимое  ');
    await userEvent.type(screen.getByLabelText('Тип'), 'своя категория');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(dataSource.createLocation).toHaveBeenCalledWith({ name: 'Независимое', type: 'своя категория', parent_location_id: null }));
  });

  it('creates a child through the hierarchy picker, preselects its parent, and allows changing it before save', async () => {
    const dataSource = source(); renderPage(dataSource); await screen.findByText('Москва');
    await userEvent.click(screen.getAllByRole('button', { name: 'Добавить дочернее' })[0]);
    expect(screen.getByRole('radio', { name: /Москва/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Корневое местоположение' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('my arbitrary type')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Свернуть Москва' }));
    expect(screen.queryByRole('radio', { name: /ЦОД-1/ })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Развернуть Москва' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Санкт-Петербург' }));
    await userEvent.type(screen.getByLabelText('Название'), 'Этаж 1');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(dataSource.createLocation).toHaveBeenCalledWith({ name: 'Этаж 1', type: null, parent_location_id: 'piter' }));
  });

  it('edits and clears type, reparents and detaches only through explicit calls', async () => {
    const dataSource = source(); renderPage(dataSource); await screen.findByText('ЦОД-1');
    await userEvent.click(screen.getAllByRole('button', { name: 'Изменить' })[1]);
    await userEvent.clear(screen.getByLabelText('Тип')); await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(dataSource.updateLocation).toHaveBeenCalledWith('dc', { name: 'ЦОД-1', type: null }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Изменить родителя' })[1]);
    expect(screen.getByRole('radio', { name: 'Санкт-Петербург' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /ЦОД-1/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Стойка 01' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Санкт-Петербург' })); await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(dataSource.reparentLocation).toHaveBeenCalledWith('dc', 'piter'));
    await userEvent.click(screen.getAllByRole('button', { name: 'Изменить родителя' })[1]);
    await userEvent.click(screen.getByRole('radio', { name: 'Корневое местоположение' })); await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
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
