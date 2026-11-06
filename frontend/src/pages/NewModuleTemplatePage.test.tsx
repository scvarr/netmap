import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { NewModuleTemplatePage } from './NewModuleTemplatePage';
import { hardwareModuleDataSource } from '../topology/hardwareModules';

const catalog = [
  { id: 'test-type', name: 'Copper', color: '#336699', is_active: true },
  { id: 'fiber', name: 'Fiber', color: '#FFAA00', is_active: true },
];
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(catalog)));
});
afterEach(() => vi.unstubAllGlobals());

it('creates NIC-2GE with two stable keys and retains input after failure', async () => {
  const createModule = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({});
  render(<I18nProvider><MemoryRouter><NewModuleTemplatePage dataSource={{ ...hardwareModuleDataSource, createModule }} /></MemoryRouter></I18nProvider>);
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'NIC-2GE' } });
  fireEvent.change(screen.getByLabelText('Совместимость'), { target: { value: 'PCIe' } });
  for (const name of ['GE1', 'GE2']) {
    await screen.findAllByRole('option', { name: 'Copper · #336699' });
    fireEvent.change(screen.getAllByRole('combobox', { name: 'Тип порта' })[0], { target: { value: 'test-type' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить конечную точку' }));
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs.at(-1)!, { target: { value: name } });
  }
  const canvas = screen.getByLabelText('Геометрия модуля', { selector: 'svg' });
  expect(within(canvas).getByRole('button', { name: 'GE2' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(screen.getByDisplayValue('NIC-2GE')).toBeInTheDocument();
  const first = createModule.mock.calls[0][0];
  expect(first.endpoints).toHaveLength(2);
  expect(new Set(first.endpoints.map((e: { key: string }) => e.key)).size).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));
  await waitFor(() => expect(createModule).toHaveBeenCalledTimes(2));
  expect(createModule.mock.calls[1][0]).toEqual(first);
});

it('bulk adds and reassigns selected module endpoints with current catalog colors', async () => {
  const createModule = vi.fn().mockResolvedValue({});
  const { container } = render(<I18nProvider><MemoryRouter>
    <NewModuleTemplatePage dataSource={{ ...hardwareModuleDataSource, createModule }} />
  </MemoryRouter></I18nProvider>);
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'NIC-3' } });
  fireEvent.change(screen.getByLabelText('Совместимость'), { target: { value: 'PCIe' } });
  await screen.findByRole('option', { name: 'Copper · #336699' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Тип порта' }), { target: { value: 'test-type' } });
  fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Добавить конечную точку' }));
  const markers = () => [...container.querySelectorAll('[data-endpoint-marker]')];
  expect(markers().map(marker => [marker.tagName, marker.getAttribute('fill')])).toEqual(
    Array.from({ length: 3 }, () => ['rect', '#336699']),
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Назначить тип выбранным' }), { target: { value: 'fiber' } });
  expect(markers().every(marker => marker.getAttribute('fill') === '#FFAA00')).toBe(true);
  expect(screen.getAllByRole('checkbox').every(item => (item as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));
  await waitFor(() => expect(createModule).toHaveBeenCalledOnce());
  expect(createModule.mock.calls[0][0].endpoints).toEqual(['1', '2', '3'].map(display_name => ({
    key: expect.any(String), display_name, kind: 'NETWORK_PORT', port_type_id: 'fiber',
  })));
});
