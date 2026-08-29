import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, localeStorageKey } from '../i18n';
import type { DeviceDetailsDocument } from '../topology/deviceDetailsTypes';
import type { DeviceWriteDataSource } from '../topology/deviceWriteTypes';
import { CreateNetworkDevice } from './CreateNetworkDevice';

const created: DeviceDetailsDocument = {
  schema_version: '1.0',
  device: {
    source_ref: {
      ref_type: 'CANONICAL_FACT',
      entity_type: 'PhysicalObject',
      entity_id: 'device-new',
    },
    label: 'CORE-NEW',
  },
  interfaces: [],
  gaps: [],
  warnings: [],
};

describe('CreateNetworkDevice', () => {
  afterEach(() => localStorage.clear());
  it('guards blank names and submits trimmed names once', async () => {
    let resolveRequest!: (value: DeviceDetailsDocument) => void;
    const createNetworkDevice = vi.fn(() => new Promise<DeviceDetailsDocument>((resolve) => {
      resolveRequest = resolve;
    }));
    const onCreated = vi.fn();
    render(
      <CreateNetworkDevice
        dataSource={{ createNetworkDevice }}
        onCreated={onCreated}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    const submit = screen.getByRole('button', { name: 'Создать' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Название устройства'), '  CORE-NEW  ');
    await userEvent.type(screen.getByLabelText('Первый интерфейс'), '  eth0  ');
    expect(submit).toBeEnabled();

    await userEvent.click(submit);
    await userEvent.click(submit);
    expect(createNetworkDevice).toHaveBeenCalledTimes(1);
    expect(createNetworkDevice).toHaveBeenCalledWith({
      display_name: 'CORE-NEW',
      initial_interface: { display_name: 'eth0' },
    });

    resolveRequest(created);
    expect(await screen.findByRole('button', { name: 'Добавить' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it('keeps a localized operation error in the form without exposing diagnostics', async () => {
    const dataSource: DeviceWriteDataSource = {
      createNetworkDevice: vi.fn().mockRejectedValue(new Error('backend unavailable')),
    };
    render(<CreateNetworkDevice dataSource={dataSource} onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await userEvent.type(screen.getByLabelText('Название устройства'), 'CORE-NEW');
    await userEvent.type(screen.getByLabelText('Первый интерфейс'), 'eth0');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось создать устройство.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('backend unavailable');
    expect(screen.getByLabelText('Название устройства')).toHaveValue('CORE-NEW');
    expect(screen.getByRole('button', { name: 'Создать' })).toBeEnabled();
  });

  it('renders the active form in English', async () => {
    localStorage.setItem(localeStorageKey, 'en');
    render(<I18nProvider><CreateNetworkDevice dataSource={{ createNetworkDevice: vi.fn() }} onCreated={vi.fn()} /></I18nProvider>);

    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('heading', { name: 'Network device' })).toBeInTheDocument();
    expect(screen.getByLabelText('Device name')).toBeInTheDocument();
    expect(screen.queryByText('Сетевое устройство')).not.toBeInTheDocument();
  });
});
