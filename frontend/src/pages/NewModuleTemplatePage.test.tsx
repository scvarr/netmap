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
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).endsWith('/module-bay-types') ? ['Parent A', 'Parent', 'PCIe'].map(name => ({ id: name, name, is_active: true })) : String(url).endsWith('/module-port-types') ? ['PCIe', 'Parent A', 'Parent', 'Lab / original', 'Lab / custom', 'Custom / 42'].map(name => ({ id: name, name, is_active: true })) : catalog)));
});
afterEach(() => vi.unstubAllGlobals());

it('creates NIC-2GE with two stable keys and retains input after failure', async () => {
  const createModule = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({});
  render(<I18nProvider><MemoryRouter><NewModuleTemplatePage dataSource={{ ...hardwareModuleDataSource, createModule }} /></MemoryRouter></I18nProvider>);
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'NIC-2GE' } });
  await screen.findByRole('option', { name: 'PCIe' });
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
  await screen.findByRole('option', { name: 'PCIe' });
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
  await screen.findByRole('option', { name: 'Parent A' });
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
  fireEvent.click(group.getByRole('checkbox', { name: 'Назначить аппаратный интерфейс' }));
  fireEvent.change(group.getByLabelText('Название'), { target: { value: 'Child bay' } });
  fireEvent.change(group.getByLabelText('Совместимость'), { target: { value: 'Lab / custom' } });
  const input = group.getByLabelText('X (0–1)');
  fireEvent.change(input, { target: { value: '0.2' } });
  fireEvent.blur(input);
  expect(Number(diamond.getAttribute('points')!.split(',')[0])).toBeCloseTo(48);
  fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));
  await waitFor(() => expect(createModule).toHaveBeenCalledWith(expect.objectContaining({
    endpoints: [],
    module_places: [{ key: expect.any(String), hardware_interface_key: expect.stringMatching(/^[0-9a-f-]{36}$/), display_name: 'Child bay', mount_kind: 'MODULE_PORT' as const, module_port_type_id: 'Lab / custom', module_bay_type_id: null, x: .2, y: .5 }],
  })));
});

it.each([2, 48, 256])('creates and reopens %i separate module ports', async count => {
  const createModule = vi.fn().mockResolvedValue({});
  const { container, unmount } = render(<I18nProvider><MemoryRouter>
    <NewModuleTemplatePage dataSource={{ ...hardwareModuleDataSource, createModule }} />
  </MemoryRouter></I18nProvider>);
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Carrier' } });
  await screen.findByRole('option', { name: 'Parent' });
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
  const ports = saved.module_places!;
  expect(saved.endpoints).toEqual([]);
  expect(ports).toHaveLength(count);
  expect(new Set(ports.map(port => port.key)).size).toBe(count);
  expect(ports.map(port => port.display_name)).toEqual(Array.from({ length: count }, (_, i) => `Модульный порт ${i + 1}`));
  expect(ports.every(port => port.module_port_type_id === 'Custom / 42')).toBe(true);
  expect(new Set(ports.map(port => `${port.x}:${port.y}`)).size).toBe(count);
  expect(ports.every(port => !('width' in port) && !('height' in port))).toBe(true);
  const positions = () => Array.from(document.querySelectorAll('[data-module-port-marker]'), marker => marker.getAttribute('points'));
  const before = positions();
  unmount();
  render(<I18nProvider><MemoryRouter><ModuleTemplateEditor value={saved} onChange={vi.fn()} /></MemoryRouter></I18nProvider>);
  expect(positions()).toEqual(before);
});


it('creates a board with two SFP+ sockets and exposes no bay authoring', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(
    String(url).endsWith('/module-bay-types') ? [{ id: 'pcie', name: 'PCIe x16', is_active: true }]
      : String(url).endsWith('/module-port-types') ? [{ id: 'sfpplus', name: 'SFP+', is_active: true }] : catalog,
  )));
  const createModule = vi.fn().mockResolvedValue({});
  const { container } = render(<I18nProvider><MemoryRouter>
    <NewModuleTemplatePage dataSource={{ ...hardwareModuleDataSource, createModule }} />
  </MemoryRouter></I18nProvider>);
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'PCIe card' } });
  expect(screen.queryByLabelText('Вид посадочного места')).not.toBeInTheDocument();
  const compatibility = screen.getByRole('combobox', { name: 'Совместимость' });
  await within(compatibility).findByRole('option', { name: 'PCIe x16' });
  expect(within(compatibility).queryByRole('option', { name: 'SFP+' })).toBeNull();
  fireEvent.change(compatibility, { target: { value: 'pcie' } });
  const chooser = within(container.querySelector<HTMLElement>('.template-element-creator')!);
  expect(within(chooser.getByRole('combobox', { name: 'Вид точки' })).getAllByRole('option').map(option => option.getAttribute('value')))
    .toEqual(['NETWORK_PORT', 'CONNECTION_POINT', 'MODULE_PORT']);
  fireEvent.change(chooser.getByLabelText('Вид точки'), { target: { value: 'MODULE_PORT' } });
  await chooser.findByRole('option', { name: 'SFP+' });
  expect(chooser.queryByRole('option', { name: 'PCIe x16' })).toBeNull();
  fireEvent.change(chooser.getByLabelText('Совместимость модульного порта'), { target: { value: 'sfpplus' } });
  fireEvent.change(chooser.getByLabelText('Количество'), { target: { value: 2 } });
  fireEvent.click(chooser.getByRole('button', { name: /^Добавить$/ }));
  expect(container.querySelector('[data-module-bay-marker]')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Добавить на панель' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));
  await waitFor(() => expect(createModule).toHaveBeenCalledWith(expect.objectContaining({
    mount_kind: 'MODULE_BAY', module_bay_type_id: 'pcie',
    module_places: [
      expect.objectContaining({ mount_kind: 'MODULE_PORT', module_port_type_id: 'sfpplus' }),
      expect.objectContaining({ mount_kind: 'MODULE_PORT', module_port_type_id: 'sfpplus' }),
    ],
  })));
});
