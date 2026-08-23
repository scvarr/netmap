import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DeviceDetailsDocument } from '../topology/deviceDetailsTypes';
import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import type { TopologyProjectionNode } from '../topology/types';
import { ConnectPhysicalEndpoint } from './ConnectPhysicalEndpoint';

const objectRef = (id: string) => ({
  ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: id,
});
const pointRef = (id: string) => ({
  ref_type: 'CANONICAL_FACT' as const, entity_type: 'ConnectionPoint', entity_id: id,
});
const nodes: TopologyProjectionNode[] = [
  { id: 'outlet-node', kind: 'PHYSICAL_OBJECT', label: 'Outlet1', status: 'CONFIGURED', attributes: { connection_point_count: 1, owned_interface_count: 0 }, source_refs: [objectRef('outlet')] },
  { id: 'panel-node', kind: 'PHYSICAL_OBJECT', label: 'PP1', status: 'CONFIGURED', attributes: { connection_point_count: 1, owned_interface_count: 0 }, source_refs: [objectRef('panel')] },
  { id: 'switch-node', kind: 'PHYSICAL_OBJECT', label: 'SW1', status: 'CONFIGURED', attributes: { connection_point_count: 0, owned_interface_count: 2 }, source_refs: [objectRef('switch')] },
];
const sourcePoint = {
  connection_point_ref: pointRef('outlet-port'),
  label: 'Port',
  cardinality: 1,
  incident_connection_count: 0,
  external_connection_count: 0,
  direct_interface_binding_count: 0,
  source_refs: [],
};
const panelDetails: PhysicalObjectDetailsDocument = {
  schema_version: '1.0',
  physical_object: { source_ref: objectRef('panel'), label: 'PP1' },
  connection_points: [{
    connection_point_ref: pointRef('panel-port-01'),
    label: 'Port01',
    cardinality: 1,
    incident_connection_count: 0,
    external_connection_count: 0,
    direct_interface_binding_count: 0,
    source_refs: [],
  }],
  owned_interface_count: 0,
  gaps: [],
  warnings: [],
};
const switchDetails: DeviceDetailsDocument = {
  schema_version: '1.0',
  device: { source_ref: objectRef('switch'), label: 'SW1' },
  interfaces: [{
    interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'eth1-id' },
    label: 'eth1', addresses: [], l2_binding_count: 0, l3_binding_count: 0,
    direct_physical_bindings: [], realization_down_count: 0, realization_up_count: 0,
    source_refs: [],
  }, {
    interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'bound-id' },
    label: 'bound', addresses: [], l2_binding_count: 0, l3_binding_count: 0,
    direct_physical_bindings: [{ connection_point_ref: pointRef('bound-point'), member_index: 1, source_refs: [] }],
    realization_down_count: 0, realization_up_count: 0, source_refs: [],
  }],
  gaps: [], warnings: [],
};

const renderForm = (createPhysicalEndpointConnection = vi.fn().mockResolvedValue({})) => {
  const onConnected = vi.fn();
  render(
    <ConnectPhysicalEndpoint
      sourcePoint={sourcePoint}
      topologyNodes={nodes}
      physicalDetailsDataSource={{
        loadPhysicalObjectDetails: vi.fn().mockResolvedValue(panelDetails),
      }}
      deviceDetailsDataSource={{ loadDeviceDetails: vi.fn().mockResolvedValue(switchDetails) }}
      writeDataSource={{ createPhysicalEndpointConnection }}
      onConnected={onConnected}
    />,
  );
  return { createPhysicalEndpointConnection, onConnected };
};

