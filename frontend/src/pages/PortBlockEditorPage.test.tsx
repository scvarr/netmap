import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PortBlockEditorPage } from './PortBlockEditorPage';

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
};
const source = () => ({
  loadPortBlocks: vi.fn().mockResolvedValue({ schema_version: '1.0', port_blocks: [] }),
  loadPortBlockVersions: vi.fn(),
  loadPortBlockVersion: vi.fn().mockResolvedValue({ schema_version: '1.0', port_block_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlock', entity_id: 'pb-1' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlockVersion', entity_id: 'v-1' }, name: 'Panel', version_number: 1, ports: [{ local_id: 'p1', display_label: 'P1', kind: 'NETWORK_PORT', row: 1, column: 1, layout_order: 1 }] }),
  createPortBlock: vi.fn().mockResolvedValue({}),
  createPortBlockVersion: vi.fn().mockResolvedValue({}),
});

describe('PortBlockEditorPage return navigation', () => {
  const renderEditor = (mode: 'new' | 'version', state?: object) => {
    const dataSource = source();
    const entry = { pathname: mode === 'new' ? '/library/port-blocks/new' : '/library/port-blocks/pb-1/versions/v-1/edit', state };
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/library/port-blocks/new" element={<PortBlockEditorPage dataSource={dataSource} mode="new" />} />
          <Route path="/library/port-blocks/:portBlockId/versions/:versionId/edit" element={<PortBlockEditorPage dataSource={dataSource} mode="version" />} />
          <Route path="/library/port-blocks" element={<LocationProbe />} />
          <Route path="/library/object-blueprints/new" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    return dataSource;
  };

  it('returns to new Object Blueprint after a successful first Port Block create', async () => {
    const dataSource = renderEditor('new', { returnTo: '/library/object-blueprints/new' });
    await userEvent.type(screen.getByLabelText('Название'), 'Panel');
    await userEvent.click(screen.getByRole('button', { name: 'Создать группу портов' }));
    await waitFor(() => expect(dataSource.createPortBlock).toHaveBeenCalledOnce());
    expect(await screen.findByTestId('location')).toHaveTextContent('/library/object-blueprints/new');
  });

  it('keeps ordinary new Port Block creation in the Port Blocks library', async () => {
    const dataSource = renderEditor('new');
    await userEvent.type(screen.getByLabelText('Название'), 'Panel');
    await userEvent.click(screen.getByRole('button', { name: 'Создать группу портов' }));
    await waitFor(() => expect(dataSource.createPortBlock).toHaveBeenCalledOnce());
    expect(await screen.findByTestId('location')).toHaveTextContent('/library/port-blocks');
  });

  it('does not change version creation navigation even with return intent', async () => {
    const dataSource = renderEditor('version', { returnTo: '/library/object-blueprints/new' });
    await screen.findByDisplayValue('Panel');
    await userEvent.click(screen.getByRole('button', { name: 'Создать версию' }));
    await waitFor(() => expect(dataSource.createPortBlockVersion).toHaveBeenCalledOnce());
    expect(await screen.findByTestId('location')).toHaveTextContent('/library/port-blocks');
  });
});
