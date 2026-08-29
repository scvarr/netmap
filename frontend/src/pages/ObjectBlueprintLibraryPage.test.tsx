import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ObjectBlueprintLibraryPage } from './ObjectBlueprintLibraryPage';

const blueprintRef = { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'blueprint-1' };
const versionRef = { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'version-1' };

describe('ObjectBlueprintLibraryPage', () => {
  it('renders compact numeric port columns and labelled icon actions', async () => {
    const dataSource = {
      loadObjectBlueprints: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, blueprints: [{ blueprint_ref: blueprintRef, version_ref: versionRef, name: 'Panel', version_number: 3, version_count: 3, body: { kind: 'RECTANGLE' as const, width: 120, height: 40 }, slot_count: 5, internal_link_count: 2 }] }),
      loadObjectBlueprintVersion: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, blueprint_ref: blueprintRef, version_ref: versionRef, name: 'Panel', version_number: 3, body: { kind: 'RECTANGLE' as const, width: 120, height: 40 }, slots: [{ key: 'point-1', display_name: 'P1', kind: 'CONNECTION_POINT' as const, rendered_position: { x: 0, y: 0 } }, { key: 'point-2', display_name: 'P2', kind: 'CONNECTION_POINT' as const, rendered_position: { x: 0, y: 0 } }, { key: 'port-1', display_name: 'N1', kind: 'NETWORK_PORT' as const, rendered_position: { x: 0, y: 0 } }, { key: 'port-2', display_name: 'N2', kind: 'NETWORK_PORT' as const, rendered_position: { x: 0, y: 0 } }, { key: 'port-3', display_name: 'N3', kind: 'NETWORK_PORT' as const, rendered_position: { x: 0, y: 0 } }], internal_links: [] }),
      createObjectBlueprint: vi.fn(), deleteObjectBlueprint: vi.fn(),
    };
    render(<MemoryRouter><ObjectBlueprintLibraryPage dataSource={dataSource} /></MemoryRouter>);
    await waitFor(() => expect(dataSource.loadObjectBlueprintVersion).toHaveBeenCalledWith('blueprint-1', 'version-1'));
    expect(screen.getByRole('columnheader', { name: 'Точки подключения' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Сетевые порты' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Состав портов' })).toBeNull();
    expect(screen.getAllByRole('cell', { name: '2' })).toHaveLength(2);
    expect(screen.getByRole('cell', { name: '3' })).toBeInTheDocument();
    for (const label of ['Создать объект', 'Редактировать', 'Удалить']) {
      const action = screen.getByRole(label === 'Удалить' ? 'button' : 'link', { name: label });
      expect(action).toHaveAttribute('title', label);
    }
  });

  it('uses numeric zero only for a loaded empty version and marks an unavailable detail neutrally', async () => {
    const unavailableBlueprintRef = { ...blueprintRef, entity_id: 'blueprint-2' };
    const unavailableVersionRef = { ...versionRef, entity_id: 'version-2' };
    const dataSource = {
      loadObjectBlueprints: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, blueprints: [
        { blueprint_ref: blueprintRef, version_ref: versionRef, name: 'Empty panel', version_number: 1, version_count: 1, body: { kind: 'RECTANGLE' as const, width: 120, height: 40 }, slot_count: 0, internal_link_count: 0 },
        { blueprint_ref: unavailableBlueprintRef, version_ref: unavailableVersionRef, name: 'Unavailable panel', version_number: 1, version_count: 1, body: { kind: 'RECTANGLE' as const, width: 120, height: 40 }, slot_count: 0, internal_link_count: 0 },
      ] }),
      loadObjectBlueprintVersion: vi.fn().mockImplementation(async (blueprintId: string) => {
        if (blueprintId === 'blueprint-2') throw new Error('detail unavailable');
        return { schema_version: '1.0' as const, blueprint_ref: blueprintRef, version_ref: versionRef, name: 'Empty panel', version_number: 1, body: { kind: 'RECTANGLE' as const, width: 120, height: 40 }, slots: [], internal_links: [] };
      }),
      createObjectBlueprint: vi.fn(), deleteObjectBlueprint: vi.fn(),
    };
    render(<MemoryRouter><ObjectBlueprintLibraryPage dataSource={dataSource} /></MemoryRouter>);
    await waitFor(() => expect(dataSource.loadObjectBlueprintVersion).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Empty panel');
    expect(rows[1].querySelectorAll('.blueprint-library-table__numeric')[1]).toHaveTextContent('0');
    expect(rows[1].querySelectorAll('.blueprint-library-table__numeric')[2]).toHaveTextContent('0');
    expect(rows[2]).toHaveTextContent('Unavailable panel');
    expect(rows[2].querySelectorAll('.blueprint-library-table__numeric')[1]).toHaveTextContent('—');
    expect(rows[2].querySelectorAll('.blueprint-library-table__numeric')[2]).toHaveTextContent('—');
  });
});
