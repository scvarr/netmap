import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import { WorkspaceDataPage } from './WorkspaceDataPage';

const renderPage = () => render(<MemoryRouter><I18nProvider><WorkspaceDataPage /></I18nProvider></MemoryRouter>);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('requires destructive confirmation and reports reset success', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetchMock);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'Полностью удалить данные' }));
  expect(fetchMock).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Полностью удалить данные' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Все данные удалены.'));
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/workspace/dataset', { method: 'DELETE' });
});

it('uploads the selected file and explains the nonempty dataset error', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409 });
  vi.stubGlobal('fetch', fetchMock);
  renderPage();
  const file = new File(['{}'], 'snapshot.json', { type: 'application/json' });
  fireEvent.change(screen.getByLabelText('Выбрать файл NetMap JSON'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Импорт возможен только после полной очистки данных.'));
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/workspace/package', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: file,
  });
});

it('shows an import validation error from the server', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: 'Unsupported NetMap workspace format_version' }) }));
  renderPage();
  fireEvent.change(screen.getByLabelText('Выбрать файл NetMap JSON'), {
    target: { files: [new File(['{}'], 'bad.json')] },
  });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Файл NetMap повреждён, неполон или имеет неподдерживаемую версию.'));
});

it('downloads the exported package', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), blob: async () => new Blob(['{}']) });
  vi.stubGlobal('fetch', fetchMock);
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:netmap');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'Экспортировать данные' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Файл экспорта подготовлен.'));
  expect(create).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/workspace/package');
  expect(click).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith('blob:netmap');
});

it('does not download an HTML fallback returned with status 200', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'Content-Type': 'text/html' }) }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'Экспортировать данные' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось экспортировать данные.'));
  expect(click).not.toHaveBeenCalled();
});
