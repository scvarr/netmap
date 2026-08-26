import { describe, expect, it, vi } from 'vitest';
import { composedSlotKey, createBlueprintRequest, hydrateBlueprintEditorState } from './editorModel';

const blockRef = { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'PortBlock' as const, entity_id: 'pb-1' };
const versionRef = { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'PortBlockVersion' as const, entity_id: 'v-1' };
const port = (local_id: string) => ({ local_id, display_label: `Port ${local_id}`, kind: 'CONNECTION_POINT' as const, row: 1 as const, column: 1, layout_order: 1 });

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
});