describe('ConnectPhysicalEndpoint', () => {
  it('filters target objects by endpoint kind, excludes cables, and naturally sorts named before technical labels', async () => {
    const filteredNodes: TopologyProjectionNode[] = [
      ...nodes,
      { id: 'pp2', kind: 'PHYSICAL_OBJECT', label: 'PP2', attributes: { connection_point_count: 1 }, source_refs: [objectRef('pp2')] },
      { id: 'pp10', kind: 'PHYSICAL_OBJECT', label: 'PP10', attributes: { connection_point_count: 1 }, source_refs: [objectRef('pp10')] },
      { id: 'empty', kind: 'PHYSICAL_OBJECT', label: 'Empty', attributes: { connection_point_count: 0, owned_interface_count: 0 }, source_refs: [objectRef('empty')] },
      { id: 'cable', kind: 'PHYSICAL_OBJECT', label: 'Cable', attributes: { class: 'cable', connection_point_count: 2, owned_interface_count: 2 }, source_refs: [objectRef('cable')] },
      { id: 'fallback', kind: 'PHYSICAL_OBJECT', label: 'PhysicalObject 55a7b0f5', attributes: { label_source: 'TECHNICAL_FALLBACK', connection_point_count: 1 }, source_refs: [objectRef('fallback')] },
    ];
    render(<ConnectPhysicalEndpoint sourcePoint={sourcePoint} topologyNodes={filteredNodes} physicalDetailsDataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(panelDetails) }} deviceDetailsDataSource={{ loadDeviceDetails: vi.fn().mockResolvedValue(switchDetails) }} writeDataSource={{ createPhysicalEndpointConnection: vi.fn() }} onConnected={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    expect(screen.getAllByLabelText('Целевой физический объект')[0].querySelectorAll('option')).toHaveLength(6);
    expect(Array.from(screen.getByLabelText('Целевой физический объект').querySelectorAll('option')).map((option) => option.textContent)).toEqual(['Выберите объект', 'Outlet1', 'PP1', 'PP2', 'PP10', 'Объект fallback']);
    await userEvent.selectOptions(screen.getByLabelText('Тип конечной точки'), 'NETWORK_INTERFACE');
    expect(Array.from(screen.getByLabelText('Целевой физический объект').querySelectorAll('option')).map((option) => option.textContent)).toEqual(['Выберите объект', 'SW1']);
  });

  it('naturally sorts free points and interfaces and gives endpoint-specific empty states', async () => {
    const points = { ...panelDetails, connection_points: ['A10', 'A02', 'A01'].map((label) => ({ ...panelDetails.connection_points[0], label, connection_point_ref: pointRef(label) })) };
    const interfaces = { ...switchDetails, interfaces: ['eth10', 'eth2', 'eth1', 'bound'].map((label) => ({ ...switchDetails.interfaces[0], label, interface_ref: { ...switchDetails.interfaces[0].interface_ref, entity_id: label }, direct_physical_bindings: label === 'bound' ? [{ connection_point_ref: pointRef('bound'), member_index: 1, source_refs: [] }] : [] })) };
    render(<ConnectPhysicalEndpoint sourcePoint={sourcePoint} topologyNodes={nodes} physicalDetailsDataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(points) }} deviceDetailsDataSource={{ loadDeviceDetails: vi.fn().mockResolvedValue(interfaces) }} writeDataSource={{ createPhysicalEndpointConnection: vi.fn() }} onConnected={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await userEvent.selectOptions(screen.getByLabelText('Целевой физический объект'), 'panel');
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toContain('A01 · связей: 0');
    expect(Array.from(screen.getByLabelText('Целевая конечная точка').querySelectorAll('option')).slice(1).map((option) => option.textContent)).toEqual(['A01 · связей: 0', 'A02 · связей: 0', 'A10 · связей: 0']);
    await userEvent.selectOptions(screen.getByLabelText('Тип конечной точки'), 'NETWORK_INTERFACE');
    await userEvent.selectOptions(screen.getByLabelText('Целевой физический объект'), 'switch');
    expect(Array.from((await screen.findByLabelText('Целевая конечная точка')).querySelectorAll('option')).slice(1).map((option) => option.textContent)).toEqual(['eth1', 'eth2', 'eth10']);
  });

  it('shows distinct empty object and exhausted endpoint states', async () => {
    const noTargets: TopologyProjectionNode[] = [{ id: 'cable', kind: 'PHYSICAL_OBJECT', label: 'Cable', attributes: { class: 'cable', connection_point_count: 2, owned_interface_count: 2 }, source_refs: [objectRef('cable')] }];
    const exhausted = { ...panelDetails, connection_points: [{ ...panelDetails.connection_points[0], external_connection_count: 1 }] };
    const { rerender } = render(<ConnectPhysicalEndpoint sourcePoint={sourcePoint} topologyNodes={noTargets} physicalDetailsDataSource={{ loadPhysicalObjectDetails: vi.fn() }} deviceDetailsDataSource={{ loadDeviceDetails: vi.fn() }} writeDataSource={{ createPhysicalEndpointConnection: vi.fn() }} onConnected={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    expect(screen.getByText('Нет объектов с точками подключения.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Тип конечной точки'), 'NETWORK_INTERFACE');
    expect(screen.getByText('Нет объектов с сетевыми интерфейсами.')).toBeInTheDocument();
    rerender(<ConnectPhysicalEndpoint sourcePoint={sourcePoint} topologyNodes={nodes} physicalDetailsDataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(exhausted) }} deviceDetailsDataSource={{ loadDeviceDetails: vi.fn().mockResolvedValue(switchDetails) }} writeDataSource={{ createPhysicalEndpointConnection: vi.fn() }} onConnected={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Тип конечной точки'), 'CONNECTION_POINT');
    await userEvent.selectOptions(screen.getByLabelText('Целевой физический объект'), 'panel');
    expect(await screen.findByText('Нет свободных точек подключения.')).toBeInTheDocument();
  });
  it('keeps an internally connected source enabled and an internally connected target selectable', async () => {
    const createPhysicalEndpointConnection = vi.fn().mockResolvedValue({});
    const internallyConnected = { ...sourcePoint, incident_connection_count: 1, external_connection_count: 0 };
    const targetWithInternalLink = {
      ...panelDetails,
      connection_points: [{ ...panelDetails.connection_points[0], incident_connection_count: 1, external_connection_count: 0 }],
    };
    render(
      <ConnectPhysicalEndpoint
        sourcePoint={internallyConnected}
        topologyNodes={nodes}
        physicalDetailsDataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(targetWithInternalLink) }}
        deviceDetailsDataSource={{ loadDeviceDetails: vi.fn().mockResolvedValue(switchDetails) }}
        writeDataSource={{ createPhysicalEndpointConnection }}
        onConnected={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await userEvent.selectOptions(screen.getByLabelText('Целевой физический объект'), 'panel');
    expect(await screen.findByRole('option', { name: 'Port01 · связей: 1' })).toBeInTheDocument();
  });

  it('disables an externally occupied source and filters an externally occupied target', async () => {
    render(
      <ConnectPhysicalEndpoint
        sourcePoint={{ ...sourcePoint, incident_connection_count: 1, external_connection_count: 1 }}
        topologyNodes={nodes}
        physicalDetailsDataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue({
          ...panelDetails,
          connection_points: [{ ...panelDetails.connection_points[0], incident_connection_count: 2, external_connection_count: 1 }],
        }) }}
        deviceDetailsDataSource={{ loadDeviceDetails: vi.fn().mockResolvedValue(switchDetails) }}
        writeDataSource={{ createPhysicalEndpointConnection: vi.fn() }}
        onConnected={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Точка уже подключена' })).toBeDisabled();
  });
  it('keeps an already incident passive point selectable and connects it to another point', async () => {
    const { createPhysicalEndpointConnection, onConnected } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await userEvent.selectOptions(screen.getByLabelText('Целевой физический объект'), 'panel');
    expect(await screen.findByRole('option', { name: 'Port01 · связей: 0' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Целевая конечная точка'), 'panel-port-01');
    await userEvent.type(screen.getByPlaceholderText('Необязательное название'), 'cable-2');
    const form = screen.getByText('Подключить точку кабелем').closest('form')!;
    await userEvent.click(within(form).getByRole('button', { name: 'Подключить' }));

    expect(createPhysicalEndpointConnection).toHaveBeenCalledWith({
      source: { kind: 'CONNECTION_POINT', connection_point_id: 'outlet-port', member_index: 1 },
      target: { kind: 'CONNECTION_POINT', connection_point_id: 'panel-port-01', member_index: 1 },
      cable_display_name: 'cable-2',
    });
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('selects only unbound interfaces of a target network device', async () => {
    const { createPhysicalEndpointConnection } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await userEvent.selectOptions(screen.getByLabelText('Тип конечной точки'), 'NETWORK_INTERFACE');
    expect(screen.queryByRole('option', { name: 'Outlet1' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Целевой физический объект'), 'switch');
    expect(await screen.findByRole('option', { name: 'eth1' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'bound' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Целевая конечная точка'), 'eth1-id');
    const form = screen.getByText('Подключить точку кабелем').closest('form')!;
    await userEvent.click(within(form).getByRole('button', { name: 'Подключить' }));

    expect(createPhysicalEndpointConnection).toHaveBeenCalledWith({
      source: { kind: 'CONNECTION_POINT', connection_point_id: 'outlet-port', member_index: 1 },
      target: { kind: 'NETWORK_INTERFACE', network_interface_id: 'eth1-id' },
    });
  });

  it('preserves an error and guards against double submit while retry is pending', async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise((_, nextReject) => { reject = nextReject; });
    const create = vi.fn().mockReturnValue(pending);
    renderForm(create);
    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await userEvent.selectOptions(screen.getByLabelText('Целевой физический объект'), 'panel');
    await userEvent.selectOptions(await screen.findByLabelText('Целевая конечная точка'), 'panel-port-01');
    const form = screen.getByText('Подключить точку кабелем').closest('form')!;
    await userEvent.click(within(form).getByRole('button', { name: 'Подключить' }));
    expect(screen.getByRole('button', { name: 'Подключаем…' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Подключаем…' }));
    expect(create).toHaveBeenCalledTimes(1);
    reject(new Error('already bound'));
    expect(await screen.findByRole('alert')).toHaveTextContent('already bound');
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled();
  });
});
