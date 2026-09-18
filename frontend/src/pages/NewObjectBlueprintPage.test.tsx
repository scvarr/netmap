import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}:{JSON.stringify(location.state)}</output>;
};

describe('NewObjectBlueprintPage composition', () => {
  it('waits for the Port Block library before exposing either prerequisite or editor', async () => {
    let resolveLoad!: (value: { schema_version: '1.0'; port_blocks: never[] }) => void;
    const portBlocks = { ...source(), loadPortBlocks: vi.fn().mockImplementation(() => new Promise<{ schema_version: '1.0'; port_blocks: never[] }>((resolve) => { resolveLoad = resolve; })) };
    render(<MemoryRouter><NewObjectBlueprintPage dataSource={blueprintSource()} portBlockDataSource={portBlocks} /></MemoryRouter>);

    expect(screen.queryByRole('heading', { name: 'Сначала создайте группу портов' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сохранить шаблон' })).toBeNull();
    expect(screen.getByRole('status')).toHaveClass('view-state--loading');

    resolveLoad({ schema_version: '1.0', port_blocks: [] });
    expect(await screen.findByRole('heading', { name: 'Сначала создайте группу портов' })).toBeVisible();
  });

  it('shows the first Port Block prerequisite and passes only the bounded return target', async () => {
    const portBlocks = { ...source(), loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, port_blocks: [] }) };
    render(
      <MemoryRouter initialEntries={['/library/object-blueprints/new']}>
        <Routes>
          <Route path="/library/object-blueprints/new" element={<NewObjectBlueprintPage dataSource={blueprintSource()} portBlockDataSource={portBlocks} />} />
          <Route path="/library/port-blocks/new" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Сначала создайте группу портов' })).toBeVisible();
    expect(screen.getByText('Шаблон объекта собирается из групп портов. Создайте первую группу, затем вернитесь к настройке шаблона объекта.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Сохранить шаблон' })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: 'Создать первую группу портов' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/library/port-blocks/new:{"returnTo":"/library/object-blueprints/new"}');
  });

  it('shows a load error instead of treating a rejected library request as empty', async () => {
    const portBlocks = { ...source(), loadPortBlocks: vi.fn().mockRejectedValue(new Error('Port Blocks unavailable')) };
    render(<MemoryRouter><NewObjectBlueprintPage dataSource={blueprintSource()} portBlockDataSource={portBlocks} /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Port Blocks unavailable');
    expect(screen.queryByRole('heading', { name: 'Сначала создайте группу портов' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Создать первую группу портов' })).toBeNull();
  });

  it('adds the catalog current version and never exposes historical-version selection', async () => {
    const portBlocks = source();
    render(<MemoryRouter><NewObjectBlueprintPage dataSource={blueprintSource()} portBlockDataSource={portBlocks} /></MemoryRouter>);
    const add = await screen.findByRole('button', { name: 'Добавить группу портов' });
    expect(add).toBeDisabled();
    await screen.findByRole('option', { name: 'Patch panel' });
    await userEvent.selectOptions(screen.getByLabelText('Группа портов'), 'pb-1');
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
    await screen.findByRole('option', { name: 'Patch panel' });
    await userEvent.type(screen.getByLabelText('Название шаблона'), ' Panel ');
    await userEvent.type(screen.getByLabelText('Тип объекта'), ' patch_panel ');
    await userEvent.clear(screen.getByLabelText('Пропорция ширины корпуса')); await userEvent.type(screen.getByLabelText('Пропорция ширины корпуса'), '240');
    await userEvent.clear(screen.getByLabelText('Пропорция высоты корпуса')); await userEvent.type(screen.getByLabelText('Пропорция высоты корпуса'), '40');
    await userEvent.selectOptions(screen.getByLabelText('Группа портов'), 'pb-1');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить группу портов' }));
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
