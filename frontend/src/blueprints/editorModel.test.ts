import { describe, expect, it, vi } from 'vitest';
import { addBulkInternalLinks, clampPlacement, composedSlotKey, createBlueprintRequest, faceLocalIndex, fallbackPlacement, generateBlueprint, hydrateBlueprintEditorState, removeBlueprintBlockInstance, removeInternalLinksBetweenInstances, type BlueprintBlockInstance } from './editorModel';

const blockRef = { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'PortBlock' as const, entity_id: 'pb-1' };
const versionRef = { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'PortBlockVersion' as const, entity_id: 'v-1' };
const port = (local_id: string) => ({ local_id, display_label: `Port ${local_id}`, kind: 'CONNECTION_POINT' as const, row: 1 as const, column: 1, layout_order: 1 });
const instance = (instanceKey: string, localIds: string[]): BlueprintBlockInstance => ({ instanceKey, portBlockRef: `${instanceKey}-block`, portBlockVersionRef: `${instanceKey}-version`, portBlockName: instanceKey, versionNumber: 1, ports: localIds.map((local_id, index) => ({ ...port(local_id), layout_order: index + 1 })), resolvedSlotKeys: Object.fromEntries(localIds.map((local_id) => [local_id, `${instanceKey}-${local_id}`])) });

