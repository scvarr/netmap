import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composedSlotKey } from '../blueprints/editorModel';
import { I18nProvider, localeStorageKey } from '../i18n';
import { ObjectBlueprintEditor } from './ObjectBlueprintEditor';

const ref = (entity_type: 'PortBlock' | 'PortBlockVersion', entity_id: string) => ({ ref_type: 'LIBRARY_RECORD' as const, entity_type, entity_id });
const p1 = { local_id: 'p1', display_label: 'P1', kind: 'CONNECTION_POINT' as const, row: 1 as const, column: 1, layout_order: 1 };
const p2 = { local_id: 'p2', display_label: 'P2', kind: 'CONNECTION_POINT' as const, row: 1 as const, column: 2, layout_order: 2 };

describe('ObjectBlueprintEditor composition', () => {
  afterEach(() => localStorage.clear());
  it('groups existing links between the same two instances into a collapsed summary', () => {
    const left = { instanceKey: 'left', portBlockRef: 'pb-1', portBlockVersionRef: 'v1', portBlockName: 'Panel', versionNumber: 1, ports: [p1, p2], resolvedSlotKeys: { p1: 'left-p1', p2: 'left-p2' } };
    const right = { instanceKey: 'right', portBlockRef: 'pb-1', portBlockVersionRef: 'v1', portBlockName: 'Panel', versionNumber: 1, ports: [p1, p2], resolvedSlotKeys: { p1: 'right-p1', p2: 'right-p2' } };
    const source = { loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, port_blocks: [] }), loadPortBlockVersions: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, versions: [] }), loadPortBlockVersion: vi.fn(), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() };
    render(<ObjectBlueprintEditor portBlockDataSource={source} title="Editor" description="Description" saveLabel="Save" onSave={vi.fn()} initialState={{ name: 'Blueprint', defaultClass: '', width: 120, height: 60, fillColor: '#28565a', instances: [left, right], individualLinks: [{ from_slot_key: 'left-p1', to_slot_key: 'right-p1' }, { from_slot_key: 'left-p2', to_slot_key: 'right-p2' }] }} />);
    const group = document.querySelector('.blueprint-composer__link-group') as HTMLDetailsElement;
    expect(group).not.toBeNull();
    expect(group.open).toBe(false);
    expect(group).toHaveTextContent('связей 2');
  });

  it('removes the selected composition instance and its dangling links before save', async () => {
    const key = 'stable-instance'; const p1Key = await composedSlotKey(key, 'p1'); const p2Key = await composedSlotKey(key, 'p2');
    const retainedKey = 'retained-instance'; const retainedP1Key = await composedSlotKey(retainedKey, 'p1'); const retainedP2Key = await composedSlotKey(retainedKey, 'p2');
    const source = { loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, port_blocks: [] }), loadPortBlockVersions: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, versions: [] }), loadPortBlockVersion: vi.fn(), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() };
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ObjectBlueprintEditor portBlockDataSource={source} title="Editor" description="Description" saveLabel="Save" onSave={onSave} initialState={{ name: 'Blueprint', defaultClass: '', width: 120, height: 60, fillColor: '#28565a', instances: [{ instanceKey: key, portBlockRef: 'pb-1', portBlockVersionRef: 'v1', portBlockName: 'Panel', versionNumber: 1, ports: [p1, p2], resolvedSlotKeys: { p1: p1Key, p2: p2Key } }, { instanceKey: retainedKey, portBlockRef: 'pb-1', portBlockVersionRef: 'v2', portBlockName: 'Panel', versionNumber: 2, ports: [p1, p2], resolvedSlotKeys: { p1: retainedP1Key, p2: retainedP2Key } }], individualLinks: [{ from_slot_key: p1Key, to_slot_key: retainedP1Key }, { from_slot_key: retainedP1Key, to_slot_key: retainedP2Key }] }} />);
    expect(screen.getByTestId('port-block-structure-preview')).toHaveTextContent('P1');
    expect(screen.queryByLabelText('Изменить версию')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Удалить экземпляр группы портов' }));
    expect(screen.queryByTestId('port-block-structure-preview')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0][0];
    expect(saved.instances).toHaveLength(1);
    expect(saved.instances[0]).toMatchObject({ instanceKey: retainedKey, portBlockVersionRef: 'v2' });
    expect(saved.individualLinks).toEqual([{ from_slot_key: retainedP1Key, to_slot_key: retainedP2Key }]);
    expect(screen.queryByLabelText('Изменить версию')).toBeNull();
  });

  it('refuses to add an instance to a full face and reports localized space error', async () => {
    localStorage.setItem(localeStorageKey, 'en');
    const source = { loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, port_blocks: [{ port_block_ref: ref('PortBlock', 'pb-1'), name: 'Panel', version_ref: ref('PortBlockVersion', 'v1'), version_number: 1, port_count: 1, version_count: 1 }] }), loadPortBlockVersions: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, versions: [{ port_block_ref: ref('PortBlock', 'pb-1'), version_ref: ref('PortBlockVersion', 'v1'), version_number: 1, port_count: 1 }] }), loadPortBlockVersion: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, port_block_ref: ref('PortBlock', 'pb-1'), version_ref: ref('PortBlockVersion', 'v1'), name: 'Panel', version_number: 1, ports: [p1] }), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() };
    render(<I18nProvider><ObjectBlueprintEditor portBlockDataSource={source} title="Editor" description="Description" saveLabel="Save" onSave={vi.fn()} initialState={{ name: 'Blueprint', defaultClass: '', width: 120, height: 60, fillColor: '#28565a', instances: [{ instanceKey: 'full', portBlockRef: 'pb-1', portBlockVersionRef: 'v1', face: 'FRONT', placement: { x: 0, y: 0, width: 1, height: 1 }, portBlockName: 'Panel', versionNumber: 1, ports: [p1], resolvedSlotKeys: {} }], individualLinks: [] }} /></I18nProvider>);
    await userEvent.selectOptions(await screen.findByLabelText('Port Block'), 'pb-1');
    await userEvent.click(screen.getByRole('button', { name: 'Add Port Block' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Port Block');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Port Module');
    expect(document.querySelectorAll('.blueprint-composition-canvas__block')).toHaveLength(1);
  });
});
