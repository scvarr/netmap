import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Inspector } from './Inspector';

describe('Inspector', () => {
  it('shows a selected projection node and its technical source refs', () => {
    render(<Inspector selection={{
      type: 'node',
      item: {
        id: 'core-a',
        kind: 'NETWORK_DEVICE',
        label: 'CORE-A',
        status: 'CONFIGURED',
        attributes: { role: 'CORE' },
        source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'po-core-a' }],
      },
    }} onClose={() => undefined} />);

    expect(screen.getByRole('heading', { name: 'CORE-A' })).toBeInTheDocument();
    expect(screen.getByText('PhysicalObject')).toBeInTheDocument();
    expect(screen.getByText('po-core-a')).toBeInTheDocument();
  });

  it('closes selection through the inspector control', async () => {
    const onClose = vi.fn();
    render(<Inspector selection={{
      type: 'edge',
      item: {
        id: 'edge-a-core-b', from_node_id: 'edge-a', to_node_id: 'core-b',
        kind: 'LOGICAL_LINK', aggregate: true, source_refs: [], attributes: {},
      },
    }} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Закрыть инспектор' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
