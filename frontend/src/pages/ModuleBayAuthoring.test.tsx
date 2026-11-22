import { moduleMount } from '../topology/hardwareModules';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { addModulePlaces, alignSelectionLine, blueprintMarkers, copySelectionToPanel, distributeSelection, layoutSelectionTwoRows,
  snapSelectionTranslation, translateSelection } from '../blueprints/editorModel';
import { I18nProvider } from '../i18n';
import { BaseTemplateEditor, newBlueprintEditorState } from './BaseTemplateEditor';
import type { BlueprintEditorState } from '../blueprints/editorModel';

const panel = { panel_key: 'one', panel_number: 1, display_name: 'Front', x: 0, y: 0, width: 100, height: 40 };
const rear = { ...panel, panel_key: 'two', panel_number: 2, display_name: 'Rear', x: 100 };
const historical = { kind: 'PLACED' as const, bay_key: 'history', display_name: 'Original', mount_kind: 'MODULE_PORT' as const, module_port_type_id: 'Old',
  panel_key: 'one', x: .2, y: .3, width: .2, height: .2 };
const logical = { kind: 'LOGICAL' as const, bay_key: 'logical', display_name: 'Capacity', mount_kind: 'MODULE_PORT' as const, module_port_type_id: 'Old', panel_key: 'one' };
const state = (): BlueprintEditorState => ({
  ...newBlueprintEditorState(), name: 'Server', panels: [panel, rear], activePanelKey: 'one', bays: [historical, logical],
  nextLocalNumberByPanel: { one: 1, two: 1 },
  slots: [
    { key: 'circle', kind: 'CONNECTION_POINT', display_name: 'Circle', port_type_id: 'copper', panel_key: 'one', rendered_position: { x: .45, y: .6 } },
    { key: 'square', kind: 'NETWORK_PORT', display_name: 'Square', port_type_id: 'copper', panel_key: 'one', rendered_position: { x: .7, y: .7 } },
  ],
});

function show(initialState = state()) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async url => Response.json(String(url).endsWith('/module-port-types') ? ['Old', 'Open / 42', 'Custom'].map(name => ({ id: name, name, is_active: true })) : String(url).endsWith('/module-bay-types') ? [{ id: 'pcie', name: 'PCIe x16', is_active: true }] : []));
  const save = vi.fn().mockResolvedValue(undefined);
  const view = render(<I18nProvider><MemoryRouter><BaseTemplateEditor initialState={initialState} onSave={save}
    title="Base" description="" saveLabel="Save" /></MemoryRouter></I18nProvider>);
  return { ...view, save };
}

afterEach(() => vi.restoreAllMocks());

it.each([1, 2, 48])('creates %i independent module markers and reopens their saved positions', async count => {
  const view = show();
  const chooser = within(view.container.querySelector<HTMLElement>('.template-element-creator')!);
  fireEvent.change(chooser.getByLabelText('Вид точки'), { target: { value: 'MODULE_PORT' } });
  fireEvent.change(chooser.getByLabelText('Количество'), { target: { value: count } });
  await waitFor(() => expect(chooser.getByRole('option', { name: 'Open / 42' })).toBeEnabled());
  fireEvent.change(chooser.getByLabelText('Совместимость модульного порта'), { target: { value: 'Open / 42' } });
  fireEvent.click(chooser.getByRole('button', { name: /^Добавить$/ }));
  expect(view.container.querySelectorAll('polygon[data-module-port-marker]')).toHaveLength(count + 1);
  expect(view.container.querySelector('[data-bay-resize]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  const saved = view.save.mock.calls[0][0] as BlueprintEditorState;
  const added = saved.bays!.slice(2);
  expect(saved.bays!.slice(0, 2)).toEqual([historical, logical]);
  expect(saved.slots).toEqual(state().slots);
  expect(new Set(added.map(bay => bay.bay_key)).size).toBe(count);
  expect(new Set(added.map(bay => `${bay.x}:${bay.y}`)).size).toBe(count);
  expect(added.map(bay => bay.display_name)).toEqual(Array.from({ length: count }, (_, i) => `1-${i + 1}`));
  expect(added.every(bay => bay.kind === 'PLACED' && bay.module_port_type_id === 'Open / 42' && !('width' in bay))).toBe(true);
  const positions = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-module-port-marker]'), marker => {
    const [top, right] = marker.getAttribute('points')!.split(' ');
    return [top.split(',')[0], right.split(',')[1]];
  });
  const original = positions(view.container);
  view.unmount();
  expect(positions(show(saved).container)).toEqual(original);
});

