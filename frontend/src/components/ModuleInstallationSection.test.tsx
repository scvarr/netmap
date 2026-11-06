import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import type { HardwareConfiguration, HardwareModuleDataSource } from '../topology/hardwareModules';
import { ModuleInstallationSection } from './ModuleInstallationSection';

const module = { template_id: 'template', revision_id: 'revision', name: 'FC25Gb-2', compatibility: 'OCP3', endpoints: [] };
const free: HardwareConfiguration = { configuration_id: 'config', base_revision_id: 'base-revision', bays: [{ bay_key: 'bay-key', display_name: 'PCIe1', compatibility: 'OCP3', panel_key: 'back', x: .1, y: .1, width: .3, height: .3, installation: null }] };
const occupied: HardwareConfiguration = { ...free, panels: [{ panel_key: 'back', display_name: 'Back', width: 600, height: 200 }], bays: [{ ...free.bays[0], installation: {
  layout: { panel_key: 'back', x: .1, y: .1, width: .3, height: .2 }, fill_color: '#123456', id: 'stable-installation-id', name: module.name, module_template_id: 'template', module_revision_id: 'revision', orientation: 'HORIZONTAL', endpoints: [{
    key: 'endpoint', port_type_id: 'test-type', kind: 'NETWORK_PORT', installation_id: 'stable-installation-id', panel_key: 'back', panel_display_name: 'Back', bay_key: 'bay-key', bay_display_name: 'PCIe1',
    local_display_name: 'feth1', contextual_display_name: 'Back / PCIe1 / feth1', connection_point_id: 'point', network_interface_id: 'interface', x: .2, y: .2,
  }],
} }] };
const source = (): HardwareModuleDataSource => ({ listModules: vi.fn().mockResolvedValue({ modules: [module] }), loadConfiguration: vi.fn().mockResolvedValue(occupied), createModule: vi.fn(), deleteModule: vi.fn(), installModule: vi.fn().mockResolvedValue(occupied), uninstallModule: vi.fn().mockResolvedValue(free) });
const basePresentation: import('../topology/types').BlueprintPresentation = { blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'base' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'base-revision' }, body: { kind: 'RECTANGLE', width: 600, height: 200 }, panels: [{ panel_key: 'back', panel_number: 1, display_name: 'Back', x: 0, y: 0, width: 600, height: 200 }], slots: [] };
function show(dataSource: HardwareModuleDataSource, onInstalled = vi.fn(), presentation = basePresentation) {
  render(<I18nProvider><ModuleInstallationSection objectId="object" presentation={presentation} dataSource={dataSource} onInstalled={onInstalled} /></I18nProvider>);
  return onInstalled;
}
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
});
afterEach(() => vi.unstubAllGlobals());

function tableBayKeys() {
  return Array.from(screen.getByRole('table').querySelectorAll('[data-bay-key]'), row => row.getAttribute('data-bay-key'));
}

it('groups mixed places by pinned panel and exact compatibility, with stable natural order on reopen', async () => {
  const data = source();
  const logical = (key: string, name: string, compatibility = 'OCP3', panel = 'back'): HardwareConfiguration['bays'][number] => ({
    kind: 'LOGICAL', bay_key: key, display_name: name, compatibility, panel_key: panel, installation: null,
  });
  const bays = [
    logical('ten', 'Место 10'), logical('two-b', 'Место 2'),
    logical('lower', 'Lower case', 'ocp3'), logical('space', 'With space', 'OCP3 '),
    { ...free.bays[0], bay_key: 'fixed', display_name: 'Fixed-01', compatibility: 'AUX' },
    logical('front', 'Место 1', 'OCP3', 'front'),
    logical('one', 'Место 1'), logical('two-a', 'Место 2'),
    logical('missing-z', 'Место 1', 'OCP3', 'z'), logical('missing-a', 'Место 1', 'OCP3', 'a'),
  ];
  const presentation = { ...basePresentation, panels: [
    { ...basePresentation.panels[0], panel_number: 2 },
    { ...basePresentation.panels[0], panel_key: 'front', display_name: 'Front', panel_number: 1 },
  ] };
  vi.mocked(data.loadConfiguration).mockResolvedValueOnce({ ...free, bays })
    .mockResolvedValueOnce({ ...free, bays: [...bays].reverse() });
  show(data, vi.fn(), presentation);
  const table = await screen.findByRole('table');
  expect(Array.from(table.querySelectorAll('th[scope="rowgroup"]'), header => header.textContent)).toEqual([
    'Front · OCP3', 'Back · AUX', 'Back · OCP3', 'Back · ocp3', 'Back · OCP3 ', 'a · OCP3', 'z · OCP3',
  ]);
  const order = ['front', 'fixed', 'one', 'two-a', 'two-b', 'ten', 'lower', 'space', 'missing-a', 'missing-z'];
  expect(tableBayKeys()).toEqual(order);
  for (const name of ['Lower case', 'With space']) {
    const row = within(screen.getByRole('rowheader', { name }).closest('tr')!);
    expect(row.getByText('Нет совместимых модулей')).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Установить' })).toBeDisabled();
  }
  cleanup();
  show(data, vi.fn(), presentation);
  await screen.findByRole('table');
  expect(tableBayKeys()).toEqual(order);
});

