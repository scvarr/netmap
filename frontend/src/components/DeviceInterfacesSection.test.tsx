import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  DeviceDetailsDataSource,
  DeviceDetailsDocument,
} from '../topology/deviceDetailsTypes';
import type { TopologyProjectionNode } from '../topology/types';
import type { DeviceInterfaceWriteDataSource } from '../topology/deviceInterfaceWriteTypes';
import type { L2ForwardingContextWriteDataSource } from '../topology/l2ForwardingContextWriteTypes';
import { DeviceInterfacesSection } from './DeviceInterfacesSection';

const node = (id: string, refs = [{
  ref_type: 'CANONICAL_FACT',
  entity_type: 'PhysicalObject',
  entity_id: id,
}]) => ({
  id: `projection-${id}`,
  kind: 'NETWORK_DEVICE',
  label: id,
  attributes: {},
  source_refs: refs,
}) satisfies TopologyProjectionNode;

const details = (deviceId = 'device-a'): DeviceDetailsDocument => ({
  schema_version: '1.0',
  device: {
    source_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: deviceId },
    label: `PhysicalObject ${deviceId}`,
    label_source: 'TECHNICAL_FALLBACK',
  },
  interfaces: [{
    interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'abcdef12-interface-a' },
    label: 'NetworkInterface abcdef12',
    label_source: 'TECHNICAL_FALLBACK',
    addresses: [{
      address: '192.0.2.10', prefix_length: 24,
      source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'InterfaceAddress', entity_id: 'ipv4-ref' }],
    }, {
      address: '2001:db8::10', prefix_length: 64,
      source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'InterfaceAddress', entity_id: 'ipv6-ref' }],
    }],
    l2_binding_count: 2,
    l3_binding_count: 1,
    direct_physical_bindings: [{
      connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'point-12345678' },
      member_index: 3,
      source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'InterfacePhysicalBinding', entity_id: 'physical-binding-ref' }],
    }],
    realization_down_count: 0,
    realization_up_count: 2,
    source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'interface-source-ref' }],
  }, {
    interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'fedcba98-interface-b' },
    label: 'NetworkInterface fedcba98',
    label_source: 'TECHNICAL_FALLBACK',
    addresses: [],
    l2_binding_count: 0,
    l3_binding_count: 1,
    direct_physical_bindings: [],
    realization_down_count: 2,
    realization_up_count: 0,
    source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterfaceRealization', entity_id: 'realization-ref' }],
  }],
  gaps: [],
  warnings: [],
});

