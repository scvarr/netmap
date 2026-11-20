import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import { PhysicalCatalogPage } from './PhysicalCatalogPage';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('creates a type with palette and HEX input, edits it, archives it, and confirms deletion', async () => {
  const first = { id: 'type-id', name: 'SFP+', description: null, color: '#00AABB', is_active: true, medium: 'COPPER', members: ['1'], connector_type_id: null, cardinality: 1 };
  const edited = { ...first, color: '#123456' };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => [] })
    .mockResolvedValueOnce({ ok: true, json: async () => [] })
    .mockResolvedValueOnce({ ok: true, json: async () => first })
    .mockResolvedValueOnce({ ok: true, json: async () => edited })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...edited, is_active: false }) })
    .mockResolvedValueOnce({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetchMock);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<MemoryRouter><I18nProvider><PhysicalCatalogPage catalog="port-types" /></I18nProvider></MemoryRouter>);
  await screen.findByText('Справочник пуст.');
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'SFP+' } });
  fireEvent.change(screen.getByLabelText(/Обозначения каналов/), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Палитра'), { target: { value: '#00aabb' } });
  expect(screen.getByLabelText('HEX')).toHaveValue('#00AABB');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByText('#00AABB')).toBeVisible();
  const { id, cardinality, ...fields } = first;
  expect(cardinality).toBe(1);
  expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/v1/port-types', expect.objectContaining({
    method: 'POST', body: expect.any(String),
  }));
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual(fields);
  fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
  fireEvent.change(screen.getByLabelText('HEX'), { target: { value: '#123456' } });
  expect(screen.getByLabelText('Палитра')).toHaveValue('#123456');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await screen.findByText('#123456');
  fireEvent.click(screen.getByRole('button', { name: 'Архивировать' }));
  await screen.findByText(/В архиве/);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
  expect(fetchMock).toHaveBeenCalledTimes(5);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
  await waitFor(() => expect(screen.queryByText('SFP+')).not.toBeInTheDocument());
  expect(fetchMock).toHaveBeenLastCalledWith(`/api/v1/port-types/${id}`, { method: 'DELETE' });
});


it.each([
  ['connector-types', 'Типы разъёмов', 'Профиль сопряжения', 'LC', { mating_profile: 'LC', termination: 'SOCKET' }],
  ['cable-types', 'Типы кабелей', 'Конструкция', 'SINGLE_MODE', { medium: 'COPPER', construction: 'SINGLE_MODE' }],
] as const)('sends structural fields for %s', async (catalog, title, field, value, structure) => {
  const payload = { name: 'Custom', color: '#64748B', description: null, is_active: true, ...structure };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => [] })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'test-id', ...payload }) });
  vi.stubGlobal('fetch', fetchMock);

  render(<MemoryRouter><I18nProvider><PhysicalCatalogPage catalog={catalog} /></I18nProvider></MemoryRouter>);
  expect(screen.getByRole('heading', { name: title })).toBeVisible();
  await screen.findByText('Справочник пуст.');
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Custom' } });
  fireEvent.change(screen.getByLabelText(field), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByText('Custom')).toBeVisible();
  expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/' + catalog);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(payload);
});
