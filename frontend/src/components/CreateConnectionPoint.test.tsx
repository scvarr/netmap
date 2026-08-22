import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import { CreateConnectionPoint } from './CreateConnectionPoint';

const updated: PhysicalObjectDetailsDocument = {
  schema_version: '1.0',
  physical_object: {
    source_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'pp-1' },
    label: 'PP1',
  },
  connection_points: [],
  owned_interface_count: 0,
  gaps: [],
  warnings: [],
};

describe('CreateConnectionPoint', () => {
  it('guards blank input, trims the name, and prevents double submit', async () => {
    let resolveRequest!: (value: PhysicalObjectDetailsDocument) => void;
    const createConnectionPoint = vi.fn(() => new Promise<PhysicalObjectDetailsDocument>((resolve) => {
      resolveRequest = resolve;
    }));
    const onCreated = vi.fn();
    render(
      <CreateConnectionPoint
        physicalObjectId="pp-1"
        dataSource={{ createConnectionPoint }}
        onCreated={onCreated}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '+ Добавить точку' }));
    const submit = screen.getByRole('button', { name: 'Создать' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Название'), '  Port02  ');
    await userEvent.click(submit);
    await userEvent.click(submit);

    expect(createConnectionPoint).toHaveBeenCalledTimes(1);
    expect(createConnectionPoint).toHaveBeenCalledWith('pp-1', { display_name: 'Port02' });
    resolveRequest(updated);
    expect(await screen.findByRole('button', { name: '+ Добавить точку' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(onCreated).toHaveBeenCalledWith(updated);
  });

  it('keeps the error and input in place and supports retry', async () => {
    const createConnectionPoint = vi.fn()
      .mockRejectedValueOnce(new Error('backend unavailable'))
      .mockResolvedValueOnce(updated);
    render(
      <CreateConnectionPoint
        physicalObjectId="pp-1"
        dataSource={{ createConnectionPoint }}
        onCreated={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '+ Добавить точку' }));
    await userEvent.type(screen.getByLabelText('Название'), 'Port02');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('backend unavailable');
    expect(screen.getByLabelText('Название')).toHaveValue('Port02');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(createConnectionPoint).toHaveBeenCalledTimes(2);
  });
});