it('uses the same snap, alignment, distribution and panel copy for a mixed selection', () => {
  const original = state();
  const selected = new Set(['history', 'circle', 'square']);
  expect(blueprintMarkers(original).find(marker => marker.key === 'history')?.rendered_position).toEqual({ x: expect.closeTo(.3), y: .4 });
  const snap = snapSelectionTranslation(blueprintMarkers(original), new Set(['history']), .14, 0, .02, .02);
  expect(snap.guideX).toBe(.45);
  const moved = translateSelection(original, selected, .1, .1);
  const aligned = alignSelectionLine(moved, selected, 'horizontal');
  const distributed = distributeSelection(aligned, selected, 'x', { mode: 'full' }, .1);
  const markers = blueprintMarkers(distributed);
  expect(markers.map(marker => marker.rendered_position.x).sort()).toEqual([.1, .5, .9]);
  expect(new Set(markers.map(marker => marker.rendered_position.y)).size).toBe(1);
  expect(distributed.bays![0]).toMatchObject({ bay_key: 'history', mount_kind: 'MODULE_PORT' as const, module_port_type_id: 'Old' });
  expect(distributed.bays![0]).not.toHaveProperty('width');
  expect(new Set(blueprintMarkers(layoutSelectionTwoRows(distributed, selected)).map(marker => marker.rendered_position.y)).size).toBe(2);
  const copy = copySelectionToPanel(distributed, selected, 'two', true);
  expect(copy.copiedKeys).toHaveLength(3);
  const copiedBay = copy.state.bays!.at(-1)!;
  expect(copiedBay).toMatchObject({ kind: 'PLACED', panel_key: 'two', mount_kind: 'MODULE_PORT' as const, module_port_type_id: 'Old', x: .1 });
  expect(copiedBay.bay_key).not.toBe('history');
  expect(copy.state.individualLinks).toHaveLength(2);
  expect(copy.state.individualLinks.every(link => link.from_slot_key !== 'history' && link.to_slot_key !== copiedBay.bay_key)).toBe(true);
});

it('removes a marquee selection of mixed markers while retaining logical capacity', () => {
  const original = state();
  original.panels = [panel];
  const view = show(original);
  const canvas = view.container.querySelector('svg.blueprint-composition-canvas')!;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 400 } as DOMRect);
  fireEvent.pointerDown(canvas.querySelector('.blueprint-composition-canvas__body')!, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(canvas, { clientX: 850, clientY: 350 });
  fireEvent.pointerUp(canvas);
  expect(canvas.querySelectorAll('[data-slot-key][data-selected="true"]')).toHaveLength(3);
  fireEvent.keyDown(document, { key: 'Delete' });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(view.save.mock.calls[0][0]).toMatchObject({ slots: [], bays: [logical] });
});

it('keeps the draft intact if the shared panel marker limit is reached', () => {
  let full = state();
  full = addModulePlaces(full, 'one', 256, moduleMount('MODULE_PORT', 'New'));
  full = addModulePlaces(full, 'one', 141, moduleMount('MODULE_PORT', 'New'));
  expect(blueprintMarkers(full)).toHaveLength(400);
  expect(addModulePlaces(full, 'one', 1, moduleMount('MODULE_PORT', 'New'))).toBe(full);
});

