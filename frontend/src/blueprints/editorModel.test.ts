import { describe, expect, it, vi } from 'vitest';
import { addEndpoints, addPanel, alignSelectionLine, createBlueprintRequest, deleteActivePanel, distributeSelection, hydrateBlueprintEditorState, layoutSelectionRow, layoutSelectionTwoRows, panelGestureGeometry, positionSelection, positionSelectionAt, removeEndpoints, renameActivePanel, selectionPosition, setPanelRectangle, snapSelectionTranslation, translateSelection, type BlueprintEditorState, type PanelHandle } from './editorModel';
import { newBlueprintEditorState } from '../pages/ObjectBlueprintEditor';
import type { ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';

describe('direct Blueprint slots', () => {
  it('moves only panel origin, preserving identity and local endpoints, and adds from edited geometry', () => {
    const initial = newBlueprintEditorState();
    const withSlot = { ...initial, slots: [{ key: 'a', display_name: '1-1', kind: 'NETWORK_PORT' as const, panel_key: initial.activePanelKey, rendered_position: { x: .2, y: .7 } }] };
    const moved = setPanelRectangle(withSlot, initial.activePanelKey, panelGestureGeometry(initial.panels[0], [], 'move', -30, -45, 7, 40).rectangle);
    expect(moved.panels[0]).toEqual({ ...initial.panels[0], x: -30, y: -45 });
    expect(moved.slots).toEqual(withSlot.slots);
    const resized = setPanelRectangle(moved, initial.activePanelKey, { x: -30, y: -45, width: 240, height: 80 });
    expect(addPanel(resized, 'above').panels[1]).toMatchObject({ x: -30, y: -125, width: 240, height: 80 });
    expect(addPanel(resized, 'right').panels[1]).toMatchObject({ x: 210, y: -45, width: 240, height: 80 });
    const request = createBlueprintRequest({ ...resized, name: 'Device' }).request!;
    expect(request.panels[0]).toMatchObject({ x: -30, y: -45, width: 240, height: 80 });
    expect(request.body).toMatchObject({ width: 240, height: 80 });
    expect(request.slots[0].rendered_position).toEqual({ x: .2, y: .7 });
  });

  it.each([
    ['n', 0, 10, 100, 40], ['ne', 0, 10, 115, 40], ['e', 0, 0, 115, 50],
    ['se', 0, 0, 115, 60], ['s', 0, 0, 100, 60], ['sw', 15, 0, 85, 60],
    ['w', 15, 0, 85, 50], ['nw', 15, 10, 85, 40],
  ] as const)('resizes %s from the corresponding edges', (handle, x, y, width, height) => {
    const panel = { ...newBlueprintEditorState().panels[0], width: 100, height: 50 };
    expect(panelGestureGeometry(panel, [], handle as PanelHandle, 15, 10, 0, 20).rectangle).toEqual({ x, y, width, height });
  });

  it('clamps resize to an authoring minimum without changing loaded small rectangles', () => {
    const panel = { ...newBlueprintEditorState().panels[0], width: 100, height: 50 };
    expect(panelGestureGeometry(panel, [], 'nw', 99, 49, 0, 40).rectangle).toEqual({ x: 60, y: 10, width: 40, height: 40 });
    expect(panelGestureGeometry({ ...panel, width: 10 }, [], 'move', 5, 0, 0, 40).rectangle.width).toBe(10);
    expect(panelGestureGeometry({ ...panel, width: 10 }, [], 'w', 0, 0, 0, 40).rectangle).toEqual({ x: 0, y: 0, width: 10, height: 50 });
  });

  it('snaps move alignment and adjacency and resize moving edges with actual guides', () => {
    const panel = { ...newBlueprintEditorState().panels[0], x: 0, y: 0, width: 100, height: 50 };
    const other = { ...panel, panel_key: 'other', x: 200, y: 100 };
    const aligned = panelGestureGeometry(panel, [other], 'move', 198, 98, 5, 30);
    expect(aligned).toEqual({ rectangle: { x: 200, y: 100, width: 100, height: 50 }, guides: { x: 200, y: 100 } });
    const adjacent = panelGestureGeometry(panel, [other], 'move', 98, 48, 5, 30);
    expect(adjacent).toEqual({ rectangle: { x: 100, y: 50, width: 100, height: 50 }, guides: { x: 200, y: 100 } });
    expect(panelGestureGeometry(panel, [other], 'e', 98, 0, 5, 30)).toEqual({ rectangle: { x: 0, y: 0, width: 200, height: 50 }, guides: { x: 200, y: undefined } });
    expect(panelGestureGeometry(panel, [other], 'move', 20, 0, 5, 30).guides).toEqual({ x: undefined, y: undefined });
  });
  it('places panels in all four directions and derives composition dimensions', () => {
    const initial = newBlueprintEditorState();
    const placements = [
      ['above', 0, -60], ['right', 160, 0], ['below', 0, 60], ['left', -160, 0],
    ] as const;
    for (const [direction, x, y] of placements) {
      const next = addPanel(initial, direction);
      expect(next.panels[1]).toMatchObject({ panel_number: 2, display_name: 'Панель 2', x, y, width: 160, height: 60 });
      expect(next.activePanelKey).toBe(next.panels[1].panel_key);
      expect(next.panels[1].panel_key).not.toBe(initial.panels[0].panel_key);
      expect(createBlueprintRequest({ ...next, name: 'Device' }).request?.body).toMatchObject({ width: direction === 'left' || direction === 'right' ? 320 : 160, height: direction === 'above' || direction === 'below' ? 120 : 60 });
    }
  });

  it('keeps panel numbers monotonic after deletion and scopes endpoint naming', () => {
    const initial = newBlueprintEditorState();
    const second = addPanel(initial, 'right');
    const renamed = renameActivePanel(second, 'Контроллер A');
    expect(renamed.panels[1]).toMatchObject({ panel_key: second.activePanelKey, panel_number: 2, display_name: 'Контроллер A' });
    expect(deleteActivePanel(initial)).toBe(initial);
    const third = addPanel(deleteActivePanel(renamed), 'below');
    expect(third.panels[1].panel_number).toBe(3);
    expect(third.nextPanelNumber).toBe(4);
    expect(createBlueprintRequest({ ...third, name: 'Device' }).request?.panels.map((panel) => panel.panel_number)).toEqual([1, 3]);
    const withThird = addEndpoints(third, 'NETWORK_PORT', 2, third.activePanelKey);
    expect(withThird.slots.map((slot) => slot.display_name)).toEqual(['3-1', '3-2']);
    expect(deleteActivePanel(withThird)).toBe(withThird);
    const firstKey = initial.activePanelKey;
    const withFirst = addEndpoints({ ...withThird, activePanelKey: firstKey }, 'NETWORK_PORT', 1, firstKey);
    expect(withFirst.slots.at(-1)?.display_name).toBe('1-1');
    const clearedThird = removeEndpoints(withFirst, new Set(withThird.slots.map((slot) => slot.key)));
    const nextThird = addEndpoints({ ...clearedThird, activePanelKey: third.activePanelKey }, 'NETWORK_PORT', 1, third.activePanelKey);
    expect(nextThird.slots.at(-1)?.display_name).toBe('3-1');
    expect(nextThird.nextLocalNumberByPanel[firstKey]).toBe(2);
  });
  it('adds distinct opaque identities and bounded deterministic positions on the panel', () => {
    const initial = newBlueprintEditorState();
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('a').mockReturnValueOnce('b').mockReturnValueOnce('c') });
    const front = addEndpoints(initial, 'NETWORK_PORT', 2, initial.panels[0].panel_key);
    const both = addEndpoints(front, 'CONNECTION_POINT', 1, initial.panels[0].panel_key);
    expect(both.slots.map((slot) => slot.key)).toEqual(['a', 'b', 'c']);
    expect(both.slots.map((slot) => slot.display_name)).toEqual(['1-1', '1-2', '1-3']);
    expect(both.slots[0].rendered_position).not.toEqual(both.slots[1].rendered_position);
    expect(both.slots.every((slot) => Object.values(slot.rendered_position).every((value) => value >= 0 && value <= 1))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('preserves identity through exact edit, hydration, link and deletion', () => {
    const document: ObjectBlueprintVersionDocument = {
      schema_version: '2.0', blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: 'bp' },
      version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'v1' },
      version_number: 1, next_panel_number: 2, name: 'Panel', body: { kind: 'RECTANGLE', width: 100, height: 40 }, panels: [{ panel_key: 'panel-1', panel_number: 1, display_name: 'Панель 1', x: 0, y: 0, width: 100, height: 40 }],
      slots: [
        { key: 'opaque-a', display_name: 'P1', kind: 'CONNECTION_POINT', panel_key: 'panel-1', rendered_position: { x: .2, y: .3 } },
        { key: 'opaque-b', display_name: 'N1', kind: 'NETWORK_PORT', panel_key: 'panel-1', rendered_position: { x: .8, y: .7 } },
      ], internal_links: [{ from_slot_key: 'opaque-a', to_slot_key: 'opaque-b' }],
    };
    const state = hydrateBlueprintEditorState(document);
    state.slots[0] = { ...state.slots[0], display_name: 'renamed', panel_key: 'panel-1', rendered_position: { x: .6, y: .5 } };
    const request = createBlueprintRequest(state).request!;
    expect(request.slots[0]).toEqual(state.slots[0]);
    expect(request.internal_links).toEqual(document.internal_links);
    const removed = removeEndpoints(state, new Set(['opaque-a']));
    expect(removed.slots.map((slot) => slot.key)).toEqual(['opaque-b']);
    expect(removed.individualLinks).toEqual([]);
  });
  it('hydrates the lowest numbered panel as active and preserves distinct rectangles', () => {
    const initial = newBlueprintEditorState();
    const first = initial.panels[0];
    const second = { ...first, panel_key: 'second', panel_number: 2, display_name: 'Rear', x: -70, y: -20, width: 70, height: 30 };
    const state = hydrateBlueprintEditorState({
      schema_version: '2.0', blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: 'bp' },
      version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'v' },
      version_number: 2, next_panel_number: 5, name: 'Device', body: { kind: 'RECTANGLE', width: 230, height: 80 },
      panels: [second, first], slots: [{ key: 's', display_name: '2-4', kind: 'NETWORK_PORT', panel_key: 'second', rendered_position: { x: .2, y: .3 } }], internal_links: [],
    });
    expect(state.activePanelKey).toBe(first.panel_key);
    expect(state.nextPanelNumber).toBe(5);
    expect(state.nextLocalNumberByPanel.second).toBe(5);
    expect(createBlueprintRequest(state).request).toMatchObject({ body: { width: 230, height: 80 }, panels: [second, first] });
  });

  it('keeps the sequence and existing names after partial deletion across endpoint kinds', () => {
    const initial = newBlueprintEditorState();
    const key = initial.panels[0].panel_key;
    const three = addEndpoints(initial, 'NETWORK_PORT', 3, key);
    const removed = removeEndpoints(three, new Set([three.slots[1].key]));
    const next = addEndpoints(removed, 'CONNECTION_POINT', 1, key);
    expect(next.slots.map((slot) => slot.display_name)).toEqual(['1-1', '1-3', '1-4']);
    expect(next.slots.slice(0, 2).map((slot) => slot.key)).toEqual([three.slots[0].key, three.slots[2].key]);
  });

  it('restarts default names after the last endpoint is deleted with new slot identity', () => {
    const initial = newBlueprintEditorState();
    const key = initial.panels[0].panel_key;
    const created = addEndpoints(addEndpoints(initial, 'NETWORK_PORT', 2, key), 'CONNECTION_POINT', 1, key);
    const cleared = removeEndpoints(created, new Set(created.slots.map((slot) => slot.key)));
    expect(cleared.slots).toEqual([]);
    const next = addEndpoints(cleared, 'NETWORK_PORT', 2, key);
    expect(next.slots.map((slot) => slot.display_name)).toEqual(['1-1', '1-2']);
    expect(created.slots.every((slot) => !next.slots.some((newSlot) => newSlot.key === slot.key))).toBe(true);
  });
});

