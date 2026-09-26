import { describe, expect, it, vi } from 'vitest';
import { addEndpoints, createBlueprintRequest, hydrateBlueprintEditorState, removeEndpoint } from './editorModel';
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
    const removed = removeEndpoint(state, 'opaque-a');
    expect(removed.slots.map((slot) => slot.key)).toEqual(['opaque-b']);
    expect(removed.individualLinks).toEqual([]);
  });
});