describe('Object Blueprint composition editor model', () => {
  it.each([
    ['instance', 'p1', 'pb_04af1feabf6858e0d49366611928d2291c2c7f09ed0b0ca68e7f14aa99bf5ed5'],
    ['ключ', 'порт\0id', 'pb_0a79ce682faacc45597e2cb1bfd8272030671cd6a721b174fe5ed3f45182bdb7'],
    ['x'.repeat(1000), 'y'.repeat(1000), 'pb_21f248ea089fe6486fe89f8f7d62bbf93c9cc74cc252d8d3701cf18c44e68566'],
  ])('uses the normative SHA-256 slot key for %s/%s', async (instanceKey, localId, expected) => {
    expect(await composedSlotKey(instanceKey, localId)).toBe(expected);
    expect((await composedSlotKey(instanceKey, localId)).length).toBe(67);
  });

  it('hydrates the persisted exact version rather than a library latest version and preserves request provenance', async () => {
    const source = { loadPortBlocks: vi.fn(), loadPortBlockVersions: vi.fn(), loadPortBlockVersion: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, port_block_ref: blockRef, version_ref: versionRef, name: 'Panel', version_number: 1, ports: [port('p1')] }), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() };
    const version = { schema_version: '1.0' as const, blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp-1' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'bp-v1' }, version_number: 1, name: 'Composed', body: { kind: 'RECTANGLE' as const, width: 120, height: 40, fill_color: '#123456' }, default_physical_object_class: 'patch_panel', slots: [], internal_links: [], composition: { instances: [{ instance_key: 'stable-instance', port_block_ref: blockRef, port_block_version_ref: versionRef }] } };
    const state = await hydrateBlueprintEditorState(version, source);
    expect(source.loadPortBlockVersion).toHaveBeenCalledWith('pb-1', 'v-1');
    expect(state).toMatchObject({ defaultClass: 'patch_panel', width: 120, height: 40, fillColor: '#123456', instances: [{ instanceKey: 'stable-instance', portBlockRef: 'pb-1', portBlockVersionRef: 'v-1', ports: [port('p1')] }] });
    expect(state?.instances[0].resolvedSlotKeys.p1).toBe(await composedSlotKey('stable-instance', 'p1'));
    expect(createBlueprintRequest(state!).request).toMatchObject({ composition: { instances: [{ instance_key: 'stable-instance', port_block_version_ref: versionRef }] } });
  });

  it('leaves historical snapshot-only versions without a composition editor state', async () => {
    const source = { loadPortBlocks: vi.fn(), loadPortBlockVersions: vi.fn(), loadPortBlockVersion: vi.fn(), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() };
    expect(await hydrateBlueprintEditorState({ schema_version: '1.0', blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'v' }, version_number: 1, name: 'Historical', body: { kind: 'RECTANGLE', width: 1, height: 1 }, slots: [], internal_links: [], composition: null }, source)).toBeNull();
  });

  it('hydrates and saves an authored empty composition as an editable state', async () => {
    const source = { loadPortBlocks: vi.fn(), loadPortBlockVersions: vi.fn(), loadPortBlockVersion: vi.fn(), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() };
    const empty = { schema_version: '1.0' as const, blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v' }, version_number: 2, name: 'Empty composition', body: { kind: 'RECTANGLE' as const, width: 100, height: 40 }, slots: [], internal_links: [], composition: { instances: [] } };
    const state = await hydrateBlueprintEditorState(empty, source);
    expect(state).toMatchObject({ name: 'Empty composition', instances: [], individualLinks: [] });
    expect(createBlueprintRequest(state!).request).toMatchObject({ composition: { instances: [] }, internal_links: [] });
  });

  it('gives a pre-c.5 composition row a deterministic temporary rectangle and persists it on save', async () => {
    const source = { loadPortBlocks: vi.fn(), loadPortBlockVersions: vi.fn(), loadPortBlockVersion: vi.fn().mockResolvedValue({ schema_version: '1.0', port_block_ref: blockRef, version_ref: versionRef, name: 'Panel', version_number: 1, ports: [port('p1')] }), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() };
    const version = { schema_version: '1.0' as const, blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v' }, version_number: 1, name: 'Historical composition', body: { kind: 'RECTANGLE' as const, width: 100, height: 40 }, slots: [], internal_links: [], composition: { instances: [{ instance_key: 'old', port_block_ref: blockRef, port_block_version_ref: versionRef, face: 'FRONT' as const, placement: null }] } };
    const state = await hydrateBlueprintEditorState(version, source);
    expect(state?.instances[0].placement).toEqual(fallbackPlacement(0));
    expect(createBlueprintRequest(state!).request?.composition.instances[0].placement).toEqual(fallbackPlacement(0));
    expect(clampPlacement({ x: .9, y: .9, width: .4, height: .4 })).toEqual({ x: .6, y: .6, width: .4, height: .4 });
  });

  it('assigns historical fallback indexes independently on FRONT and REAR', () => {
    const instances = [{ face: 'FRONT' as const }, { face: 'REAR' as const }, { face: 'FRONT' as const }, { face: 'REAR' as const }];
    expect(instances.map((_, index) => faceLocalIndex(instances, index))).toEqual([0, 0, 1, 1]);
  });

  it('removes only the selected composition instance and every link that references its slots', () => {
    const left = instance('left', ['one', 'two']); const right = instance('right', ['one', 'two']);
    const state = { name: 'Blueprint', defaultClass: '', width: 100, height: 40, fillColor: '#28565a', instances: [left, right], individualLinks: [
      { from_slot_key: 'left-one', to_slot_key: 'right-one' },
      { from_slot_key: 'left-two', to_slot_key: 'right-two' },
      { from_slot_key: 'right-one', to_slot_key: 'right-two' },
    ] };
    const removed = removeBlueprintBlockInstance(state, 'left');
    expect(removed.instances).toEqual([right]);
    expect(removed.individualLinks).toEqual([{ from_slot_key: 'right-one', to_slot_key: 'right-two' }]);
    expect(removeBlueprintBlockInstance(state, 'missing')).toBe(state);
  });

  it('creates sequential bulk links in the exact Port Block layout order', () => {
    const left = instance('left', ['one', 'two', 'three']);
    const right = instance('right', ['one', 'two']);
    left.ports = [left.ports[2], left.ports[0], left.ports[1]];
    expect(addBulkInternalLinks([], left, right, 'SEQUENTIAL')).toEqual([
      { from_slot_key: 'left-one', to_slot_key: 'right-one' },
      { from_slot_key: 'left-two', to_slot_key: 'right-two' },
    ]);
  });

  it('creates reverse bulk links in the exact Port Block layout order', () => {
    const left = instance('left', ['one', 'two', 'three']);
    const right = instance('right', ['one', 'two', 'three']);
    expect(addBulkInternalLinks([], left, right, 'REVERSE')).toEqual([
      { from_slot_key: 'left-one', to_slot_key: 'right-three' },
      { from_slot_key: 'left-two', to_slot_key: 'right-two' },
      { from_slot_key: 'left-three', to_slot_key: 'right-one' },
    ]);
  });

  it('skips exact existing unordered pairs when bulk linking runs again', () => {
    const left = instance('left', ['one', 'two']); const right = instance('right', ['one', 'two']);
    const once = addBulkInternalLinks([{ from_slot_key: 'right-one', to_slot_key: 'left-one' }], left, right, 'SEQUENTIAL');
    expect(once).toEqual([{ from_slot_key: 'right-one', to_slot_key: 'left-one' }, { from_slot_key: 'left-two', to_slot_key: 'right-two' }]);
    expect(addBulkInternalLinks(once, left, right, 'SEQUENTIAL')).toEqual(once);
  });

  it('keeps one-to-many explicit links valid', () => {
    const left = instance('left', ['one']); const middle = instance('middle', ['one']); const right = instance('right', ['one']);
    expect(generateBlueprint({ name: 'One to many', defaultClass: '', width: 1, height: 1, fillColor: '#123456', instances: [left, middle, right], individualLinks: [{ from_slot_key: 'left-one', to_slot_key: 'middle-one' }, { from_slot_key: 'left-one', to_slot_key: 'right-one' }] }).errors).toEqual([]);
  });

  it('removes only links between the selected two instances', () => {
    const left = instance('left', ['one', 'two']); const middle = instance('middle', ['one', 'two']); const right = instance('right', ['one']);
    const links = [{ from_slot_key: 'left-one', to_slot_key: 'middle-one' }, { from_slot_key: 'middle-two', to_slot_key: 'left-two' }, { from_slot_key: 'left-one', to_slot_key: 'right-one' }, { from_slot_key: 'middle-one', to_slot_key: 'right-one' }];
    expect(removeInternalLinksBetweenInstances(links, left, middle)).toEqual([{ from_slot_key: 'left-one', to_slot_key: 'right-one' }, { from_slot_key: 'middle-one', to_slot_key: 'right-one' }]);
  });
});
