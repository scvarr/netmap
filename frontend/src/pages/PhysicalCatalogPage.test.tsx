import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import { PhysicalCatalogPage } from './PhysicalCatalogPage';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('creates a type with palette and HEX input, edits it, archives it, and confirms deletion', async () => {
  const first = { id: 'type-id', name: 'SFP+', description: null, color: '#00AABB', is_active: true, medium: 'COPPER', members: ['1'], compatibility_mode: 'SAME_TYPE', cardinality: 1 };
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
  fireEvent.change(screen.getByLabelText('Режим совместимости'), { target: { value: 'SAME_TYPE' } });
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


it('edits one matrix cell and shows the same decision from either port type', async () => {
  const types = ['A', 'B'].map(name => ({
    id: name.toLowerCase(), name, color: '#64748B', description: null, is_active: true,
    medium: 'COPPER', members: ['1'], cardinality: 1, compatibility_mode: 'MATRIX',
  }));
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => types })
    .mockResolvedValueOnce({ ok: true, json: async () => [] })
    .mockResolvedValueOnce({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><I18nProvider><PhysicalCatalogPage catalog="port-types" /></I18nProvider></MemoryRouter>);
  const edit = await screen.findAllByRole('button', { name: 'Редактировать' });
  fireEvent.click(edit[0]);
  const matrix = screen.getByRole('region', { name: 'Матрица совместимости' });
  const row = (name: string) => within(matrix).getByRole('row', { name: new RegExp(`^${name} `) });
  expect(row('B')).toHaveTextContent('DENY');
  fireEvent.click(within(matrix).getByRole('checkbox', { name: 'Разрешить пару с B' }));
  await waitFor(() => expect(row('B')).toHaveTextContent('ALLOW'));
  expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/port-type-compatibilities/a/b', expect.objectContaining({
    method: 'PUT', body: JSON.stringify({ allowed: true }),
  }));
  fireEvent.click(edit[1]);
  expect(row('A')).toHaveTextContent('ALLOW');
});
