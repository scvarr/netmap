import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DeviceDetailsDocument } from '../topology/deviceDetailsTypes';
import type { DeviceInterfaceWriteDataSource } from '../topology/deviceInterfaceWriteTypes';
import { CreateDeviceInterface } from './CreateDeviceInterface';

const updated: DeviceDetailsDocument = {
  schema_version: '1.0',
  device: {
    source_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'device-a' },
    label: 'CORE-NEW',
  },
  interfaces: [],
  gaps: [],
  warnings: [],
};

describe('CreateDeviceInterface', () => {
  it('guards blank input, trims the name, and prevents double submit', async () => {
    let resolveRequest!: (value: DeviceDetailsDocument) => void;
    const createDeviceInterface = vi.fn(() => new Promise<DeviceDetailsDocument>((resolve) => {
      resolveRequest = resolve;
    }));
    const onCreated = vi.fn();
    render(
      <CreateDeviceInterface
        physicalObjectId="device-a"
        dataSource={{ createDeviceInterface }}
        onCreated={onCreated}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '+ Добавить интерфейс' }));
    const submit = screen.getByRole('button', { name: 'Создать' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Название'), '  eth1  ');
    await userEvent.click(submit);
    await userEvent.click(submit);

    expect(createDeviceInterface).toHaveBeenCalledTimes(1);
    expect(createDeviceInterface).toHaveBeenCalledWith('device-a', { display_name: 'eth1' });
    resolveRequest(updated);
    expect(await screen.findByRole('button', { name: '+ Добавить интерфейс' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(onCreated).toHaveBeenCalledWith(updated);
  });

  it('keeps the error and input in place and supports retry', async () => {
    const createDeviceInterface = vi.fn()
      .mockRejectedValueOnce(new Error('backend unavailable'))
      .mockResolvedValueOnce(updated);
    const dataSource: DeviceInterfaceWriteDataSource = { createDeviceInterface };
    render(
      <CreateDeviceInterface
        physicalObjectId="device-a"
        dataSource={dataSource}
        onCreated={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '+ Добавить интерфейс' }));
    await userEvent.type(screen.getByLabelText('Название'), 'eth1');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('backend unavailable');
    expect(screen.getByLabelText('Название')).toHaveValue('eth1');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(createDeviceInterface).toHaveBeenCalledTimes(2);
  });
});
