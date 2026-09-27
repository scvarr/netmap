import { describe, expect, it, vi } from 'vitest';
import { addEndpoints, alignSelectionLine, createBlueprintRequest, distributeSelection, hydrateBlueprintEditorState, layoutSelectionRow, layoutSelectionTwoRows, positionSelection, removeEndpoints, snapSelectionTranslation, translateSelection, type BlueprintEditorState } from './editorModel';
import { newBlueprintEditorState } from '../pages/ObjectBlueprintEditor';
import type { ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';

describe('direct Blueprint slots', () => {
  it('adds distinct opaque identities and bounded deterministic positions on each face', () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('a').mockReturnValueOnce('b').mockReturnValueOnce('c') });
    const front = addEndpoints(newBlueprintEditorState(), 'NETWORK_PORT', 2, 'FRONT');
    const both = addEndpoints(front, 'CONNECTION_POINT', 1, 'REAR');
    expect(both.slots.map((slot) => slot.key)).toEqual(['a', 'b', 'c']);
    expect(both.slots.map((slot) => slot.face)).toEqual(['FRONT', 'FRONT', 'REAR']);
    expect(both.slots[0].rendered_position).not.toEqual(both.slots[1].rendered_position);
    expect(both.slots.every((slot) => Object.values(slot.rendered_position).every((value) => value >= 0 && value <= 1))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('preserves identity through exact edit, hydration, link and deletion', () => {
    const document: ObjectBlueprintVersionDocument = {
      schema_version: '1.0', blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: 'bp' },
      version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'v1' },
      version_number: 1, name: 'Panel', body: { kind: 'RECTANGLE', width: 100, height: 40 },
      slots: [
        { key: 'opaque-a', display_name: 'P1', kind: 'CONNECTION_POINT', face: 'FRONT', rendered_position: { x: .2, y: .3 } },
        { key: 'opaque-b', display_name: 'N1', kind: 'NETWORK_PORT', face: 'REAR', rendered_position: { x: .8, y: .7 } },
      ], internal_links: [{ from_slot_key: 'opaque-a', to_slot_key: 'opaque-b' }],
    };
    const state = hydrateBlueprintEditorState(document);
    state.slots[0] = { ...state.slots[0], display_name: 'renamed', face: 'REAR', rendered_position: { x: .6, y: .5 } };
    const request = createBlueprintRequest(state).request!;
    expect(request.slots[0]).toEqual(state.slots[0]);
    expect(request.internal_links).toEqual(document.internal_links);
    const removed = removeEndpoints(state, new Set(['opaque-a']));
    expect(removed.slots.map((slot) => slot.key)).toEqual(['opaque-b']);
    expect(removed.individualLinks).toEqual([]);
  });
});

describe('endpoint selection geometry', () => {
  const base = (): BlueprintEditorState => ({ ...newBlueprintEditorState(), slots: [
    { key: 'a', display_name: 'Alpha', kind: 'NETWORK_PORT' as const, face: 'FRONT' as const, rendered_position: { x: .1, y: .2 } },
    { key: 'b', display_name: 'Beta', kind: 'CONNECTION_POINT' as const, face: 'FRONT' as const, rendered_position: { x: .4, y: .6 } },
    { key: 'c', display_name: 'Gamma', kind: 'NETWORK_PORT' as const, face: 'FRONT' as const, rendered_position: { x: .9, y: .8 } },
    { key: 'rear', display_name: 'Rear', kind: 'NETWORK_PORT' as const, face: 'REAR' as const, rendered_position: { x: .3, y: .3 } },
  ], individualLinks: [{ from_slot_key: 'a', to_slot_key: 'rear' }, { from_slot_key: 'b', to_slot_key: 'c' }] });
  const all = new Set(['a', 'b', 'c']);
  const coordinates = (state: BlueprintEditorState) => state.slots.slice(0, 3).map((slot) => slot.rendered_position);
  const metadata = (state: BlueprintEditorState) => state.slots.map(({ key, display_name, kind, face }) => ({ key, display_name, kind, face }));

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
    const start = addEndpoints(newBlueprintEditorState(), 'NETWORK_PORT', 14, 'FRONT');
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
    const start = addEndpoints(newBlueprintEditorState(), 'NETWORK_PORT', 4, 'REAR');
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
    { key: 'moving-a', display_name: 'A', kind: 'NETWORK_PORT' as const, face: 'FRONT' as const, rendered_position: { x: .15, y: .1 } },
    { key: 'moving-b', display_name: 'B', kind: 'NETWORK_PORT' as const, face: 'FRONT' as const, rendered_position: { x: .25, y: .1 } },
    { key: 'stationary', display_name: 'C', kind: 'NETWORK_PORT' as const, face: 'FRONT' as const, rendered_position: { x: .7, y: .4 } },
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
