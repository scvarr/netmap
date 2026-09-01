import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  DeviceDetailsDataSource,
  DeviceDetailsDocument,
  DeviceInterfaceDetails,
} from '../topology/deviceDetailsTypes';
import type {
  PhysicalConnectionCreationDocument,
  PhysicalLinkWriteDataSource,
} from '../topology/physicalLinkWriteTypes';
import { ConnectPhysicalInterface } from './ConnectPhysicalInterface';

const interfaceDetails = (
  id: string,
  label: string,
  bound = false,
): DeviceInterfaceDetails => ({
  interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: id },
  label,
  addresses: [],
  l2_binding_count: 0,
  l3_binding_count: 0,
  direct_physical_bindings: bound ? [{
    connection_point_ref: {
      ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: `${id}-point`,
    },
    member_index: 1,
    source_refs: [],
  }] : [],
  realization_down_count: 0,
  realization_up_count: 0,
  source_refs: [],
});

const targetDocument: DeviceDetailsDocument = {
  schema_version: '1.0',
  device: {
    source_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'fw-device' },
    label: 'FW',
  },
  interfaces: [
    interfaceDetails('fw-eth0', 'eth0'),
    interfaceDetails('fw-bound', 'already-bound', true),
  ],
  gaps: [],
  warnings: [],
};

const creationDocument: PhysicalConnectionCreationDocument = {
  schema_version: '1.0',
  source_interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'core-eth0' },
  target_interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'fw-eth0' },
  cable_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: 'cable' },
  source_binding_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'InterfacePhysicalBinding', entity_id: 'source-binding' },
  target_binding_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'InterfacePhysicalBinding', entity_id: 'target-binding' },
  connection_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Connection', entity_id: 'connection' },
};

describe('ConnectPhysicalInterface', () => {
  it('loads target interfaces through Device Details and submits once without bound targets', async () => {
    let resolveRequest!: (value: PhysicalConnectionCreationDocument) => void;
    const createPhysicalLink = vi.fn(() => new Promise<PhysicalConnectionCreationDocument>((resolve) => {
      resolveRequest = resolve;
    }));
    const detailsDataSource: DeviceDetailsDataSource = {
      loadDeviceDetails: vi.fn().mockResolvedValue(targetDocument),
    };
    const onConnected = vi.fn();
    render(
      <ConnectPhysicalInterface
        sourceInterface={interfaceDetails('core-eth0', 'eth0')}
        targetDevices={[{ physicalObjectId: 'fw-device', label: 'FW' }]}
        detailsDataSource={detailsDataSource}
        writeDataSource={{ createPhysicalLink }}
        onConnected={onConnected}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await userEvent.selectOptions(screen.getByLabelText('Куда: устройство'), 'fw-device');
    expect(await screen.findByRole('option', { name: 'eth0' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'already-bound' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Куда: интерфейс'), 'fw-eth0');
    const submit = screen.getAllByRole('button', { name: 'Подключить' }).at(-1)!;
    await userEvent.click(submit);
    await userEvent.click(submit);

    expect(detailsDataSource.loadDeviceDetails).toHaveBeenCalledWith('fw-device');
    expect(createPhysicalLink).toHaveBeenCalledTimes(1);
    expect(createPhysicalLink).toHaveBeenCalledWith({
      source_interface_id: 'core-eth0',
      target_interface_id: 'fw-eth0',
      cable_label: null,
      cable_label_template_id: null,
      generate_cable_label: false,
      confirmed_historical_label: null,
    });
    resolveRequest(creationDocument);
    expect(await screen.findByRole('button', { name: 'Подключить' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('keeps a backend error in the form and retries the same intent', async () => {
    const createPhysicalLink = vi.fn()
      .mockRejectedValueOnce(new Error('already bound'))
      .mockResolvedValueOnce(creationDocument);
    const writeDataSource: PhysicalLinkWriteDataSource = { createPhysicalLink };
    render(
      <ConnectPhysicalInterface
        sourceInterface={interfaceDetails('core-eth0', 'eth0')}
        targetDevices={[{ physicalObjectId: 'fw-device', label: 'FW' }]}
        detailsDataSource={{ loadDeviceDetails: vi.fn().mockResolvedValue(targetDocument) }}
        writeDataSource={writeDataSource}
        onConnected={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await userEvent.selectOptions(screen.getByLabelText('Куда: устройство'), 'fw-device');
    await screen.findByRole('option', { name: 'eth0' });
    await userEvent.selectOptions(screen.getByLabelText('Куда: интерфейс'), 'fw-eth0');
    await userEvent.click(screen.getAllByRole('button', { name: 'Подключить' }).at(-1)!);

    expect(await screen.findByRole('alert')).toHaveTextContent('already bound');
    expect(screen.getByLabelText('Куда: интерфейс')).toHaveValue('fw-eth0');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(createPhysicalLink).toHaveBeenCalledTimes(2);
  });

  it('shows target loading errors locally and retries the read', async () => {
    const loadDeviceDetails = vi.fn()
      .mockRejectedValueOnce(new Error('details unavailable'))
      .mockResolvedValueOnce(targetDocument);
    render(
      <ConnectPhysicalInterface
        sourceInterface={interfaceDetails('core-eth0', 'eth0')}
        targetDevices={[{ physicalObjectId: 'fw-device', label: 'FW' }]}
        detailsDataSource={{ loadDeviceDetails }}
        writeDataSource={{ createPhysicalLink: vi.fn() }}
        onConnected={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await userEvent.selectOptions(screen.getByLabelText('Куда: устройство'), 'fw-device');
    expect(await screen.findByText(/details unavailable/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));

    expect(await screen.findByRole('option', { name: 'eth0' })).toBeInTheDocument();
    expect(loadDeviceDetails).toHaveBeenCalledTimes(2);
  });

  it('submits an authoritative generated Cable naming intent', async () => {
    const createPhysicalLink = vi.fn().mockResolvedValue(creationDocument);
    render(<ConnectPhysicalInterface sourceInterface={interfaceDetails('core-eth0', 'eth0')} targetDevices={[{ physicalObjectId: 'fw-device', label: 'FW' }]} detailsDataSource={{ loadDeviceDetails: vi.fn().mockResolvedValue(targetDocument) }} writeDataSource={{ createPhysicalLink }} cableLabelDataSource={{ loadCableLabelTemplates: vi.fn().mockResolvedValue({ schema_version: '1.0', templates: [{ id: 'template', name: 'FC', pattern: 'FC####', start_at: 1 }] }) } as any} onConnected={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Подключить' })); await userEvent.selectOptions(screen.getByLabelText('Куда: устройство'), 'fw-device'); await screen.findByRole('option', { name: 'eth0' }); await userEvent.selectOptions(screen.getByLabelText('Куда: интерфейс'), 'fw-eth0'); await userEvent.click(screen.getByRole('radio', { name: 'Сгенерировать по шаблону' })); await userEvent.selectOptions(screen.getByLabelText('Шаблон'), 'template'); await userEvent.click(screen.getAllByRole('button', { name: 'Подключить' }).at(-1)!);
    expect(createPhysicalLink).toHaveBeenCalledWith(expect.objectContaining({ cable_label_template_id: 'template', generate_cable_label: true }));
  });
});