describe('endpoint selection geometry', () => {
  const base = (): BlueprintEditorState => ({ ...newBlueprintEditorState(), slots: [
    { key: 'a', display_name: 'Alpha', kind: 'NETWORK_PORT' as const, panel_key: 'panel-1' as const, rendered_position: { x: .1, y: .2 } },
    { key: 'b', display_name: 'Beta', kind: 'CONNECTION_POINT' as const, panel_key: 'panel-1' as const, rendered_position: { x: .4, y: .6 } },
    { key: 'c', display_name: 'Gamma', kind: 'NETWORK_PORT' as const, panel_key: 'panel-1' as const, rendered_position: { x: .9, y: .8 } },
    { key: 'rear', display_name: 'Rear', kind: 'NETWORK_PORT' as const, panel_key: 'panel-1' as const, rendered_position: { x: .3, y: .3 } },
  ], individualLinks: [{ from_slot_key: 'a', to_slot_key: 'rear' }, { from_slot_key: 'b', to_slot_key: 'c' }] });
  const all = new Set(['a', 'b', 'c']);
  const coordinates = (state: BlueprintEditorState) => state.slots.slice(0, 3).map((slot) => slot.rendered_position);
  const metadata = (state: BlueprintEditorState) => state.slots.map(({ key, display_name, kind, panel_key }) => ({ key, display_name, kind, panel_key }));

  it('reports and sets exact local X/Y for a single endpoint', () => {
    const start = { ...base(), activePanelKey: 'panel-1' };
    expect(selectionPosition(start, new Set(['a']))).toEqual({ x: .1, y: .2 });
    const movedX = positionSelectionAt(start, new Set(['a']), 'x', .7254);
    expect(movedX.slots[0].rendered_position).toEqual({ x: .7254, y: .2 });
    const movedY = positionSelectionAt(movedX, new Set(['a']), 'y', .3157);
    expect(movedY.slots[0].rendered_position.x).toBe(.7254);
    expect(movedY.slots[0].rendered_position.y).toBeCloseTo(.3157);
    expect(movedY.slots.slice(1)).toEqual(start.slots.slice(1));
    expect(movedY.individualLinks).toEqual(start.individualLinks);
  });

  it('positions a multi-selection by bbox center without changing spacing or the other axis', () => {
    const start = { ...base(), activePanelKey: 'panel-1' };
    const keys = new Set(['a', 'b']);
    expect(selectionPosition(start, keys)).toEqual({ x: .25, y: .4 });
    const next = positionSelectionAt(start, keys, 'x', .55);
    expect(selectionPosition(next, keys)?.x).toBeCloseTo(.55);
    expect(next.slots[0].rendered_position.x - start.slots[0].rendered_position.x).toBeCloseTo(.3);
    expect(next.slots[1].rendered_position.x - start.slots[1].rendered_position.x).toBeCloseTo(.3);
    expect(next.slots[1].rendered_position.x - next.slots[0].rendered_position.x).toBeCloseTo(.3);
    expect(next.slots.slice(0, 2).map((slot) => slot.rendered_position.y)).toEqual([.2, .6]);
    expect(next.slots.slice(2)).toEqual(start.slots.slice(2));
    const movedY = positionSelectionAt(next, keys, 'y', .6);
    expect(selectionPosition(movedY, keys)?.y).toBeCloseTo(.6);
    expect(movedY.slots.slice(0, 2).map((slot) => slot.rendered_position.x)).toEqual(next.slots.slice(0, 2).map((slot) => slot.rendered_position.x));
    expect(movedY.slots[1].rendered_position.y - movedY.slots[0].rendered_position.y).toBeCloseTo(.4);
  });

  it('clamps the requested center through group translation and reports the actual center', () => {
    const start = { ...base(), activePanelKey: 'panel-1' };
    const keys = new Set(['a', 'b']);
    const right = positionSelectionAt(start, keys, 'x', 1);
    expect(right.slots.slice(0, 2).map((slot) => slot.rendered_position.x)).toEqual([.7, 1]);
    expect(selectionPosition(right, keys)?.x).toBeCloseTo(.85);
    const top = positionSelectionAt(right, keys, 'y', -1);
    expect(top.slots.slice(0, 2).map((slot) => slot.rendered_position.y)).toEqual([0, .39999999999999997]);
    expect(selectionPosition(top, keys)?.y).toBeCloseTo(.2);
    expect(positionSelectionAt(start, keys, 'x', Number.NaN)).toBe(start);
  });

  it('ignores selected keys from other panels', () => {
    const start = { ...base(), activePanelKey: 'panel-1', slots: [...base().slots, { ...base().slots[0], key: 'other', panel_key: 'panel-2' }] };
    const next = positionSelectionAt(start, new Set(['a', 'other']), 'x', .5);
    expect(next.slots[0].rendered_position.x).toBe(.5);
    expect(next.slots.at(-1)).toEqual(start.slots.at(-1));
  });

  it('removes multiple slots and every incident individual link', () => {
    const next = removeEndpoints(base(), new Set(['a', 'c']));
    expect(next.slots.map((slot) => slot.key)).toEqual(['b', 'rear']);
    expect(next.individualLinks).toEqual([]);
  });
  it('moves the whole set by one clamped delta and preserves offsets', () => {
    const start = base();
    const next = translateSelection(start, all, .3, -.4);
    coordinates(next).forEach((point, index) => {
      expect(point.x).toBeCloseTo([.2, .5, 1][index]);
      expect(point.y).toBeCloseTo([0, .4, .6][index]);
    });
    expect(next.slots[3]).toEqual(start.slots[3]);
    expect(next.slots[2].rendered_position.x - next.slots[0].rendered_position.x).toBeCloseTo(.8);
    expect(next.slots[1].rendered_position.y - next.slots[0].rendered_position.y).toBeCloseTo(.4);
  });
  it.each(['horizontal', 'vertical'] as const)('aligns into one %s line without changing the other axis', (line) => {
    const start = base();
    const next = alignSelectionLine(start, all, line);
    const axis = line === 'horizontal' ? 'y' : 'x';
    const other = line === 'horizontal' ? 'x' : 'y';
    expect(new Set(coordinates(next).map((point) => point[axis])).size).toBe(1);
    expect(coordinates(next).map((point) => point[other])).toEqual(coordinates(start).map((point) => point[other]));
    expect(next.slots[3]).toEqual(start.slots[3]);
  });
  it('keeps 14 newly added endpoints distinct when a horizontal row becomes a vertical line', () => {
    const initial = newBlueprintEditorState();
    const start = addEndpoints(initial, 'NETWORK_PORT', 14, initial.panels[0].panel_key);
    const keys = new Set(start.slots.map((slot) => slot.key));
    expect(new Set(start.slots.map((slot) => slot.rendered_position.y)).size).toBe(1);
    const vertical = alignSelectionLine(start, keys, 'vertical');
    expect(new Set(vertical.slots.map((slot) => slot.rendered_position.x)).size).toBe(1);
    expect(new Set(vertical.slots.map((slot) => slot.rendered_position.y)).size).toBe(14);
    expect(Math.min(...vertical.slots.map((slot) => slot.rendered_position.y))).toBeGreaterThanOrEqual(.02);
    expect(vertical.slots.map((slot) => slot.key)).toEqual(start.slots.map((slot) => slot.key));
    const centered = positionSelection(vertical, keys, 'x', 'center');
    expect(new Set(centered.slots.map((slot) => `${slot.rendered_position.x},${slot.rendered_position.y}`)).size).toBe(14);
    const horizontal = alignSelectionLine(vertical, keys, 'horizontal');
    expect(new Set(horizontal.slots.map((slot) => slot.rendered_position.y)).size).toBe(1);
    expect(new Set(horizontal.slots.map((slot) => slot.rendered_position.x)).size).toBe(14);
    expect(horizontal.slots.every((slot) => Object.values(slot.rendered_position).every((value) => value >= 0 && value <= 1))).toBe(true);
  });
  it('recovers a fully stacked selection into either line deterministically', () => {
    const start = base();
    start.slots = start.slots.slice(0, 3).map((slot) => ({ ...slot, rendered_position: { x: .5, y: .5 } }));
    for (const line of ['horizontal', 'vertical'] as const) {
      const result = alignSelectionLine(start, all, line);
      expect(alignSelectionLine(start, all, line).slots).toEqual(result.slots);
      const along = line === 'horizontal' ? 'x' : 'y';
      expect(new Set(result.slots.map((slot) => slot.rendered_position[along])).size).toBe(3);
    }
  });
  it.each([
    ['x', 'start', .02], ['x', 'center', .5], ['x', 'end', .98],
    ['y', 'start', .02], ['y', 'center', .5], ['y', 'end', .98],
  ] as const)('positions group %s %s without collapsing it', (axis, edge, target) => {
    const start = base();
    const next = positionSelection(start, all, axis, edge);
    const values = coordinates(next).map((point) => point[axis]);
    const anchor = edge === 'start' ? Math.min(...values) : edge === 'end' ? Math.max(...values) : (Math.min(...values) + Math.max(...values)) / 2;
    expect(anchor).toBeCloseTo(target);
    expect(values[2] - values[0]).toBeCloseTo(coordinates(start)[2][axis] - coordinates(start)[0][axis]);
    expect(next.slots[3]).toEqual(start.slots[3]);
  });
  it('distributes across an explicit percentage on either axis without changing the other coordinate or endpoint facts', () => {
    const start = base();
    const horizontal = distributeSelection(start, all, 'x', { mode: 'percent', percent: 50 }, .02);
    expect(coordinates(horizontal).map((point) => point.x)).toEqual([.25, .5, .75]);
    expect(coordinates(horizontal).map((point) => point.y)).toEqual(coordinates(start).map((point) => point.y));
    const vertical = distributeSelection(start, all, 'y', { mode: 'percent', percent: 40 }, .02);
    expect(coordinates(vertical).map((point) => point.y)).toEqual([.3, .5, .7]);
    expect(coordinates(vertical).map((point) => point.x)).toEqual(coordinates(start).map((point) => point.x));
    for (const next of [horizontal, vertical]) {
      expect(metadata(next)).toEqual(metadata(start));
      expect(next.individualLinks).toEqual(start.individualLinks);
      expect(next.slots[3]).toEqual(start.slots[3]);
    }
  });
  it('distributes across the full safe body range on either axis', () => {
    const start = base();
    for (const axis of ['x', 'y'] as const) {
      const values = coordinates(distributeSelection(start, all, axis, { mode: 'full' }, .02)).map((point) => point[axis]);
      values.forEach((value, index) => expect(value).toBeCloseTo([.02, .5, .98][index]));
    }
  });
  it('clamps the requested distribution range around a local selection center', () => {
    const start = base();
    start.slots = start.slots.map((slot) => ({ ...slot, rendered_position: { ...slot.rendered_position, x: slot.rendered_position.x * .2 } }));
    const points = coordinates(distributeSelection(start, all, 'x', { mode: 'percent', percent: 50 }, .02));
    expect(points.map((point) => point.x)).toEqual([.02, .27, .52]);
    expect(distributeSelection(start, all, 'x', { mode: 'percent', percent: 0 }, .02)).toBe(start);
  });
  it('spreads endpoints even when all selected centers begin at the same coordinate', () => {
    const start = base();
    start.slots = start.slots.map((slot) => ({ ...slot, rendered_position: { x: .5, y: .5 } }));
    for (const axis of ['x', 'y'] as const) {
      const values = coordinates(distributeSelection(start, all, axis, { mode: 'percent', percent: 30 }, .02)).map((point) => point[axis]);
      values.forEach((value, index) => expect(value).toBeCloseTo([.35, .5, .65][index]));
    }
  });
  it('lays out one or two bounded rows deterministically without changing endpoint facts', () => {
    const start = base();
    for (const operation of [layoutSelectionRow, layoutSelectionTwoRows]) {
      const next = operation(start, all);
      expect(operation(start, all).slots).toEqual(next.slots);
      expect(metadata(next)).toEqual(metadata(start));
      expect(next.individualLinks).toEqual(start.individualLinks);
      expect(next.slots[3]).toEqual(start.slots[3]);
      expect(coordinates(next).every(({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1)).toBe(true);
      expect(Math.max(...coordinates(next).map(({ x }) => x)) - Math.min(...coordinates(next).map(({ x }) => x))).toBeLessThan(.9);
    }
    const row = coordinates(layoutSelectionRow(start, all));
    expect(new Set(row.map((point) => point.y)).size).toBe(1);
    const two = coordinates(layoutSelectionTwoRows(start, all));
    expect(new Set(two.map((point) => point.y)).size).toBe(2);
  });
  it('keeps two rows visibly separate on a 10:1 body', () => {
    const initial = newBlueprintEditorState();
    const start = addEndpoints(initial, 'NETWORK_PORT', 4, initial.panels[0].panel_key);
    const keys = new Set(start.slots.map((slot) => slot.key));
    const metrics = { minGapX: 18 / 850, minGapY: 18 / 85, insetX: 8 / 850, insetY: 8 / 85 };
    const result = layoutSelectionTwoRows(start, keys, metrics);
    const ys = [...new Set(result.slots.map((slot) => slot.rendered_position.y))].sort((a, b) => a - b);
    expect(ys).toHaveLength(2);
    expect((ys[1] - ys[0]) * 85).toBeGreaterThanOrEqual(18 - 1e-9);
    expect(ys[0] * 85).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(result.slots.map((slot) => slot.key)).toEqual(start.slots.map((slot) => slot.key));
    expect(result.slots.map((slot) => slot.display_name)).toEqual(start.slots.map((slot) => slot.display_name));
  });
});

describe('endpoint drag snapping', () => {
  const slots = [
    { key: 'moving-a', display_name: 'A', kind: 'NETWORK_PORT' as const, panel_key: 'panel-1' as const, rendered_position: { x: .15, y: .1 } },
    { key: 'moving-b', display_name: 'B', kind: 'NETWORK_PORT' as const, panel_key: 'panel-1' as const, rendered_position: { x: .25, y: .1 } },
    { key: 'stationary', display_name: 'C', kind: 'NETWORK_PORT' as const, panel_key: 'panel-1' as const, rendered_position: { x: .7, y: .4 } },
  ];
  const moving = new Set(['moving-a', 'moving-b']);
  it('snaps to nearest stationary Y within a screen-derived threshold', () => {
    const result = snapSelectionTranslation(slots, moving, 0, .295, .007, .007);
    expect(result.dy).toBeCloseTo(.3);
    expect(result.guideY).toBe(.4);
    expect(result.guideX).toBeUndefined();
  });
  it('does not snap outside threshold or to moving endpoints', () => {
    const result = snapSelectionTranslation(slots, moving, 0, .27, .007, .007);
    expect(result.dy).toBeCloseTo(.27);
    expect(result.guideY).toBeUndefined();
    expect(snapSelectionTranslation(slots, moving, 0, .003, .007, .007).guideY).toBeUndefined();
  });
  it('snaps X and Y independently to centerlines and preserves group offsets', () => {
    const result = snapSelectionTranslation(slots, moving, .296, .397, .007, .007);
    expect(result).toEqual({ dx: .3, dy: .4, guideX: .5, guideY: .5 });
    const state: BlueprintEditorState = { ...newBlueprintEditorState(), slots, individualLinks: [] };
    const next = translateSelection(state, moving, result.dx, result.dy);
    expect(next.slots[1].rendered_position.x - next.slots[0].rendered_position.x).toBeCloseTo(.1);
    expect(next.slots[0].rendered_position.y).toBeCloseTo(.5);
    expect(next.slots[1].rendered_position.y).toBeCloseTo(.5);
  });
});
