import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import { PortTypesPage } from './PortTypesPage';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('creates a type with palette and HEX input, edits it, archives it, and confirms deletion', async () => {
  const first = { id: 'type-id', name: 'SFP+', description: null, color: '#00AABB', is_active: true };
  const edited = { ...first, color: '#123456' };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => [] })
    .mockResolvedValueOnce({ ok: true, json: async () => first })
    .mockResolvedValueOnce({ ok: true, json: async () => edited })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...edited, is_active: false }) })
    .mockResolvedValueOnce({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetchMock);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<MemoryRouter><I18nProvider><PortTypesPage /></I18nProvider></MemoryRouter>);
  await screen.findByText('Типы портов ещё не созданы.');
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'SFP+' } });
  fireEvent.change(screen.getByLabelText('Палитра'), { target: { value: '#00aabb' } });
  expect(screen.getByLabelText('HEX')).toHaveValue('#00AABB');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByText('#00AABB')).toBeVisible();
  const { id, ...fields } = first;
  expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/port-types', expect.objectContaining({
    method: 'POST', body: JSON.stringify(fields),
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
  fireEvent.change(screen.getByLabelText('HEX'), { target: { value: '#123456' } });
  expect(screen.getByLabelText('Палитра')).toHaveValue('#123456');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await screen.findByText('#123456');
  fireEvent.click(screen.getByRole('button', { name: 'Архивировать' }));
  await screen.findByText(/В архиве/);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
  expect(fetchMock).toHaveBeenCalledTimes(4);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
  await waitFor(() => expect(screen.queryByText('SFP+')).not.toBeInTheDocument());
  expect(fetchMock).toHaveBeenLastCalledWith(`/api/v1/port-types/${id}`, { method: 'DELETE' });
});