it('opens the existing naming workspace from a selection of 48 diamonds and saves names by key', async () => {
  const original = state();
  const view = show(original);
  const creator = within(view.container.querySelector<HTMLElement>('.template-element-creator')!);
  fireEvent.change(creator.getByLabelText('Вид точки'), { target: { value: 'MODULE_PORT' } });
  fireEvent.change(creator.getByLabelText('Количество'), { target: { value: '48' } });
  await waitFor(() => expect(creator.getByRole('option', { name: 'Custom' })).toBeEnabled());
  fireEvent.change(creator.getByLabelText('Совместимость модульного порта'), { target: { value: 'Custom' } });
  fireEvent.click(creator.getByRole('button', { name: /^Добавить$/ }));
  const selectedMarker = view.container.querySelector('[data-selected="true"] [data-module-port-marker]')!;
  fireEvent.contextMenu(selectedMarker);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Массовое переименование' }));
  const a = within(screen.getByRole('region', { name: 'A' }));
  expect(a.getAllByRole('checkbox').filter(input => (input as HTMLInputElement).checked)).toHaveLength(48);
  fireEvent.change(a.getByLabelText('Маска (#, ##, GE-##)'), { target: { value: 'MP-##' } });
  expect(a.getByText('→ MP-48')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Создать связи' })).toBeDisabled();
  fireEvent.click(a.getByRole('button', { name: 'Применить имена' }));
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  const saved = view.save.mock.calls[0][0] as BlueprintEditorState;
  expect(saved.bays!.slice(0, 2)).toEqual(original.bays);
  expect(saved.bays!.slice(2).map(bay => bay.display_name)).toEqual(Array.from({ length: 48 }, (_, i) => `MP-${String(i + 1).padStart(2, '0')}`));
  expect(saved.slots).toEqual(original.slots);
  expect(saved.individualLinks).toEqual([]);
});


it('creates logical board bays while keeping the three graphical point kinds', async () => {
  const view = show();
  const chooser = within(view.container.querySelector<HTMLElement>('.template-element-creator')!);
  expect(within(chooser.getByRole('combobox', { name: 'Вид точки' })).getAllByRole('option').map(option => option.getAttribute('value')))
    .toEqual(['NETWORK_PORT', 'CONNECTION_POINT', 'MODULE_PORT']);

  fireEvent.click(screen.getByText('Логические отсеки · 0'));
  const logicalCreator = within(screen.getByRole('group', { name: 'Создать группу' }));
  await logicalCreator.findByRole('option', { name: 'PCIe x16' });
  expect(logicalCreator.queryByRole('option', { name: 'Open / 42' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Добавить на панель' })).toBeNull();
  fireEvent.change(logicalCreator.getByLabelText('Тип модульного отсека'), { target: { value: 'pcie' } });
  fireEvent.change(logicalCreator.getByLabelText('Количество мест'), { target: { value: '3' } });
  fireEvent.click(logicalCreator.getByRole('button', { name: 'Создать группу' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  const saved = view.save.mock.calls[0][0] as BlueprintEditorState;
  const added = saved.bays!.slice(2);
  expect(saved.bays!.slice(0, 2)).toEqual(state().bays);
  expect(added).toHaveLength(3);
  expect(new Set(added.map(bay => bay.bay_key)).size).toBe(3);
  for (const bay of added) {
    expect(bay).toMatchObject({ kind: 'LOGICAL', mount_kind: 'MODULE_BAY', module_bay_type_id: 'pcie', panel_key: 'one', x: null, y: null });
  }
  expect(view.container.querySelector('[data-module-bay-marker]')).toBeNull();

  view.unmount();
  show(saved);
  fireEvent.click(screen.getByText('Логические отсеки · 1'));
  const group = within(await screen.findByRole('group', { name: '1 · Front / Модульный отсек · PCIe x16' }));
  expect(group.getByLabelText('Количество мест')).toHaveValue('3');
});