it('shows the installed orientation and toggles the canonical port details', async () => {
  const data = source();
  const config = structuredClone(occupied);
  config.bays[0].installation!.orientation = 'VERTICAL';
  vi.mocked(data.loadConfiguration).mockResolvedValue(config);
  show(data);
  const row = within((await screen.findByRole('rowheader', { name: 'PCIe1' })).closest('tr')!);
  expect(row.getByText(module.name)).toBeInTheDocument();
  expect(row.getByRole('cell', { name: 'Вертикальная' })).toBeInTheDocument();
  const summary = row.getByText('Порты');
  expect(summary.parentElement).not.toHaveAttribute('open');
  await userEvent.click(summary);
  expect(summary.parentElement).toHaveAttribute('open');
  expect(row.getByRole('listitem')).toHaveTextContent('Back / PCIe1 / feth1');
  expect(row.getByRole('listitem')).toHaveAttribute('data-connection-point-id', 'point');
  await userEvent.click(summary);
  expect(summary.parentElement).not.toHaveAttribute('open');
});

describe('ModuleInstallationSection uninstall', () => {
  it('offers styled removal for an occupied bay and requires a module/bay confirmation', async () => {
    const data = source(); const refresh = show(data);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const remove = await screen.findByRole('button', { name: 'Удалить' });
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
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
    expect(data.uninstallModule).toHaveBeenCalledWith('object', 'stable-installation-id');
    expect(screen.getByText('Back / PCIe1 / feth1', { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeDisabled();
    expect(screen.queryByLabelText('Выберите совместимый модуль')).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    complete(free);
    expect(await screen.findByRole('combobox', { name: 'Выберите совместимый модуль' })).toBeInTheDocument();
    expect(screen.queryByText('Back / PCIe1 / feth1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await userEvent.selectOptions(screen.getByLabelText('Выберите совместимый модуль'), 'template');
    await userEvent.click(screen.getByRole('button', { name: 'Установить' }));
    expect(data.installModule).toHaveBeenCalledWith('object', { bay_key: 'bay-key', module_template_id: 'template', orientation: 'HORIZONTAL' });
    expect(await screen.findByText('Back / PCIe1 / feth1', { selector: 'li' })).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });
  it('keeps the expanded installation details after a domain refusal', async () => {
    const data = source(); data.uninstallModule = vi.fn().mockRejectedValue(new Error('ModuleInstallation endpoints are in use (409)'));
    const refresh = show(data); vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(await screen.findByText('Порты'));
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ModuleInstallation endpoints are in use (409)');
    expect(screen.getByText('FC25Gb-2', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('Back / PCIe1 / feth1', { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByText('Порты').parentElement).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeEnabled();
    expect(screen.queryByLabelText('Выберите совместимый модуль')).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('never offers uninstall for a free bay', async () => {
    const data = source(); data.loadConfiguration = vi.fn().mockResolvedValue(free); show(data);
    expect(await screen.findByRole('combobox', { name: 'Выберите совместимый модуль' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
  });
});

it('renders the installed body and canonical port at projected coordinates', async () => {
  show(source());
  const image = await screen.findByRole('img', { name: 'Back' });
  const port = image.querySelector('rect[data-endpoint-id="point"]')!;
  expect(Number(port.getAttribute('x')) + Number(port.getAttribute('width')) / 2).toBeCloseTo(120);
  expect(Number(port.getAttribute('y')) + Number(port.getAttribute('height')) / 2).toBeCloseTo(40);
  expect(port.querySelector('title')).toBeInTheDocument();
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
  expect(port.tagName).toBe('rect');
  expect(port).toHaveAttribute('fill', '#60d4c9');
  expect(Number(port.getAttribute('x')) + Number(port.getAttribute('width')) / 2).toBeCloseTo(480);
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


it.each([[600, 1, 140], [1, 600, 360], [600, 200, 150]])('fits %s × %s panels in a %s px preview and keeps port radii at four screen pixels', async (width, height, previewHeight) => {
  const data = source();
  const config = structuredClone(occupied);
  const installation = config.bays[0].installation!;
  installation.name = 'NIC-2GE';
  installation.endpoints.push({ ...installation.endpoints[0], key: 'second', connection_point_id: 'point-2', network_interface_id: 'interface-2', x: .3 });
  config.bays.push({ ...free.bays[0], bay_key: 'empty', panel_key: 'front', installation: null });
  data.loadConfiguration = vi.fn().mockResolvedValue(config);
  const presentation = structuredClone(basePresentation);
  presentation.panels = [
    { ...presentation.panels[0], width, height },
    { ...presentation.panels[0], panel_key: 'front', display_name: 'Front', x: width + 10, width, height },
  ];
  presentation.slots = [{ slot_key: 'builtin', display_name: 'Built in', kind: 'CONNECTION_POINT', panel_key: 'front', panel_local_position: { x: .5, y: .5 }, rendered_position: { x: .5, y: .5 }, external_attachment: { x: 0, y: .5, side: 'LEFT' }, connection_point_id: 'builtin' }];
  show(data, vi.fn(), presentation);
  const back = await screen.findByRole('img', { name: 'Back' });
  expect(screen.getByRole('img', { name: 'Front' }).querySelector('[stroke-dasharray]')).toBeInTheDocument();
  expect(document.querySelectorAll('[data-panel-key]')).toHaveLength(2);
  expect(document.querySelectorAll('[data-endpoint-id]')).toHaveLength(2);
  const preview = screen.getByRole('img', { name: 'Предпросмотр схемы' });
  expect(preview.parentElement).toHaveStyle({ height: `${previewHeight}px` });
  const [x, y, viewWidth, viewHeight] = preview.getAttribute('viewBox')!.split(' ').map(Number);
  expect(viewWidth / viewHeight).toBeCloseTo(800 / previewHeight);
  expect(x).toBeLessThan(0);
  expect(y).toBeLessThan(0);
  expect(x + viewWidth).toBeGreaterThan(width * 2 + 10);
  expect(y + viewHeight).toBeGreaterThan(height);
  const scale = 800 / viewWidth;
  for (const port of document.querySelectorAll('[data-endpoint-id], [data-builtin-endpoint-id]')) {
    const radius = port.tagName === 'rect'
      ? Number(port.getAttribute('width')) / Math.SQRT2 : Number(port.getAttribute('r'));
    expect(radius * scale).toBeCloseTo(4);
    expect(port).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  }
  const builtin = screen.getByRole('img', { name: 'Front' }).querySelector('[data-builtin-endpoint-id="builtin"]');
  expect(builtin?.tagName).toBe('circle');
  expect(builtin).toHaveAttribute('fill', '#f2d081');
  expect(Number(builtin?.getAttribute('cx'))).toBeCloseTo(width / 2);
  expect(Number(builtin?.getAttribute('cy'))).toBeCloseTo(height / 2);
  expect(back.querySelector('[data-installation-id]')).toHaveAttribute('data-installation-id', 'stable-installation-id');
  expect(data.saveLayout).toBeUndefined();
});

it('refuses to mix another base revision with the current configuration', async () => {
  show(source(), vi.fn(), { ...basePresentation, version_ref: { ...basePresentation.version_ref, entity_id: 'latest-published' } });
  await screen.findByText('FC25Gb-2');
  expect(document.querySelector('[data-panel-key]')).not.toBeInTheDocument();
  expect(screen.getByRole('status').parentElement?.style.height).toBe('');
});

it('tracks container width across view and editing without resetting the table', async () => {
  let notifyResize!: () => void;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe() {}
    disconnect() {}
  });
  const { panel } = await editingSource();
  const preview = panel.parentElement!;
  const viewport = preview.parentElement!;
  const order = tableBayKeys();
  const summary = screen.getByText('Порты');
  await userEvent.click(summary);
  expect(viewport).toHaveStyle({ height: '278px' });

  vi.mocked(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!.get!).mockReturnValue(300);
  act(() => notifyResize());
  expect(viewport).toHaveStyle({ height: '140px' });
  const compactViewBox = preview.getAttribute('viewBox');

  await userEvent.click(screen.getByText('Корректировать расположение'));
  expect(viewport).toHaveStyle({ height: '360px' });
  expect(preview.getAttribute('viewBox')).not.toBe(compactViewBox);
  await userEvent.click(screen.getByText('Завершить корректировку'));
  expect(viewport).toHaveStyle({ height: '140px' });
  expect(preview).toHaveAttribute('viewBox', compactViewBox);
  expect(summary.parentElement).toHaveAttribute('open');
  expect(tableBayKeys()).toEqual(order);
});


it('selects only one module and reopens the explicitly saved layout without changing endpoint identity', async () => {
  pointerSurface();
  const data = source();
  const saved = structuredClone(occupied);
  saved.bays[0].installation!.initial_layout = { panel_key: 'back', x: .15, y: .15, width: .2, height: .1 };
  saved.bays.push({ ...saved.bays[0], bay_key: 'second-bay', installation: { ...saved.bays[0].installation!, id: 'second-installation', endpoints: [] } });
  saved.bays.push({ ...free.bays[0], bay_key: 'free-bay', display_name: 'Free place' });
  data.loadConfiguration = vi.fn().mockImplementation(async () => structuredClone(saved));
  data.saveLayout = vi.fn().mockImplementation(async (_object, id, body) => {
    expect(id).toBe('stable-installation-id');
    saved.bays[0].installation!.layout = body.layout;
    return structuredClone(saved);
  });
  show(data);
  const panel = await screen.findByRole('img', { name: 'Back' });
  await userEvent.click(screen.getByText('Корректировать расположение'));
  const order = tableBayKeys();
  expect(screen.getByLabelText('Выберите совместимый модуль')).toBeDisabled();
  expect(screen.getByLabelText('Ориентация')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Установить' })).toBeDisabled();
  for (const remove of screen.getAllByRole('button', { name: 'Удалить' })) expect(remove).toBeDisabled();
  const first = document.querySelector('[data-installation-id="stable-installation-id"]')!;
  const second = document.querySelector('[data-installation-id="second-installation"]')!;
  fireEvent.pointerDown(first, { clientX: 60, clientY: 20 }); fireEvent.pointerUp(panel);
  await userEvent.click(screen.getByText('Начальное размещение'));
  fireEvent.pointerDown(second, { clientX: 60, clientY: 20 }); fireEvent.pointerUp(panel);
  expect(screen.getAllByLabelText('Изменить размер')).toHaveLength(1);
  expect(tableBayKeys()).toEqual(order);
  expect(first).toHaveAttribute('stroke', '#f59e0b');
  expect(second).toHaveAttribute('stroke', 'none');
  await userEvent.click(screen.getByText('Сохранить расположение'));
  await waitFor(() => expect(data.saveLayout).toHaveBeenCalledOnce());
  cleanup(); show(data);
  await screen.findByRole('img', { name: 'Back' });
  expect(document.querySelector('[data-installation-id="stable-installation-id"]')).toHaveAttribute('x', '90');
  expect(saved.bays[0].installation!.endpoints[0]).toEqual(occupied.bays[0].installation!.endpoints[0]);
  expect(data.saveLayout).toHaveBeenCalledOnce();
});


it('reads a logical place without drawing a rectangle and enables installation', async () => {
  const data = source();
  vi.mocked(data.loadConfiguration).mockResolvedValue({ ...free, panels: occupied.panels, bays: [{
    kind: 'LOGICAL', bay_key: 'logical', display_name: 'Logical place', compatibility: 'OCP3', panel_key: 'back', installation: null,
  }] });
  show(data);
  await screen.findByRole('rowheader', { name: 'Logical place' });
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'template' } });
  expect(document.querySelector('button.primary-action')).toBeEnabled();
  expect(document.querySelectorAll('svg rect')).toHaveLength(1);
  expect(document.querySelectorAll('svg [data-endpoint-marker]')).toHaveLength(0);
  expect(document.querySelector('svg')?.outerHTML).not.toMatch(/NaN|undefined/);
  expect(data.installModule).not.toHaveBeenCalled();
});
