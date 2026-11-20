import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { addModulePorts, alignSelectionLine, blueprintMarkers, copySelectionToPanel, distributeSelection, layoutSelectionTwoRows,
  snapSelectionTranslation, translateSelection } from '../blueprints/editorModel';
import { I18nProvider } from '../i18n';
import { BaseTemplateEditor, newBlueprintEditorState } from './BaseTemplateEditor';
import type { BlueprintEditorState } from '../blueprints/editorModel';

const panel = { panel_key: 'one', panel_number: 1, display_name: 'Front', x: 0, y: 0, width: 100, height: 40 };
const rear = { ...panel, panel_key: 'two', panel_number: 2, display_name: 'Rear', x: 100 };
const historical = { kind: 'PLACED' as const, bay_key: 'history', display_name: 'Original', compatibility: 'Old',
  panel_key: 'one', x: .2, y: .3, width: .2, height: .2 };
const logical = { kind: 'LOGICAL' as const, bay_key: 'logical', display_name: 'Capacity', compatibility: 'Old', panel_key: 'one' };
const state = (): BlueprintEditorState => ({
  ...newBlueprintEditorState(), name: 'Server', panels: [panel, rear], activePanelKey: 'one', bays: [historical, logical],
  nextLocalNumberByPanel: { one: 1, two: 1 },
  slots: [
    { key: 'circle', kind: 'CONNECTION_POINT', display_name: 'Circle', port_type_id: 'copper', panel_key: 'one', rendered_position: { x: .45, y: .6 } },
    { key: 'square', kind: 'NETWORK_PORT', display_name: 'Square', port_type_id: 'copper', panel_key: 'one', rendered_position: { x: .7, y: .7 } },
  ],
});

function show(initialState = state()) {
  const save = vi.fn().mockResolvedValue(undefined);
  const view = render(<I18nProvider><MemoryRouter><BaseTemplateEditor initialState={initialState} onSave={save}
    title="Base" description="" saveLabel="Save" /></MemoryRouter></I18nProvider>);
  return { ...view, save };
}

afterEach(() => vi.restoreAllMocks());

it.each([1, 2, 48])('creates %i independent module markers and reopens their saved positions', count => {
  const view = show();
  const chooser = within(view.container.querySelector<HTMLElement>('.template-element-creator')!);
  fireEvent.change(chooser.getByLabelText('Вид точки'), { target: { value: 'MODULE_PORT' } });
  fireEvent.change(chooser.getByLabelText('Количество'), { target: { value: count } });
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
  expect(added.every(bay => bay.kind === 'PLACED' && bay.compatibility === 'Open / 42' && !('width' in bay))).toBe(true);
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
  expect(distributed.bays![0]).toMatchObject({ bay_key: 'history', compatibility: 'Old' });
  expect(distributed.bays![0]).not.toHaveProperty('width');
  expect(new Set(blueprintMarkers(layoutSelectionTwoRows(distributed, selected)).map(marker => marker.rendered_position.y)).size).toBe(2);
  const copy = copySelectionToPanel(distributed, selected, 'two', true);
  expect(copy.copiedKeys).toHaveLength(3);
  const copiedBay = copy.state.bays!.at(-1)!;
  expect(copiedBay).toMatchObject({ kind: 'PLACED', panel_key: 'two', compatibility: 'Old', x: .1 });
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
  full = addModulePorts(full, 'one', 256, 'New');
  full = addModulePorts(full, 'one', 141, 'New');
  expect(blueprintMarkers(full)).toHaveLength(400);
  expect(addModulePorts(full, 'one', 1, 'New')).toBe(full);
});
