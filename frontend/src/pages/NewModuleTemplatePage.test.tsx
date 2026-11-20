import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { NewModuleTemplatePage } from './NewModuleTemplatePage';
import { hardwareModuleDataSource } from '../topology/hardwareModules';
import { ModuleTemplateEditor } from '../components/ModuleTemplateEditor';

const catalog = [
  { id: 'test-type', name: 'Copper', color: '#336699', is_active: true, medium: 'COPPER', members: ['1'], cardinality: 1, connector_type_id: null },
  { id: 'fiber', name: 'Fiber', color: '#FFAA00', is_active: true, medium: 'COPPER', members: ['1'], cardinality: 1, connector_type_id: null },
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
    fireEvent.click(screen.getByRole('button', { name: /^Добавить$/ }));
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
  fireEvent.click(screen.getByRole('button', { name: /^Добавить$/ }));
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

it('authors a diamond-shaped module port without assigning a PortType', async () => {
  const createModule = vi.fn().mockResolvedValue({});
  const { container } = render(<I18nProvider><MemoryRouter>
    <NewModuleTemplatePage dataSource={{ ...hardwareModuleDataSource, createModule }} />
  </MemoryRouter></I18nProvider>);
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Carrier' } });
  fireEvent.change(screen.getByLabelText('Совместимость'), { target: { value: 'Parent A' } });
  fireEvent.change(screen.getByLabelText('Вид точки'), { target: { value: 'MODULE_PORT' } });
  fireEvent.change(screen.getByLabelText('Совместимость модульного порта'), { target: { value: 'Lab / original' } });
  fireEvent.click(screen.getByRole('button', { name: /^Добавить$/ }));
  expect(screen.queryByLabelText('Тип порта')).toBeNull();
  const group = within(screen.getByRole('group', { name: 'Модульный порт' }));
  const diamond = container.querySelector('[data-module-port-marker]')!;
  expect(diamond.tagName).toBe('polygon');
  expect(group.queryByLabelText('Ширина')).toBeNull();
  expect(group.queryByLabelText('Высота')).toBeNull();
  fireEvent.change(group.getByLabelText('Название'), { target: { value: 'Child bay' } });
  fireEvent.change(group.getByLabelText('Совместимость'), { target: { value: 'Lab / custom' } });
  const input = group.getByLabelText('X (0–1)');
  fireEvent.change(input, { target: { value: '0.2' } });
  fireEvent.blur(input);
  expect(Number(diamond.getAttribute('points')!.split(',')[0])).toBeCloseTo(48);
  fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));
  await waitFor(() => expect(createModule).toHaveBeenCalledWith(expect.objectContaining({
    endpoints: [],
    module_ports: [{ key: expect.any(String), display_name: 'Child bay', compatibility: 'Lab / custom', x: .2, y: .5 }],
  })));
});

it.each([2, 48, 256])('creates and reopens %i separate module ports', async count => {
  const createModule = vi.fn().mockResolvedValue({});
  const { container, unmount } = render(<I18nProvider><MemoryRouter>
    <NewModuleTemplatePage dataSource={{ ...hardwareModuleDataSource, createModule }} />
  </MemoryRouter></I18nProvider>);
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Carrier' } });
  fireEvent.change(screen.getByLabelText('Совместимость'), { target: { value: 'Parent' } });
  const chooser = within(container.querySelector('.template-element-creator')! as HTMLElement);
  const quantity = chooser.getByLabelText('Количество');
  const add = chooser.getByRole('button', { name: /^Добавить$/ });
  for (const kind of ['CONNECTION_POINT', 'NETWORK_PORT', 'MODULE_PORT']) {
    fireEvent.change(chooser.getByLabelText('Вид точки'), { target: { value: kind } });
    expect(chooser.getByLabelText('Количество')).toBe(quantity);
    expect(chooser.getByRole('button', { name: /^Добавить$/ })).toBe(add);
    expect(chooser.queryByLabelText('Тип порта') !== null).toBe(kind !== 'MODULE_PORT');
  }
  fireEvent.change(quantity, { target: { value: 257 } });
  fireEvent.change(chooser.getByLabelText('Совместимость модульного порта'), { target: { value: 'Custom / 42' } });
  expect(add).toBeDisabled();
  fireEvent.change(quantity, { target: { value: count } });
  fireEvent.click(add);
  fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));
  await waitFor(() => expect(createModule).toHaveBeenCalledOnce());
  const saved = createModule.mock.calls[0][0] as import('../topology/hardwareModules').ModuleTemplateInput;
  const ports = saved.module_ports!;
  expect(saved.endpoints).toEqual([]);
  expect(ports).toHaveLength(count);
  expect(new Set(ports.map(port => port.key)).size).toBe(count);
  expect(ports.map(port => port.display_name)).toEqual(Array.from({ length: count }, (_, i) => `Модульный порт ${i + 1}`));
  expect(ports.every(port => port.compatibility === 'Custom / 42')).toBe(true);
  expect(new Set(ports.map(port => `${port.x}:${port.y}`)).size).toBe(count);
  expect(ports.every(port => !('width' in port) && !('height' in port))).toBe(true);
  const positions = () => Array.from(document.querySelectorAll('[data-module-port-marker]'), marker => marker.getAttribute('points'));
  const before = positions();
  unmount();
  render(<I18nProvider><MemoryRouter><ModuleTemplateEditor value={saved} onChange={vi.fn()} /></MemoryRouter></I18nProvider>);
  expect(positions()).toEqual(before);
});
