import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortBlockLibraryPage } from './PortBlockLibraryPage';
import { PortBlockDeletionConflictError } from '../topology/apiPortBlockDataSource';

afterEach(() => vi.restoreAllMocks());

describe('PortBlockLibraryPage', () => {
  it('navigates to port-block creation when the user presses create', async () => {
    render(
      <MemoryRouter initialEntries={['/library/port-blocks']}>
        <Routes>
          <Route path="/library/port-blocks" element={<PortBlockLibraryPage dataSource={{ loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0', port_blocks: [] }), loadPortBlockVersions: vi.fn(), loadPortBlockVersion: vi.fn(), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() }} />} />
          <Route path="/library/port-blocks/new" element={<h1>New port block</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    const createButton = await screen.findByRole('button', { name: 'Создать портовый модуль' });
    expect(createButton).toBeVisible();
    expect(createButton).toBeEnabled();
    expect(screen.getByRole('status').parentElement).toHaveClass('port-block-library__content');

    await userEvent.click(createButton);
    expect(await screen.findByRole('heading', { name: 'New port block' })).toBeInTheDocument();
  });

  it('keeps the Port Module visible and explains an Object Blueprint conflict', async () => {
    const deletePortBlock = vi.fn().mockRejectedValue(new PortBlockDeletionConflictError());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryRouter><PortBlockLibraryPage dataSource={{ loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0', port_blocks: [{ port_block_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlock', entity_id: 'pb-1' }, name: 'Panel', version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlockVersion', entity_id: 'v-1' }, version_number: 1, port_count: 1, version_count: 1 }] }), loadPortBlockVersions: vi.fn(), loadPortBlockVersion: vi.fn(), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn(), deletePortBlock }} /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить портовый модуль' }));
    expect(deletePortBlock).toHaveBeenCalledWith('pb-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Портовый модуль нельзя удалить: он используется в шаблоне объекта.');
    expect(screen.getByRole('heading', { name: 'Panel' })).toBeVisible();
  });
});
