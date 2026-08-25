import { describe, expect, it } from 'vitest';
import { createBlueprintRequest, generateBlueprint, type BlueprintEditorState } from './editorModel';

const base = (groups: BlueprintEditorState['groups']): BlueprintEditorState => ({ name: 'Example', defaultClass: '', width: 120, height: 60, fillColor: '#123456', groups, pairs: [] });
const group = (id: string, keyPrefix: string, kind: 'CONNECTION_POINT' | 'NETWORK_PORT', side: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM', count = 1) => ({ id, keyPrefix, displayPrefix: keyPrefix, kind, side, count, startingNumber: 1, placementOffset: 0, placementSpan: 1 });

describe('Blueprint editor group expansion', () => {
  it('creates a cable as two CP slots plus one explicit link', () => {
    const state = base([group('a', 'A', 'CONNECTION_POINT', 'LEFT'), group('b', 'B', 'CONNECTION_POINT', 'RIGHT')]); state.pairs = [{ leftGroupId: 'a', rightGroupId: 'b' }];
    const generated = generateBlueprint(state);
    expect(generated.errors).toEqual([]); expect(generated.slots).toHaveLength(2); expect(generated.internalLinks).toEqual([{ from_slot_key: 'A01', to_slot_key: 'B01' }]);
    expect(generated.slots.map((slot) => slot.anchor.side)).toEqual(['LEFT', 'RIGHT']);
  });
  it('creates 48 explicit patch-panel slots and 24 explicit matching links', () => {
    const state = base([group('front', 'front', 'CONNECTION_POINT', 'LEFT', 24), group('rear', 'rear', 'CONNECTION_POINT', 'RIGHT', 24)]); state.pairs = [{ leftGroupId: 'front', rightGroupId: 'rear' }];
    const generated = generateBlueprint(state);
    expect(generated.errors).toEqual([]); expect(generated.slots).toHaveLength(48); expect(generated.internalLinks).toHaveLength(24);
    expect(generated.slots.map((slot) => slot.key)).toContain('front01'); expect(generated.internalLinks[23]).toEqual({ from_slot_key: 'front24', to_slot_key: 'rear24' });
    const leftOffsets = generated.slots.filter((slot) => slot.anchor.side === 'LEFT').map((slot) => slot.anchor.offset);
    expect(leftOffsets).toEqual([...leftOffsets].sort((a, b) => a - b)); expect(new Set(leftOffsets).size).toBe(24);
  });
  it('creates switch ports without implicit internal links', () => {
    const generated = generateBlueprint(base([group('eth', 'eth', 'NETWORK_PORT', 'BOTTOM', 24)]));
    expect(generated.errors).toEqual([]); expect(generated.slots).toHaveLength(24); expect(generated.slots.every((slot) => slot.kind === 'NETWORK_PORT')).toBe(true); expect(generated.internalLinks).toEqual([]);
  });
  it('places same-side groups independently and centers a one-port group in its range', () => {
    const first = { ...group('first', 'A', 'CONNECTION_POINT', 'LEFT', 3), placementOffset: .1, placementSpan: .2 };
    const second = { ...group('second', 'B', 'CONNECTION_POINT', 'LEFT', 1), placementOffset: .6, placementSpan: .3 };
    const generated = generateBlueprint(base([first, second]));
    expect(generated.errors).toEqual([]);
    expect(generated.slots.map(slot => slot.key)).toEqual(['A01', 'A02', 'A03', 'B01']);
    expect(generated.slots.map(slot => slot.anchor.offset)).toEqual([.1, .2, expect.closeTo(.3), .75]);
  });
  it('persists placement and rejects ranges outside the normalized side', () => {
    const state = base([{ ...group('a', 'A', 'CONNECTION_POINT', 'LEFT'), placementOffset: .25, placementSpan: .5 }]);
    expect(createBlueprintRequest(state).request?.authoring_recipe?.endpoint_groups[0]).toMatchObject({ placement_offset: .25, placement_span: .5 });
    state.groups[0].placementOffset = .8;
    expect(createBlueprintRequest(state).errors).toContain('Диапазон группы должен находиться в пределах 0–1 и иметь положительную длину.');
  });
  it('blocks unequal pairing and never creates a request with editor groups', () => {
    const state = base([group('front', 'front', 'CONNECTION_POINT', 'LEFT', 24), group('rear', 'rear', 'CONNECTION_POINT', 'RIGHT', 12)]); state.pairs = [{ leftGroupId: 'front', rightGroupId: 'rear' }];
    const result = createBlueprintRequest(state);
    expect(result.request).toBeUndefined(); expect(result.errors).toEqual([expect.stringContaining('одинаковом количестве')]);
  });
});
