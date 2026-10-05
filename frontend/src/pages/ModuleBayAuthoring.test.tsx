import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { BaseTemplateEditor, newBlueprintEditorState } from './BaseTemplateEditor';
import type { BlueprintEditorState } from '../blueprints/editorModel';
import type { ModuleBay } from '../topology/hardwareModules';

const bay: ModuleBay = { bay_key: 'bay', display_name: 'OCP', compatibility: 'OCP3', panel_key: 'one', x: .2, y: .2, width: .3, height: .3 };
const panel = { panel_key: 'one', panel_number: 1, display_name: 'Front', x: 0, y: 0, width: 100, height: 40 };
const rear = { ...panel, panel_key: 'two', panel_number: 2, display_name: 'Rear', x: 100 };
function show(patch: Partial<BlueprintEditorState> = {}) {
  const state = { ...newBlueprintEditorState(), name: 'Server', panels: [panel], activePanelKey: 'one', nextPanelNumber: 3, nextLocalNumberByPanel: { one: 1, two: 1 }, bays: [bay], ...patch };
  const save = vi.fn().mockResolvedValue(undefined);
  const result = render(<I18nProvider><MemoryRouter><BaseTemplateEditor initialState={state} onSave={save} title="Base" description="" saveLabel="Save" /></MemoryRouter></I18nProvider>);
  const canvas = () => result.container.querySelector('.blueprint-composition-canvas')!;
  const rectangle = (key = 'bay') => result.container.querySelector(`[data-bay-key="${key}"] > rect`)!;
  const choose = () => { fireEvent.pointerDown(rectangle(), { button: 0, clientX: 250, clientY: 100 }); fireEvent.pointerUp(canvas()); };
  const field = (axis: string) => within(screen.getByRole('region', { name: 'Отсеки модулей' })).getByLabelText(axis);
  const gesture = (target: Element, start: [number, number], end: [number, number]) => {
    fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: start[0], clientY: start[1] });
    fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: end[0], clientY: end[1] }); fireEvent.pointerUp(canvas());
  };
  return { ...result, canvas, rectangle, choose, field, gesture, save };
}
beforeEach(() => { localStorage.clear(); vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 400 } as DOMRect); });
afterEach(() => vi.restoreAllMocks());