const sourceFor = (result = details()): DeviceDetailsDataSource => ({
  loadDeviceDetails: vi.fn().mockResolvedValue(result),
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('DeviceInterfacesSection', () => {
  it('shows a local loading state without blocking its parent UI', () => {
    const pending: DeviceDetailsDataSource = {
      loadDeviceDetails: vi.fn(() => new Promise<DeviceDetailsDocument>(() => undefined)),
    };
    render(<DeviceInterfacesSection node={node('device-a')} dataSource={pending} />);

    expect(screen.getByText('Загружаем интерфейсы…')).toBeInTheDocument();
  });

  it('renders interfaces, CIDRs, binding counts, physical bindings, and human realization summaries', async () => {
    render(<DeviceInterfacesSection node={node('device-a')} dataSource={sourceFor()} />);

    expect(await screen.findByRole('heading', { name: 'Интерфейс abcdef12' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Интерфейс fedcba98' })).toBeInTheDocument();
    const firstCard = screen.getByRole('heading', { name: 'Интерфейс abcdef12' }).closest('article')!;
    expect(within(firstCard).getByText('192.0.2.10/24', { selector: 'code' })).toBeInTheDocument();
    expect(within(firstCard).getByText('2001:db8::10/64', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByText('IP-адреса не назначены')).toBeInTheDocument();
    expect(screen.getByText('Точка point-12, member 3')).toBeInTheDocument();
    expect(screen.getByText('Реализован через нижележащие интерфейсы: 2.')).toBeInTheDocument();
    expect(screen.getByText('Используется вышележащими интерфейсами: 2.')).toBeInTheDocument();
    expect(screen.queryByText(/физически не подключ/)).not.toBeInTheDocument();
  });

  it('keeps interface, address, and binding refs in collapsed technical details', async () => {
    render(<DeviceInterfacesSection node={node('device-a')} dataSource={sourceFor()} />);
    const heading = await screen.findByRole('heading', { name: 'Интерфейс abcdef12' });
    const card = heading.closest('article')!;
    const technical = within(card).getByText('Технические данные').closest('details')!;
    expect(technical).not.toHaveAttribute('open');

    await userEvent.click(within(technical).getByText('Технические данные'));

    expect(within(technical).getByText('interface-source-ref')).toBeInTheDocument();
    expect(within(technical).getByText('ipv4-ref')).toBeInTheDocument();
    expect(within(technical).getByText('physical-binding-ref')).toBeInTheDocument();
    expect(within(technical).getByText('realization_up_count').parentElement).toHaveTextContent('2');
  });

  it('does not request details without exactly one PhysicalObject source ref', () => {
    const dataSource = sourceFor();
    render(<DeviceInterfacesSection node={node('ambiguous', [
      { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'a' },
      { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'b' },
    ])} dataSource={dataSource} />);

    expect(screen.getByText(/нет однозначной ссылки на PhysicalObject/)).toBeInTheDocument();
    expect(dataSource.loadDeviceDetails).not.toHaveBeenCalled();
  });

  it('shows an error locally and retries without breaking the section', async () => {
    const loadDeviceDetails = vi.fn()
      .mockRejectedValueOnce(new Error('backend unavailable'))
      .mockResolvedValueOnce(details());
    render(<DeviceInterfacesSection node={node('device-a')} dataSource={{ loadDeviceDetails }} />);

    expect(await screen.findByText(/backend unavailable/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByRole('heading', { name: 'Интерфейс abcdef12' })).toBeInTheDocument();
    expect(loadDeviceDetails).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale response after selection moves to another node', async () => {
    const first = deferred<DeviceDetailsDocument>();
    const second = deferred<DeviceDetailsDocument>();
    const dataSource: DeviceDetailsDataSource = {
      loadDeviceDetails: vi.fn((id) => id === 'device-a' ? first.promise : second.promise),
    };
    const { rerender } = render(
      <DeviceInterfacesSection node={node('device-a')} dataSource={dataSource} />,
    );
    rerender(<DeviceInterfacesSection node={node('device-b')} dataSource={dataSource} />);

    await act(async () => second.resolve({
      ...details('device-b'),
      interfaces: [{ ...details().interfaces[0], label: 'WAN-B', label_source: undefined }],
    }));
    expect(await screen.findByRole('heading', { name: 'WAN-B' })).toBeInTheDocument();

    await act(async () => first.resolve({
      ...details('device-a'),
      interfaces: [{ ...details().interfaces[0], label: 'STALE-A', label_source: undefined }],
    }));
    expect(screen.queryByRole('heading', { name: 'STALE-A' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'WAN-B' })).toBeInTheDocument();
  });

  it('renders the authoritative create response without a fake interface', async () => {
    const updated = {
      ...details(),
      interfaces: [
        ...details().interfaces,
        {
          ...details().interfaces[0],
          interface_ref: {
            ref_type: 'CANONICAL_FACT' as const,
            entity_type: 'NetworkInterface',
            entity_id: 'interface-eth1',
          },
          label: 'eth1',
          label_source: undefined,
          addresses: [],
          l2_binding_count: 0,
          l3_binding_count: 0,
          direct_physical_bindings: [],
          realization_down_count: 0,
          realization_up_count: 0,
          source_refs: [],
        },
      ],
    } satisfies DeviceDetailsDocument;
    const createDeviceInterface = vi.fn().mockResolvedValue(updated);
    const writeDataSource: DeviceInterfaceWriteDataSource = { createDeviceInterface };
    const onInterfaceCreated = vi.fn();
    render(
      <DeviceInterfacesSection
        node={node('device-a')}
        dataSource={sourceFor()}
        writeDataSource={writeDataSource}
        onInterfaceCreated={onInterfaceCreated}
      />,
    );

    await screen.findByRole('heading', { name: 'Интерфейс abcdef12' });
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить интерфейс' }));
    await userEvent.type(screen.getByLabelText('Название'), 'eth1');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));

    const eth1 = await screen.findByRole('heading', { name: 'eth1' });
    expect(within(eth1.closest('article')!).getByText('IP-адреса не назначены')).toBeInTheDocument();
    expect(createDeviceInterface).toHaveBeenCalledWith('device-a', { display_name: 'eth1' });
    expect(onInterfaceCreated).toHaveBeenCalledWith('device-a');
  });

  it('creates an untagged L2 context only from two owned interfaces and refreshes authoritative details', async () => {
    const refreshed = {
      ...details(),
      interfaces: details().interfaces.map((item) => ({ ...item, l2_binding_count: item.l2_binding_count + 1 })),
    };
    const loadDeviceDetails = vi.fn().mockResolvedValueOnce(details()).mockResolvedValueOnce(refreshed);
    const createL2ForwardingContext = vi.fn().mockResolvedValue({
      schema_version: '1.0',
      forwarding_context_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'L2ForwardingContext', entity_id: 'context-ref' },
      bindings: details().interfaces.map((item) => ({
        interface_ref: item.interface_ref,
        binding_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'L2Binding', entity_id: `binding-${item.interface_ref.entity_id}` },
        ingress_rule_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'L2IngressRule', entity_id: `ingress-${item.interface_ref.entity_id}` }],
        egress_rule_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'L2EgressRule', entity_id: `egress-${item.interface_ref.entity_id}` },
      })),
    });
    const l2DataSource: L2ForwardingContextWriteDataSource = { createL2ForwardingContext };
    render(<DeviceInterfacesSection node={node('device-a')} dataSource={{ loadDeviceDetails }} l2ForwardingContextWriteDataSource={l2DataSource} />);

    expect(await screen.findByRole('heading', { name: 'L2 forwarding' })).toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'Создать L2 context' });
    expect(create).toBeDisabled();
    await userEvent.click(create);
    expect(createL2ForwardingContext).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('checkbox', { name: /NetworkInterface abcdef12/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /NetworkInterface fedcba98/ }));
    await userEvent.click(create);

    expect(createL2ForwardingContext).toHaveBeenCalledWith({ bindings: [
      { interface_id: 'abcdef12-interface-a', ingress_exact_stacks: [[]], egress_emit_stack: [] },
      { interface_id: 'fedcba98-interface-b', ingress_exact_stacks: [[]], egress_emit_stack: [] },
    ] });
    expect(await screen.findByRole('status')).toHaveTextContent('L2 context создан');
    await act(async () => undefined);
    expect(loadDeviceDetails).toHaveBeenCalledTimes(2);
    expect(await screen.findAllByText('3', { selector: 'strong' })).toHaveLength(1);
    expect(screen.queryByRole('checkbox', { name: /foreign-interface/ })).not.toBeInTheDocument();
  });

  it('does not expose the L2 form with fewer than two owned interfaces', async () => {
    render(<DeviceInterfacesSection
      node={node('device-a')}
      dataSource={sourceFor({ ...details(), interfaces: [details().interfaces[0]] })}
      l2ForwardingContextWriteDataSource={{ createL2ForwardingContext: vi.fn() }}
    />);
    await screen.findByRole('heading', { name: 'Интерфейс abcdef12' });
    expect(screen.queryByRole('heading', { name: 'L2 forwarding' })).not.toBeInTheDocument();
  });

  it('shows a public L2 error without an optimistic success', async () => {
    const createL2ForwardingContext = vi.fn().mockRejectedValue(new Error('VALIDATION_ERROR: rejected'));
    render(<DeviceInterfacesSection
      node={node('device-a')}
      dataSource={sourceFor()}
      l2ForwardingContextWriteDataSource={{ createL2ForwardingContext }}
    />);
    await screen.findByRole('heading', { name: 'L2 forwarding' });
    await userEvent.click(screen.getByRole('checkbox', { name: /NetworkInterface abcdef12/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /NetworkInterface fedcba98/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Создать L2 context' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('VALIDATION_ERROR: rejected');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
