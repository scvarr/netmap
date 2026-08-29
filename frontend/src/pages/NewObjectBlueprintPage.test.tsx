import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NewObjectBlueprintPage } from './NewObjectBlueprintPage';

const ref = (entity_type: 'PortBlock' | 'PortBlockVersion', entity_id: string) => ({ ref_type: 'LIBRARY_RECORD' as const, entity_type, entity_id });
const source = () => ({
  loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, port_blocks: [{ port_block_ref: ref('PortBlock', 'pb-1'), name: 'Patch panel', version_ref: ref('PortBlockVersion', 'v-2'), version_number: 2, port_count: 2, version_count: 2 }] }),
  loadPortBlockVersions: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, versions: [{ port_block_ref: ref('PortBlock', 'pb-1'), version_ref: ref('PortBlockVersion', 'v-1'), version_number: 1, port_count: 2 }, { port_block_ref: ref('PortBlock', 'pb-1'), version_ref: ref('PortBlockVersion', 'v-2'), version_number: 2, port_count: 2 }] }),
  loadPortBlockVersion: vi.fn().mockImplementation(async (_blockId: string, versionId: string) => ({ schema_version: '1.0' as const, port_block_ref: ref('PortBlock', 'pb-1'), name: 'Patch panel', version_ref: ref('PortBlockVersion', versionId), version_number: versionId === 'v-1' ? 1 : 2, ports: [{ local_id: 'p1', display_label: 'A1', kind: 'CONNECTION_POINT' as const, row: 1 as const, column: 1, layout_order: 1 }, { local_id: 'p2', display_label: 'A2', kind: 'NETWORK_PORT' as const, row: 1 as const, column: 2, layout_order: 2 }] })),
  createPortBlock: vi.fn(), createPortBlockVersion: vi.fn(),
});
const blueprintSource = () => ({ loadObjectBlueprints: vi.fn(), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint: vi.fn().mockResolvedValue({}) });

describe('NewObjectBlueprintPage composition', () => {
  it('adds the catalog current version and never exposes historical-version selection', async () => {
    const portBlocks = source();
    render(<MemoryRouter><NewObjectBlueprintPage dataSource={blueprintSource()} portBlockDataSource={portBlocks} /></MemoryRouter>);
    const add = screen.getByRole('button', { name: 'Добавить Port Block' });
    expect(add).toBeDisabled();
    await screen.findByRole('option', { name: 'Patch panel' });
    await userEvent.selectOptions(screen.getByLabelText('Логический Port Block'), 'pb-1');
    expect(screen.queryByLabelText('Точная версия')).toBeNull();
    await userEvent.click(add);
    await waitFor(() => expect(document.querySelectorAll('.blueprint-composition-canvas__block')).toHaveLength(1));
    await userEvent.click(add);
    await waitFor(() => expect(document.querySelectorAll('.blueprint-composition-canvas__block')).toHaveLength(2));
    expect(portBlocks.loadPortBlockVersions).not.toHaveBeenCalled();
    expect(portBlocks.loadPortBlockVersion).toHaveBeenCalledWith('pb-1', 'v-2');
  });

  it('preserves body fields and submits only composition plus explicit links', async () => {
    const dataSource = blueprintSource(); const portBlocks = source();
    render(<MemoryRouter><NewObjectBlueprintPage dataSource={dataSource} portBlockDataSource={portBlocks} /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Название шаблона'), ' Panel ');
    await userEvent.type(screen.getByLabelText('Тип объекта'), ' patch_panel ');
    await userEvent.clear(screen.getByLabelText('Пропорция ширины корпуса')); await userEvent.type(screen.getByLabelText('Пропорция ширины корпуса'), '240');
    await userEvent.clear(screen.getByLabelText('Пропорция высоты корпуса')); await userEvent.type(screen.getByLabelText('Пропорция высоты корпуса'), '40');
    await screen.findByRole('option', { name: 'Patch panel' });
    await userEvent.selectOptions(screen.getByLabelText('Логический Port Block'), 'pb-1');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить Port Block' }));
    await waitFor(() => expect(document.querySelectorAll('.blueprint-composition-canvas__block')).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Добавить связь' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }));
    await waitFor(() => expect(dataSource.createObjectBlueprint).toHaveBeenCalledOnce());
    expect(dataSource.createObjectBlueprint).toHaveBeenCalledWith(expect.objectContaining({ name: 'Panel', default_physical_object_class: 'patch_panel', body: { kind: 'RECTANGLE', width: 240, height: 40, fill_color: '#28565a' }, composition: { instances: [expect.objectContaining({ port_block_version_ref: ref('PortBlockVersion', 'v-2') })] }, internal_links: [expect.any(Object)] }));
    const request = dataSource.createObjectBlueprint.mock.calls[0][0];
    expect(request).not.toHaveProperty('slots'); expect(request).not.toHaveProperty('authoring_recipe');
    expect(screen.queryByText('Группы портов')).not.toBeInTheDocument(); expect(screen.queryByLabelText(/Начало диапазона|Сторона схемы/)).not.toBeInTheDocument();
  });
});
