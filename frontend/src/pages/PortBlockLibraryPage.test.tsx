import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PortBlockLibraryPage } from './PortBlockLibraryPage';

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
    await userEvent.click(await screen.findByRole('button', { name: 'Создать портовый блок' }));
    expect(await screen.findByRole('heading', { name: 'New port block' })).toBeInTheDocument();
  });
});
