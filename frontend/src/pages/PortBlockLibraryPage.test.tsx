import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortBlockLibraryPage } from './PortBlockLibraryPage';
import { PortBlockDeletionConflictError } from '../topology/apiPortBlockDataSource';
import { I18nProvider, localeStorageKey } from '../i18n';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('PortBlockLibraryPage', () => {
  it('renders Port Block records in a compact table and preserves the new-version route', async () => {
    render(
      <MemoryRouter initialEntries={['/library/port-blocks']}>
        <Routes>
          <Route path="/library/port-blocks" element={<PortBlockLibraryPage dataSource={{ loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0', port_blocks: [{ port_block_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlock', entity_id: 'pb-1' }, name: 'Panel', version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlockVersion', entity_id: 'v-3' }, version_number: 3, port_count: 48, version_count: 5 }] }), loadPortBlockVersions: vi.fn(), loadPortBlockVersion: vi.fn(), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() }} />} />
          <Route path="/library/port-blocks/new" element={<h1>New port block</h1>} />
          <Route path="/library/port-blocks/pb-1/versions/v-3/edit" element={<h1>New version</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    const table = await screen.findByRole('table');
    expect(table).toHaveClass('port-block-library-table');
    expect(document.querySelector('.port-block-grid')).toBeNull();
    expect(document.querySelector('.port-block-card__preview')).toBeNull();
    expect(within(table).getByRole('columnheader', { name: 'Название' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Текущая версия' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Panel' })).toBeInTheDocument();
    expect(within(table).getByText('v3')).toBeInTheDocument();
    expect(within(table).getByText('5')).toBeInTheDocument();
    expect(within(table).getByText('48')).toBeInTheDocument();

    const createButton = screen.getByRole('button', { name: 'Создать группу портов' });
    expect(createButton).toBeVisible();
    expect(createButton).toBeEnabled();

    await userEvent.click(within(table).getByRole('link', { name: 'Новая версия' }));
    expect(await screen.findByRole('heading', { name: 'New version' })).toBeInTheDocument();
  });

  it('keeps the port group visible and explains an Object Blueprint conflict', async () => {
    const deletePortBlock = vi.fn().mockRejectedValue(new PortBlockDeletionConflictError());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryRouter><PortBlockLibraryPage dataSource={{ loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0', port_blocks: [{ port_block_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlock', entity_id: 'pb-1' }, name: 'Panel', version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlockVersion', entity_id: 'v-1' }, version_number: 1, port_count: 1, version_count: 1 }] }), loadPortBlockVersions: vi.fn(), loadPortBlockVersion: vi.fn(), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn(), deletePortBlock }} /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить группу портов' }));
    expect(deletePortBlock).toHaveBeenCalledWith('pb-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Группу портов нельзя удалить: она используется в шаблоне объекта.');
    expect(screen.getByRole('rowheader', { name: 'Panel' })).toBeVisible();
  });

  it('uses the canonical RU and EN Port Block terminology', async () => {
    const dataSource = { loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0', port_blocks: [] }), loadPortBlockVersions: vi.fn(), loadPortBlockVersion: vi.fn(), createPortBlock: vi.fn(), createPortBlockVersion: vi.fn() };
    const { unmount } = render(<I18nProvider><MemoryRouter><PortBlockLibraryPage dataSource={dataSource} /></MemoryRouter></I18nProvider>);
    expect(await screen.findByRole('heading', { name: 'Группы портов' })).toBeInTheDocument();
    expect(screen.queryByText(/Портов(ый|ые) модул/)).toBeNull();
    unmount();

    localStorage.setItem(localeStorageKey, 'en');
    render(<I18nProvider><MemoryRouter><PortBlockLibraryPage dataSource={dataSource} /></MemoryRouter></I18nProvider>);
    expect(await screen.findByRole('heading', { name: 'Port Blocks' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Port Block' })).toBeInTheDocument();
  });
});