describe('bay edge snapping and hundredth precision', () => {
  const moving = { ...bay, width: .2, height: .2 };
  const neighbour = { ...bay, bay_key: 'neighbour', x: .5, y: .5, width: .2, height: .2 };
  const precision = (rectangle: ModuleBay) => {
    for (const axis of ['x', 'y', 'width', 'height'] as const) expect(Number(rectangle[axis].toFixed(2))).toBe(rectangle[axis]);
    expect(rectangle.x).toBeGreaterThanOrEqual(0); expect(rectangle.y).toBeGreaterThanOrEqual(0);
    expect(rectangle.width).toBeGreaterThan(0); expect(rectangle.height).toBeGreaterThan(0);
    expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(1); expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(1);
  };
  it.each([
    { name: 'right to left', end: [347, 100], axis: 'x', value: .3, guide: .5 },
    { name: 'left to right', end: [747, 100], axis: 'x', value: .7, guide: .7 },
    { name: 'bottom to top', end: [250, 139], axis: 'y', value: .3, guide: .5 },
    { name: 'top to bottom', end: [250, 299], axis: 'y', value: .7, guide: .7 },
  ])('snaps $name, shows a guide and preserves docking after save', ({ end, axis, value, guide }) => {
    const { rectangle, canvas, field, save } = show({ bays: [moving, neighbour] });
    fireEvent.pointerDown(rectangle(), { button: 0, clientX: 250, clientY: 100 });
    fireEvent.pointerMove(canvas(), { clientX: end[0], clientY: end[1] });
    expect(field(axis)).toHaveValue(value);
    const line = canvas().querySelector(`[data-guide-${axis}]`)!;
    expect(line).toHaveClass('blueprint-composition-canvas__guide');
    expect(Number(line.getAttribute(axis === 'x' ? 'x1' : 'y1'))).toBeCloseTo(guide * (axis === 'x' ? 1000 : 400));
    fireEvent.pointerUp(canvas());
    expect(canvas().querySelector(`[data-guide-${axis}]`)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const [saved, target] = save.mock.calls[0][0].bays;
    precision(saved); precision(target);
    const size = axis === 'x' ? 'width' : 'height';
    if (guide === .5) expect(saved[axis] + saved[size]).toBeCloseTo(target[axis]);
    else expect(saved[axis]).toBeCloseTo(target[axis] + target[size]);
  });
  it.each([
    { end: [55, 100], axis: 'x', value: 0, guide: 0 },
    { end: [845, 100], axis: 'x', value: .8, guide: 1 },
    { end: [250, 24], axis: 'y', value: 0, guide: 0 },
    { end: [250, 336], axis: 'y', value: .8, guide: 1 },
  ])('snaps moving bay to panel edge ($axis=$guide)', ({ end, axis, value, guide }) => {
    const { rectangle, canvas, field } = show({ bays: [moving] });
    fireEvent.pointerDown(rectangle(), { button: 0, clientX: 250, clientY: 100 }); fireEvent.pointerMove(canvas(), { clientX: end[0], clientY: end[1] });
    expect(field(axis)).toHaveValue(value); expect(canvas().querySelector(`[data-guide-${axis}]`)).not.toBeNull();
    fireEvent.pointerCancel(canvas()); expect(canvas().querySelector('[data-guide-x], [data-guide-y]')).toBeNull();
  });
  it.each([500, 1000, 2000])('uses a seven screen-pixel threshold with panel displayed at %s px', pixels => {
    vi.mocked(SVGSVGElement.prototype.getBoundingClientRect).mockReturnValue({ left: 0, top: 0, width: pixels, height: pixels * .4 } as DOMRect);
    const { rectangle, canvas, field } = show({ bays: [moving, neighbour] });
    fireEvent.pointerDown(rectangle(), { button: 0, clientX: pixels * .25, clientY: pixels * .1 });
    fireEvent.pointerMove(canvas(), { clientX: pixels * .35 - 6, clientY: pixels * .1 });
    expect(field('x')).toHaveValue(.3); expect(canvas().querySelector('[data-guide-x]')).not.toBeNull();
    fireEvent.pointerMove(canvas(), { clientX: pixels * .35 - 12, clientY: pixels * .1 });
    expect(canvas().querySelector('[data-guide-x]')).toBeNull();
    fireEvent.pointerUp(canvas());
  });
  it('ignores bay edges on another panel and endpoints, and normalizes an unsnapped drag', () => {
    const { rectangle, canvas, field, save } = show({ panels: [panel, rear], bays: [moving, { ...neighbour, panel_key: 'two' }], slots: [{ key: 'point', display_name: 'Port', panel_key: 'one', kind: 'CONNECTION_POINT', rendered_position: { x: .5, y: .5 } }] });
    fireEvent.pointerDown(rectangle(), { button: 0, clientX: 125, clientY: 50 }); fireEvent.pointerMove(canvas(), { clientX: 169, clientY: 68.5 });
    expect(field('x')).toHaveValue(.29); expect(field('y')).toHaveValue(.29);
    expect(canvas().querySelector('[data-guide-x], [data-guide-y]')).toBeNull(); fireEvent.pointerUp(canvas());
    fireEvent.click(screen.getByRole('button', { name: 'Save' })); precision(save.mock.calls[0][0].bays[0]);
  });
  it.each(['e', 'se'] as const)('snaps %s resize to neighbour edges with live guides and normalized geometry', handle => {
    const { choose, canvas, field, save } = show({ bays: [moving, neighbour] }); choose();
    fireEvent.pointerDown(canvas().querySelector(`[data-bay-resize="${handle}"]`)!, { button: 0, clientX: 400, clientY: 160 });
    fireEvent.pointerMove(canvas(), { clientX: 497, clientY: handle === 'se' ? 199 : 160 });
    expect(field('width')).toHaveValue(.3); expect(canvas().querySelector('[data-guide-x]')).toHaveAttribute('x1', '500');
    if (handle === 'se') { expect(field('height')).toHaveValue(.3); expect(canvas().querySelector('[data-guide-y]')).toHaveAttribute('y1', '200'); }
    fireEvent.pointerUp(canvas()); expect(canvas().querySelector('[data-guide-x], [data-guide-y]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' })); precision(save.mock.calls[0][0].bays[0]);
  });
  it('snaps resize to panel boundary and leaves unchanged axes without guides', () => {
    const { choose, canvas, field } = show({ bays: [moving] }); choose();
    fireEvent.pointerDown(canvas().querySelector('[data-bay-resize="e"]')!, { button: 0, clientX: 400, clientY: 120 });
    fireEvent.pointerMove(canvas(), { clientX: 996, clientY: 120 });
    expect(field('width')).toHaveValue(.8); expect(canvas().querySelector('[data-guide-x]')).toHaveAttribute('x1', '1000');
    expect(canvas().querySelector('[data-guide-y]')).toBeNull(); fireEvent.pointerUp(canvas());
  });
  it('normalizes an unsnapped corner resize in the saved state', () => {
    const { choose, canvas, field, save } = show({ bays: [moving] }); choose();
    fireEvent.pointerDown(canvas().querySelector('[data-bay-resize="se"]')!, { button: 0, clientX: 400, clientY: 160 });
    fireEvent.pointerMove(canvas(), { clientX: 547, clientY: 219 }); fireEvent.pointerUp(canvas());
    expect(field('width')).toHaveValue(.35); expect(field('height')).toHaveValue(.35);
    fireEvent.click(screen.getByRole('button', { name: 'Save' })); precision(save.mock.calls[0][0].bays[0]);
  });
  it('normalizes small and boundary geometry before exposing the editable state', () => {
    const { choose, field, save } = show({ bays: [{ ...bay, x: .9999, y: .9999, width: .0001, height: .0001 }] }); choose();
    expect(field('x')).toHaveValue(.99); expect(field('y')).toHaveValue(.99);
    expect(field('width')).toHaveValue(.01); expect(field('height')).toHaveValue(.01);
    fireEvent.click(screen.getByRole('button', { name: 'Save' })); precision(save.mock.calls[0][0].bays[0]);
  });
  it('rounds actual numeric state and duplicate geometry, including geometry at panel bounds', () => {
    const { choose, field, save } = show(); choose();
    fireEvent.change(field('x'), { target: { value: '0.4905' } }); fireEvent.blur(field('x'));
    expect(field('x')).toHaveValue(.49); expect((field('x') as HTMLInputElement).value).toBe('0.49');
    fireEvent.change(field('y'), { target: { value: '0.347812' } }); fireEvent.blur(field('y'));
    expect(field('y')).toHaveValue(.35);
    fireEvent.change(field('width'), { target: { value: '0.9999' } }); fireEvent.blur(field('width'));
    expect(field('width')).toHaveValue(.51);
    fireEvent.click(screen.getByRole('button', { name: 'Дублировать отсек' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    for (const saved of save.mock.calls[0][0].bays) precision(saved);
  });
});

describe('bay on the existing authoring canvas', () => {
  it('duplicates properties with a fresh key, selects and draws the copy, then drags and saves both bays', () => {
    const original = Object.freeze({ ...bay });
    const { choose, container, field, rectangle, gesture, canvas, save } = show({ bays: [original] }); choose();
    fireEvent.click(screen.getByRole('button', { name: 'Дублировать отсек' }));
    expect(container.querySelectorAll('[data-bay-key]')).toHaveLength(2);
    const copy = container.querySelector('[data-bay-key][data-selected="true"]')!;
    const key = copy.getAttribute('data-bay-key')!;
    expect(key).not.toBe(original.bay_key);
    expect(key).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i);
    expect(rectangle().parentElement).toHaveAttribute('data-selected', 'false');
    expect(field('Название')).toHaveValue(original.display_name);
    expect(field('Совместимость')).toHaveValue(original.compatibility);
    expect(field('Панель')).toHaveValue(original.panel_key);
    expect(field('width')).toHaveValue(original.width); expect(field('height')).toHaveValue(original.height);
    expect(field('x')).toHaveValue(.23); expect(field('y')).toHaveValue(.23);
    expect(rectangle(key)).toHaveAttribute('width', rectangle().getAttribute('width'));
    expect(rectangle(key)).toHaveAttribute('height', rectangle().getAttribute('height'));
    gesture(rectangle(key), [250, 100], [350, 140]);
    expect(field('x')).toHaveValue(.33); expect(field('y')).toHaveValue(.33);
    gesture(canvas().querySelector('[data-bay-resize="se"]')!, [625, 250], [675, 270]);
    expect(field('width')).toHaveValue(.35); expect(field('height')).toHaveValue(.35);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = save.mock.calls[0][0].bays;
    expect(saved).toHaveLength(2); expect(saved[0]).toEqual(original); expect(original).toEqual(bay);
    expect(saved[1]).toEqual(expect.objectContaining({ bay_key: key, display_name: original.display_name, compatibility: original.compatibility, panel_key: original.panel_key }));
    expect(saved[1].x).toBeCloseTo(.33); expect(saved[1].y).toBeCloseTo(.33);
  });
  it.each([
    { x: .7, y: .7, width: .3, height: .3, copyX: .68, copyY: .68 },
    { x: .7, y: .2, width: .3, height: .3, copyX: .68, copyY: .23 },
    { x: .01, y: .01, width: .98, height: .98, copyX: .01, copyY: .01 },
    { x: 0, y: 0, width: 1, height: 1, copyX: 0, copyY: 0 },
  ])('keeps duplicate inside its panel without changing size ($x,$y / $width,$height)', ({ copyX, copyY, ...geometry }) => {
    const original = { ...bay, ...geometry };
    const { choose, field, save } = show({ bays: [original] }); choose();
    fireEvent.click(screen.getByRole('button', { name: 'Дублировать отсек' }));
    expect(field('x')).toHaveValue(copyX); expect(field('y')).toHaveValue(copyY);
    expect(field('width')).toHaveValue(original.width); expect(field('height')).toHaveValue(original.height);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const copy = save.mock.calls[0][0].bays[1];
    expect(copy.x).toBeGreaterThanOrEqual(0); expect(copy.y).toBeGreaterThanOrEqual(0);
    expect(copy.x + copy.width).toBeLessThanOrEqual(1); expect(copy.y + copy.height).toBeLessThanOrEqual(1);
    expect(save.mock.calls[0][0].bays[0]).toEqual(original);
  });
  it('draws panel-local geometry with the owning panel offset and scale', () => {
    const { rectangle } = show({ panels: [{ ...panel, x: -100, y: -40 }, { ...rear, x: 0 }], bays: [{ ...bay, panel_key: 'two' }] });
    expect(rectangle().closest('[data-panel-key]')).toHaveAttribute('data-panel-key', 'two');
    for (const [axis, value] of Object.entries({ x: 600, y: 240, width: 150, height: 60 })) expect(rectangle()).toHaveAttribute(axis, String(value));
  });
  it('adds a small selected bay to the active panel and immediately draws it', () => {
    const { container } = show({ panels: [panel, rear], activePanelKey: 'two', bays: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить отсек' }));
    const area = container.querySelector('[data-bay-key]')!;
    expect(area.closest('[data-panel-key]')).toHaveAttribute('data-panel-key', 'two');
    expect(area).toHaveAttribute('data-selected', 'true');
    expect(area.querySelector('rect')).toHaveAttribute('width', '150');
    expect(screen.getByRole('region', { name: 'Отсеки модулей' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-bay-resize]')).toHaveLength(8);
  });
  it('drags the bay and updates numeric fields from the same geometry', () => {
    const { rectangle, gesture, field } = show();
    gesture(rectangle(), [250, 100], [350, 140]);
    expect(field('x')).toHaveValue(.3); expect(field('y')).toHaveValue(.3);
    expect(Number(rectangle().getAttribute('x'))).toBeCloseTo(300);
    expect(field('width')).toHaveValue(.3); expect(field('height')).toHaveValue(.3);
  });
  it.each([[[2000, 2000], .7, .7], [[-2000, -2000], 0, 0]] as const)('clamps a drag to the owning panel (%s)', (end, x, y) => {
    const { rectangle, gesture, field } = show(); gesture(rectangle(), [250, 100], [...end]);
    expect(field('x')).toHaveValue(x); expect(field('y')).toHaveValue(y);
    expect(field('width')).toHaveValue(.3); expect(field('height')).toHaveValue(.3);
  });
  it('resizes a corner and updates numeric fields', () => {
    const { choose, canvas, gesture, field, rectangle } = show(); choose();
    gesture(canvas().querySelector('[data-bay-resize="se"]')!, [500, 200], [600, 240]);
    expect(field('width')).toHaveValue(.4); expect(field('height')).toHaveValue(.4);
    expect(Number(rectangle().getAttribute('width'))).toBeCloseTo(400);
  });
  it.each(['nw', 'se'] as const)('keeps %s corner resize inside the panel and positive when crossing the opposite edge', handle => {
    const { choose, canvas, gesture, field } = show(); choose();
    const start: [number, number] = handle === 'nw' ? [200, 80] : [500, 200];
    gesture(canvas().querySelector(`[data-bay-resize="${handle}"]`)!, start, handle === 'nw' ? [-2000, -2000] : [2000, 2000]);
    const value = (axis: string) => Number((field(axis) as HTMLInputElement).value);
    expect(value('x')).toBeGreaterThanOrEqual(0); expect(value('y')).toBeGreaterThanOrEqual(0);
    expect(value('x') + value('width')).toBeLessThanOrEqual(1); expect(value('y') + value('height')).toBeLessThanOrEqual(1);
    gesture(canvas().querySelector(`[data-bay-resize="${handle}"]`)!, start, handle === 'nw' ? [2000, 2000] : [-2000, -2000]);
    expect(value('width')).toBeGreaterThan(0); expect(value('height')).toBeGreaterThan(0);
  });
  it('updates canvas immediately from numeric input and saves that geometry', () => {
    const { choose, field, rectangle, save } = show(); choose();
    fireEvent.change(field('x'), { target: { value: '.4' } });
    expect(rectangle()).toHaveAttribute('x', '400');
    fireEvent.change(field('width'), { target: { value: '.9' } }); fireEvent.blur(field('width'));
    expect(field('width')).toHaveValue(.6); expect(rectangle()).toHaveAttribute('width', '600');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ bays: [expect.objectContaining({ x: .4, width: .6 })] }));
  });
  it('keeps endpoint hit targets after bay rectangles and resize handles and allows endpoint selection', () => {
    const { container, choose } = show({ slots: [{ key: 'port', panel_key: 'one', display_name: 'MGMT', kind: 'NETWORK_PORT', rendered_position: { x: .2, y: .2 } }] }); choose();
    const endpoint = container.querySelector('[data-slot-key]')!;
    const area = container.querySelector('[data-bay-key]')!;
    const handle = container.querySelector('[data-bay-resize="nw"]')!;
    expect(area.compareDocumentPosition(endpoint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(handle.compareDocumentPosition(endpoint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(endpoint.querySelector('[data-endpoint-hit-target]')).toHaveAttribute('pointer-events', 'all');
    fireEvent.pointerDown(endpoint, { button: 0, clientX: 200, clientY: 80 }); fireEvent.pointerUp(container.querySelector('.blueprint-composition-canvas')!);
    expect(endpoint).toHaveAttribute('data-selected', 'true');
    expect(screen.queryByRole('region', { name: 'Отсеки модулей' })).not.toBeInTheDocument();
  });
  it('activates another owning panel when its bay is chosen, without moving it on the activation click', () => {
    const { choose, rectangle, field } = show({ panels: [panel, rear], bays: [{ ...bay, panel_key: 'two' }] }); choose();
    expect(screen.getByRole('button', { name: 'Rear' })).toHaveAttribute('aria-pressed', 'true');
    expect(rectangle().parentElement).toHaveAttribute('data-selected', 'true');
    expect(field('x')).toHaveValue(.2);
  });
  it('changes owning panel while preserving normalized geometry, blocks panel deletion, and removes bay explicitly', () => {
    const { choose, field, rectangle, container } = show({ panels: [panel, rear] }); choose();
    expect(screen.getByRole('button', { name: 'Удалить пустую панель' })).toBeDisabled();
    fireEvent.change(field('Панель'), { target: { value: 'two' } });
    expect(screen.getByRole('button', { name: 'Rear' })).toHaveAttribute('aria-pressed', 'true');
    expect(rectangle().closest('[data-panel-key]')).toHaveAttribute('data-panel-key', 'two');
    expect(field('x')).toHaveValue(.2); expect(field('width')).toHaveValue(.3);
    expect(screen.getByRole('button', { name: 'Удалить пустую панель' })).toBeDisabled();
    fireEvent.click(within(screen.getByRole('region', { name: 'Отсеки модулей' })).getByRole('button', { name: 'Удалить' }));
    expect(container.querySelector('[data-bay-key]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Удалить пустую панель' })).toBeEnabled();
  });
  it('reuses contextual labels and controls and existing action classes', () => {
    const { choose } = show(); choose();
    const properties = screen.getByRole('region', { name: 'Отсеки модулей' });
    expect(properties).toHaveClass('blueprint-composer__selected');
    expect(properties.closest('.blueprint-composer__contextual')).not.toBeNull();
    expect(properties.querySelector('fieldset')).toBeNull();
    expect(within(properties).getByRole('button', { name: 'Удалить' })).toHaveClass('text-action');
    expect(within(properties).getByRole('button', { name: 'Дублировать отсек' })).toHaveClass('secondary-action');
    expect(screen.getByRole('button', { name: 'Добавить отсек' })).toHaveClass('secondary-action');
  });
});
