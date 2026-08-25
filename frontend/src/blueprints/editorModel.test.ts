import { describe, expect, it } from 'vitest';
import { createBlueprintRequest, generateBlueprint, hydrateBlueprintEditorState, type BlueprintEditorState } from './editorModel';

const base = (groups: BlueprintEditorState['groups']): BlueprintEditorState => ({ name: 'Example', defaultClass: '', width: 120, height: 60, fillColor: '#123456', groups, pairs: [], individualLinks: [] });
const group = (id: string, keyPrefix: string, kind: 'CONNECTION_POINT' | 'NETWORK_PORT', side: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM', count = 1) => ({ id, keyPrefix, displayPrefix: keyPrefix, kind, side, count, startingNumber: 1, placementOffset: 0, placementSpan: 1 });

describe('Blueprint editor group expansion', () => {
  it('creates a cable as two CP slots plus one explicit link', () => {
    const state = base([group('a', 'A', 'CONNECTION_POINT', 'LEFT'), group('b', 'B', 'CONNECTION_POINT', 'RIGHT')]); state.pairs = [{ leftGroupId: 'a', rightGroupId: 'b' }];
    const generated = generateBlueprint(state);
    expect(generated.errors).toEqual([]); expect(generated.slots).toHaveLength(2); expect(generated.internalLinks).toEqual([{ from_slot_key: 'A:1', to_slot_key: 'B:1' }]);
    expect(generated.slots.map((slot) => slot.anchor.side)).toEqual(['LEFT', 'RIGHT']);
  });
  it('creates 48 explicit patch-panel slots and 24 explicit matching links', () => {
    const state = base([group('front', 'front', 'CONNECTION_POINT', 'LEFT', 24), group('rear', 'rear', 'CONNECTION_POINT', 'RIGHT', 24)]); state.pairs = [{ leftGroupId: 'front', rightGroupId: 'rear' }];
    const generated = generateBlueprint(state);
    expect(generated.errors).toEqual([]); expect(generated.slots).toHaveLength(48); expect(generated.internalLinks).toHaveLength(24);
    expect(generated.slots.map((slot) => slot.key)).toContain('front:1'); expect(generated.internalLinks[23]).toEqual({ from_slot_key: 'front:24', to_slot_key: 'rear:24' });
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
    expect(generated.slots.map(slot => slot.key)).toEqual(['A:1', 'A:2', 'A:3', 'B:1']);
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
  it('keeps canonical keys through presentation and kind edits, then appends or removes only trailing ordinals', () => {
    const original = group('stable-group', 'opaque-group', 'CONNECTION_POINT', 'LEFT', 2);
    const before = generateBlueprint(base([original])).slots.map(slot => slot.key);
    const changed = { ...original, displayPrefix: 'Порт', startingNumber: 20, kind: 'NETWORK_PORT' as const, side: 'RIGHT' as const, placementOffset: .25, placementSpan: .5, count: 3 };
    const after = generateBlueprint(base([changed])).slots.map(slot => slot.key);
    expect(after).toEqual([...before, 'opaque-group:3']);
    expect(generateBlueprint(base([changed])).slots.map(slot => slot.display_name)).toEqual(['Порт20', 'Порт21', 'Порт22']);
    expect(generateBlueprint(base([{ ...changed, count: 1 }])).slots.map(slot => slot.key)).toEqual(['opaque-group:1']);
  });
  it('does not re-key groups when authoring order changes', () => {
    const left = group('left', 'left-stable', 'CONNECTION_POINT', 'LEFT', 2);
    const right = group('right', 'right-stable', 'CONNECTION_POINT', 'RIGHT', 1);
    const keys = (groups: BlueprintEditorState['groups']) => generateBlueprint(base(groups)).slots.map(slot => slot.key).sort();
    expect(keys([left, right])).toEqual(keys([right, left]));
  });
  it('uses the same stable keys in generated pair links', () => {
    const state = base([group('left', 'left-stable', 'CONNECTION_POINT', 'LEFT', 2), group('right', 'right-stable', 'CONNECTION_POINT', 'RIGHT', 2)]);
    state.pairs = [{ leftGroupId: 'left', rightGroupId: 'right' }];
    expect(generateBlueprint(state).internalLinks).toEqual([
      { from_slot_key: 'left-stable:1', to_slot_key: 'right-stable:1' },
      { from_slot_key: 'left-stable:2', to_slot_key: 'right-stable:2' },
    ]);
  });
  it('hydrates persisted stable group identity without rebuilding it', () => {
    const state = hydrateBlueprintEditorState({
      schema_version: '1.0', blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: 'blueprint' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'version' }, version_number: 1, name: 'Example', body: { kind: 'RECTANGLE', width: 120, height: 60 }, slots: [], internal_links: [],
      authoring_recipe: { endpoint_groups: [{ group_id: 'persisted-id', key_prefix: 'persisted-stable-key', display_prefix: 'A', kind: 'CONNECTION_POINT', side: 'LEFT', count: 1, starting_number: 1, placement_offset: 0, placement_span: 1 }], pair_recipes: [], individual_links: [{ from_slot_key: 'persisted-stable-key:1', to_slot_key: 'other:1' }] },
    });
    expect(state?.groups[0]).toMatchObject({ id: 'persisted-id', keyPrefix: 'persisted-stable-key' });
    expect(state?.individualLinks).toEqual([{ from_slot_key: 'persisted-stable-key:1', to_slot_key: 'other:1' }]);
  });
  it('unions arbitrary cross-group and same-group individual links, including unequal group sizes', () => {
    const state = base([group('left', 'left', 'CONNECTION_POINT', 'LEFT', 3), group('right', 'right', 'CONNECTION_POINT', 'RIGHT', 1)]);
    state.individualLinks = [{ from_slot_key: 'left:3', to_slot_key: 'right:1' }, { from_slot_key: 'left:1', to_slot_key: 'left:2' }];
    expect(generateBlueprint(state)).toMatchObject({ errors: [], internalLinks: state.individualLinks });
  });
  it('preserves individual links through hydration, request creation, and presentation edits', () => {
    const state = base([group('left', 'left', 'CONNECTION_POINT', 'LEFT', 2), group('right', 'right', 'CONNECTION_POINT', 'RIGHT', 1)]);
    state.individualLinks = [{ from_slot_key: 'left:2', to_slot_key: 'right:1' }];
    state.groups[0] = { ...state.groups[0], displayPrefix: 'Порт', startingNumber: 20, side: 'BOTTOM', placementOffset: .25, placementSpan: .5 };
    expect(createBlueprintRequest(state).request?.authoring_recipe?.individual_links).toEqual(state.individualLinks);
    expect(generateBlueprint(state).internalLinks).toEqual(state.individualLinks);
  });
  it('blocks a disappearing individual slot and rejects self, unknown, duplicate, and pair-duplicate links', () => {
    const state = base([group('left', 'left', 'CONNECTION_POINT', 'LEFT', 2), group('right', 'right', 'CONNECTION_POINT', 'RIGHT', 2)]);
    state.individualLinks = [{ from_slot_key: 'left:2', to_slot_key: 'right:2' }];
    state.groups[0].count = 1;
    expect(createBlueprintRequest(state).errors).toContain('Индивидуальная внутренняя связь ссылается на отсутствующий порт.');
    state.groups[0].count = 2;
    state.individualLinks = [{ from_slot_key: 'left:1', to_slot_key: 'left:1' }];
    expect(generateBlueprint(state).errors).toContain('Индивидуальная внутренняя связь не может соединять порт с самим собой.');
    state.individualLinks = [{ from_slot_key: 'left:1', to_slot_key: 'missing:1' }];
    expect(generateBlueprint(state).errors).toContain('Индивидуальная внутренняя связь ссылается на отсутствующий порт.');
    state.individualLinks = [{ from_slot_key: 'left:1', to_slot_key: 'right:1' }, { from_slot_key: 'right:1', to_slot_key: 'left:1' }];
    expect(generateBlueprint(state).errors).toContain('Повторяется индивидуальная внутренняя связь.');
    state.individualLinks = [{ from_slot_key: 'left:1', to_slot_key: 'right:1' }]; state.pairs = [{ leftGroupId: 'left', rightGroupId: 'right' }];
    expect(generateBlueprint(state).errors).toContain('Индивидуальная связь повторяет правило пар по номеру.');
  });
});
