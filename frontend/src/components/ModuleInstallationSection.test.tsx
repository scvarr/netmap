import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import type { HardwareConfiguration, HardwareModuleDataSource } from '../topology/hardwareModules';
import { ModuleInstallationSection } from './ModuleInstallationSection';

const module = { template_id: 'template', revision_id: 'revision', name: 'FC25Gb-2', compatibility: 'OCP3', endpoints: [] };
const free: HardwareConfiguration = { configuration_id: 'config', bays: [{ bay_key: 'bay-key', display_name: 'PCIe1', compatibility: 'OCP3', panel_key: 'back', x: .1, y: .1, width: .3, height: .3, installation: null }] };
const occupied: HardwareConfiguration = { ...free, panels: [{ panel_key: 'back', display_name: 'Back', width: 600, height: 200 }], bays: [{ ...free.bays[0], installation: {
  layout: { panel_key: 'back', x: .1, y: .1, width: .3, height: .2 }, fill_color: '#123456', id: 'stable-installation-id', name: module.name, module_template_id: 'template', module_revision_id: 'revision', orientation: 'HORIZONTAL', endpoints: [{
    key: 'endpoint', kind: 'NETWORK_PORT', installation_id: 'stable-installation-id', panel_key: 'back', panel_display_name: 'Back', bay_key: 'bay-key', bay_display_name: 'PCIe1',
    local_display_name: 'feth1', contextual_display_name: 'Back / PCIe1 / feth1', connection_point_id: 'point', network_interface_id: 'interface', x: .2, y: .2,
  }],
} }] };
const source = (): HardwareModuleDataSource => ({ listModules: vi.fn().mockResolvedValue({ modules: [module] }), loadConfiguration: vi.fn().mockResolvedValue(occupied), createModule: vi.fn(), deleteModule: vi.fn(), installModule: vi.fn().mockResolvedValue(occupied), uninstallModule: vi.fn().mockResolvedValue(free) });
function show(dataSource: HardwareModuleDataSource, onInstalled = vi.fn()) {
  render(<I18nProvider><ModuleInstallationSection objectId="object" dataSource={dataSource} onInstalled={onInstalled} /></I18nProvider>);
  return onInstalled;
}
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('ModuleInstallationSection uninstall', () => {
  it('offers styled removal for an occupied bay and requires a module/bay confirmation', async () => {
    const data = source(); const refresh = show(data);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const remove = await screen.findByRole('button', { name: 'Удалить модуль' });
    expect(remove).toHaveClass('text-action');
    await userEvent.click(remove);
    expect(confirm).toHaveBeenCalledWith('Удалить модуль «FC25Gb-2» из отсека «PCIe1»?');
    expect(data.uninstallModule).not.toHaveBeenCalled();
    expect(screen.getByText('Back / PCIe1 / feth1', { selector: 'li' })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('keeps occupied state until server success, then frees the bay and refreshes the card', async () => {
    const data = source(); let complete!: (value: HardwareConfiguration) => void;
    data.uninstallModule = vi.fn().mockReturnValue(new Promise<HardwareConfiguration>(resolve => { complete = resolve; }));
    const refresh = show(data); vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить модуль' }));
    expect(data.uninstallModule).toHaveBeenCalledWith('object', 'stable-installation-id');
    expect(screen.getByText('Back / PCIe1 / feth1', { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить модуль' })).toBeDisabled();
    expect(screen.queryByLabelText('Выберите совместимый модуль')).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    complete(free);
    expect(await screen.findByText('OCP3 · Свободен')).toBeInTheDocument();
    expect(screen.queryByText('Back / PCIe1 / feth1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить модуль' })).not.toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await userEvent.selectOptions(screen.getByLabelText('Выберите совместимый модуль'), 'template');
    await userEvent.click(screen.getByRole('button', { name: 'Установить модуль' }));
    expect(data.installModule).toHaveBeenCalledWith('object', { bay_key: 'bay-key', module_template_id: 'template', orientation: 'HORIZONTAL' });
    expect(await screen.findByText('Back / PCIe1 / feth1', { selector: 'li' })).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });
  it('keeps installation and endpoints visible after a domain refusal', async () => {
    const data = source(); data.uninstallModule = vi.fn().mockRejectedValue(new Error('ModuleInstallation endpoints are in use (409)'));
    const refresh = show(data); vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить модуль' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ModuleInstallation endpoints are in use (409)');
    expect(screen.getByText('OCP3 · Занят: FC25Gb-2')).toBeInTheDocument();
    expect(screen.getByText('Back / PCIe1 / feth1', { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить модуль' })).toBeEnabled();
    expect(screen.queryByLabelText('Выберите совместимый модуль')).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('never offers uninstall for a free bay', async () => {
    const data = source(); data.loadConfiguration = vi.fn().mockResolvedValue(free); show(data);
    expect(await screen.findByText('OCP3 · Свободен')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить модуль' })).not.toBeInTheDocument();
  });
});

it('renders the installed body and canonical port at projected coordinates', async () => {
  show(source());
  const image = await screen.findByRole('img', { name: 'Back' });
  const port = image.querySelector('[data-endpoint-id="point"]');
  expect(port).toHaveAttribute('cx', '120');
  expect(port).toHaveAttribute('cy', '40');
  expect(image.querySelector('[fill="#123456"]')).toHaveAttribute('width', '180');
});


function pointerSurface() {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('DOMPoint', class {
    constructor(public x: number, public y: number) {}
    matrixTransform() { return this; }
  });
  Object.defineProperty(SVGElement.prototype, 'getScreenCTM', { configurable: true, value: () => ({ inverse: () => ({}) }) });
  Object.defineProperty(SVGElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
}
async function editingSource() {
  pointerSurface();
  const data = source();
  const document = structuredClone(occupied);
  document.base_revision_id = 'base-revision';
  document.bays[0].installation!.initial_layout = { panel_key: 'back', x: .15, y: .15, width: .2, height: .1 };
  data.loadConfiguration = vi.fn().mockResolvedValue(document);
  data.saveLayout = vi.fn().mockImplementation(async (_obj, _id, body) => {
    const result = structuredClone(document); result.bays[0].installation!.layout = body.layout; return result;
  });
  const refresh = show(data);
  await screen.findByRole('img', { name: 'Back' });
  const body = documentQuery();
  const panel = screen.getByRole('img', { name: 'Back' });
  return { data, body, panel, refresh };
}
function documentQuery() { return document.querySelector('[data-installation-id]')!; }
function drag(body: Element, panel: Element, x = 1200, y = 400) {
  fireEvent.pointerDown(body, { clientX: 60, clientY: 20, pointerId: 1 });
  fireEvent.pointerMove(panel, { clientX: x, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(panel, { pointerId: 1 });
}
it('keeps normal view inert; selects, clamps drag, projects ports, cancels and exits', async () => {
  const { data, body, panel } = await editingSource();
  drag(body, panel); expect(body.getAttribute('x')).toBe('60');
  await userEvent.click(screen.getByText('Корректировать расположение'));
  drag(body, panel);
  expect(Number(body.getAttribute('x'))).toBeCloseTo(420);
  expect(Number(body.getAttribute('y'))).toBeCloseTo(160);
  expect(screen.getByLabelText('Изменить размер')).toBeInTheDocument();
  const port = document.querySelector('[data-endpoint-id]')!;
  expect(Number(port.getAttribute('cx'))).toBeCloseTo(480);
  expect(screen.getByText('Есть несохранённые изменения')).toBeInTheDocument();
  expect(data.saveLayout).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText('Отменить правки'));
  expect(body.getAttribute('x')).toBe('60');
  await userEvent.click(screen.getByText('Завершить корректировку'));
  expect(screen.queryByLabelText('Изменить размер')).not.toBeInTheDocument();
});
it('resizes proportionally inside panel and saves the expected server snapshot', async () => {
  const { data, body, panel, refresh } = await editingSource();
  await userEvent.click(screen.getByText('Корректировать расположение'));
  fireEvent.pointerDown(body, { clientX: 60, clientY: 20 }); fireEvent.pointerUp(panel);
  const handle = screen.getByLabelText('Изменить размер');
  drag(handle, panel);
  expect(Number(body.getAttribute('width')) / Number(body.getAttribute('height'))).toBeCloseTo(4.5);
  expect(Number(body.getAttribute('x')) + Number(body.getAttribute('width'))).toBeLessThanOrEqual(600);
  await userEvent.click(screen.getByText('Сохранить расположение'));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(data.saveLayout).toHaveBeenCalledWith('object', 'stable-installation-id', expect.objectContaining({ base_revision_id: 'base-revision', expected_layout: occupied.bays[0].installation!.layout }));
  expect(screen.queryByText('Есть несохранённые изменения')).not.toBeInTheDocument();
});
it.each(['server error', '409 layout changed'])('retains reset draft on %s and allows retry or cancel', async message => {
  const { data, body, panel } = await editingSource();
  await userEvent.click(screen.getByText('Корректировать расположение'));
  fireEvent.pointerDown(body, { clientX: 60, clientY: 20 }); fireEvent.pointerUp(panel);
  await userEvent.click(screen.getByText('Начальное размещение'));
  expect(body.getAttribute('x')).toBe('90'); expect(data.saveLayout).not.toHaveBeenCalled();
  vi.mocked(data.saveLayout!).mockRejectedValueOnce(new Error(message));
  await userEvent.click(screen.getByText('Сохранить расположение'));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(body.getAttribute('x')).toBe('90');
  expect(screen.getByText('Есть несохранённые изменения')).toBeInTheDocument();
  await userEvent.click(screen.getByText('Сохранить расположение'));
  await waitFor(() => expect(screen.queryByText('Есть несохранённые изменения')).not.toBeInTheDocument());
});
