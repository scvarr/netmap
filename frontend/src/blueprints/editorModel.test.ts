import { describe, expect, it, vi } from 'vitest';
import { addEndpoints, alignSelection, createBlueprintRequest, distributeSelection, hydrateBlueprintEditorState, layoutSelectionRow, layoutSelectionTwoRows, removeEndpoints, translateSelection, type BlueprintEditorState } from './editorModel';
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
  it.each([
    ['x', 'min', .1], ['x', 'center', .5], ['x', 'max', .9],
    ['y', 'min', .2], ['y', 'center', .5], ['y', 'max', .8],
  ] as const)('aligns %s at %s', (axis, mode, expected) => {
    const next = alignSelection(base(), all, axis, mode);
    expect(coordinates(next).map((point) => point[axis])).toEqual([expected, expected, expected]);
    expect(next.slots[3]).toEqual(base().slots[3]);
  });
  it('distributes by current coordinate order on each axis', () => {
    expect(coordinates(distributeSelection(base(), all, 'x')).map((point) => point.x)).toEqual([.1, .5, .9]);
    expect(coordinates(distributeSelection(base(), all, 'y')).map((point) => point.y)).toEqual([.2, .5, .8]);
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
});
