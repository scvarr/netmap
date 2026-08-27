import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { composedSlotKey } from '../blueprints/editorModel';
import { ObjectBlueprintEditor } from './ObjectBlueprintEditor';

const ref = (entity_type: 'PortBlock' | 'PortBlockVersion', entity_id: string) => ({ ref_type: 'LIBRARY_RECORD' as const, entity_type, entity_id });
const p1 = { local_id: 'p1', display_label: 'P1', kind: 'CONNECTION_POINT' as const, row: 1 as const, column: 1, layout_order: 1 };
const p2 = { local_id: 'p2', display_label: 'P2', kind: 'CONNECTION_POINT' as const, row: 1 as const, column: 2, layout_order: 2 };
const p3 = { local_id: 'p3', display_label: 'P3', kind: 'NETWORK_PORT' as const, row: 1 as const, column: 3, layout_order: 3 };

describe('ObjectBlueprintEditor composition version changes', () => {
  it('keeps the instance identity and shared local-id slot while cleaning links to removed ports', async () => {
    const key = 'stable-instance'; const p1Key = await composedSlotKey(key, 'p1'); const p2Key = await composedSlotKey(key, 'p2');
    const source = { loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, port_blocks: [] }), loadPortBlockVersions: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, versions: [{ port_block_ref: ref('PortBlock', 'pb-1'), version_ref: ref('PortBlockVersion', 'v1'), version_number: 1, port_count: 2 }, { port_block_ref: ref('PortBlock', 'pb-1'), version_ref: ref('PortBlockVersion', 'v2'), version_number: 2, port_count: 2 }] }), loadPortBlockVersion: vi.fn().mockImplementation(async (_blockId: string, versionId: string) => ({ schema_version: '1.0' as const, port_block_ref: ref('PortBlock', 'pb-1'), version_ref: ref('PortBlockVersion', versionId), name: 'Panel', version_number: versionId === 'v1' ? 1 : 2, ports: versionId === 'v1' ? [p1, p2] : [p1, p3] })), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() };
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ObjectBlueprintEditor portBlockDataSource={source} title="Editor" description="Description" saveLabel="Save" onSave={onSave} initialState={{ name: 'Blueprint', defaultClass: '', width: 120, height: 60, fillColor: '#28565a', instances: [{ instanceKey: key, portBlockRef: 'pb-1', portBlockVersionRef: 'v1', portBlockName: 'Panel', versionNumber: 1, ports: [p1, p2], resolvedSlotKeys: { p1: p1Key, p2: p2Key } }], individualLinks: [{ from_slot_key: p1Key, to_slot_key: p2Key }] }} />);
    expect(screen.getByTestId('port-block-structure-preview')).toHaveTextContent('P1'); const version = await screen.findByLabelText('Изменить версию');
    await userEvent.selectOptions(version, 'v2');
    await waitFor(() => expect(source.loadPortBlockVersion).toHaveBeenCalledWith('pb-1', 'v2'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0][0];
    expect(saved.instances[0]).toMatchObject({ instanceKey: key, portBlockVersionRef: 'v2', resolvedSlotKeys: { p1: p1Key } });
    expect(saved.instances[0].resolvedSlotKeys.p3).toBe(await composedSlotKey(key, 'p3'));
    expect(saved.individualLinks).toEqual([]);
  });

  it('refuses to add an instance to a full face and reports localized space error', async () => {
    const source = { loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, port_blocks: [{ port_block_ref: ref('PortBlock', 'pb-1'), name: 'Panel', version_ref: ref('PortBlockVersion', 'v1'), version_number: 1, port_count: 1, version_count: 1 }] }), loadPortBlockVersions: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, versions: [{ port_block_ref: ref('PortBlock', 'pb-1'), version_ref: ref('PortBlockVersion', 'v1'), version_number: 1, port_count: 1 }] }), loadPortBlockVersion: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, port_block_ref: ref('PortBlock', 'pb-1'), version_ref: ref('PortBlockVersion', 'v1'), name: 'Panel', version_number: 1, ports: [p1] }), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() };
    render(<ObjectBlueprintEditor portBlockDataSource={source} title="Editor" description="Description" saveLabel="Save" onSave={vi.fn()} initialState={{ name: 'Blueprint', defaultClass: '', width: 120, height: 60, fillColor: '#28565a', instances: [{ instanceKey: 'full', portBlockRef: 'pb-1', portBlockVersionRef: 'v1', face: 'FRONT', placement: { x: 0, y: 0, width: 1, height: 1 }, portBlockName: 'Panel', versionNumber: 1, ports: [p1], resolvedSlotKeys: {} }], individualLinks: [] }} />);
    await userEvent.selectOptions(await screen.findByLabelText('Логический Port Block'), 'pb-1');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить Port Block' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('На выбранной панели нет места');
    expect(document.querySelectorAll('.blueprint-composition-canvas__block')).toHaveLength(1);
  });
});
