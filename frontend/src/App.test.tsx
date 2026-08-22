import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type {
  TopologyDataSource,
  TopologyProjectionDocument,
  TopologySelection,
} from './topology/types';
import type {
  DeviceDetailsDataSource,
  DeviceDetailsDocument,
  DeviceInterfaceDetails,
} from './topology/deviceDetailsTypes';
import type { DeviceWriteDataSource } from './topology/deviceWriteTypes';
import type { DeviceInterfaceWriteDataSource } from './topology/deviceInterfaceWriteTypes';
import type {
  PhysicalConnectionCreationDocument,
  PhysicalLinkWriteDataSource,
} from './topology/physicalLinkWriteTypes';
import type {
  PhysicalObjectDetailsDataSource,
  PhysicalObjectDetailsDocument,
} from './topology/physicalObjectDetailsTypes';
import type { PhysicalObjectWriteDataSource } from './topology/physicalObjectWriteTypes';

vi.mock('./components/HealthIndicator', () => ({
  HealthIndicator: () => <div>Backend доступен</div>,
}));

vi.mock('./components/TopologyCanvas', () => ({
  TopologyCanvas: ({ document, onSelectionChange }: {
    document: TopologyProjectionDocument;
    onSelectionChange: (selection: TopologySelection) => void;
  }) => (
    <div aria-label="Логическая схема сети">
      {document.nodes.map((node) => <span key={node.id}>{node.label}</span>)}
      {document.nodes[0] && (
        <button onClick={() => onSelectionChange({ type: 'node', item: document.nodes[0] })}>
          Выбрать узел
        </button>
      )}
      {document.nodes[1] && (
        <button onClick={() => onSelectionChange({ type: 'node', item: document.nodes[1] })}>
          Выбрать CORE-B
        </button>
      )}
      {document.edges[0] && (
        <button onClick={() => onSelectionChange({ type: 'edge', item: document.edges[0] })}>
          Выбрать связь
        </button>
      )}
    </div>
  ),
}));

const document: TopologyProjectionDocument = {
  schema_version: '1.0',
  layer: 'L2',
  detail_level: 'DEVICE',
  nodes: [{
    id: 'projection-device-a',
    kind: 'NETWORK_DEVICE',
    label: 'PhysicalObject abcdef12',
    source_refs: [{
      ref_type: 'CANONICAL_FACT',
      entity_type: 'NetworkInterfacePhysicalOwner',
      entity_id: '00000000-0000-0000-0000-000000000001',
    }],
    attributes: { label_source: 'TECHNICAL_FALLBACK', owned_interface_count: 2 },
  }, {
    id: 'projection-device-b',
    kind: 'NETWORK_DEVICE',
    label: 'CORE-B',
    source_refs: [{
      ref_type: 'CANONICAL_FACT',
      entity_type: 'PhysicalObject',
      entity_id: '00000000-0000-0000-0000-000000000003',
    }],
    attributes: { owned_interface_count: 1 },
  }],
  edges: [{
    id: 'projection-edge-a-b',
    from_node_id: 'projection-device-a',
    to_node_id: 'projection-device-b',
    kind: 'LOGICAL_LINK',
    aggregate: true,
    source_refs: [{
      ref_type: 'CANONICAL_FACT',
      entity_type: 'Connection',
      entity_id: '00000000-0000-0000-0000-000000000002',
    }],
    attributes: { supporting_path_count: 1, supporting_interface_pair_count: 1 },
  }],
  gaps: [],
  warnings: [],
};

const dataSourceFor = (result: TopologyProjectionDocument = document): TopologyDataSource => ({
  loadProjection: vi.fn().mockResolvedValue(result),
});

const deviceDetailsDataSource: DeviceDetailsDataSource = {
  loadDeviceDetails: vi.fn().mockResolvedValue({
    schema_version: '1.0',
    device: { source_ref: document.nodes[1].source_refs[0], label: 'CORE-B' },
    interfaces: [], gaps: [], warnings: [],
  }),
};

describe('App projection states', () => {
  it('renders loading state while the projection request is pending', () => {
    const pending: TopologyDataSource = {
      loadProjection: vi.fn(() => new Promise<TopologyProjectionDocument>(() => undefined)),
    };
    render(<App dataSource={pending} deviceDetailsDataSource={deviceDetailsDataSource} />);

    expect(screen.getByText('Загружаем topology projection')).toBeInTheDocument();
  });

  it('displays topology nodes from an API projection document', async () => {
    render(<App dataSource={dataSourceFor()} deviceDetailsDataSource={deviceDetailsDataSource} />);

    expect(await screen.findByText('PhysicalObject abcdef12')).toBeInTheDocument();
    expect(screen.getByText('Настроенная проекция')).toBeInTheDocument();
    expect(screen.queryByText('Fixture data')).not.toBeInTheDocument();
  });

  it('renders the empty state from an empty API document', async () => {
    render(<App dataSource={dataSourceFor({ ...document, nodes: [], edges: [] })} deviceDetailsDataSource={deviceDetailsDataSource} />);
    expect(await screen.findByText('В этом scope пока пусто')).toBeInTheDocument();
  });

  it('renders the rejected data-source error state', async () => {
    const dataSource: TopologyDataSource = {
      loadProjection: vi.fn().mockRejectedValue(new Error('VALIDATION_ERROR: Unsupported layer')),
    };
    render(<App dataSource={dataSource} deviceDetailsDataSource={deviceDetailsDataSource} />);
    expect(await screen.findByText('VALIDATION_ERROR: Unsupported layer')).toBeInTheDocument();
  });

  it('invokes the data source again on retry', async () => {
    const loadProjection = vi.fn()
      .mockRejectedValueOnce(new Error('backend unavailable'))
      .mockResolvedValueOnce({ ...document, nodes: [], edges: [] });
    render(<App dataSource={{ loadProjection }} deviceDetailsDataSource={deviceDetailsDataSource} />);

    expect(await screen.findByText('backend unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('В этом scope пока пусто')).toBeInTheDocument();
    expect(loadProjection).toHaveBeenCalledTimes(2);
  });

  it('shows projection gaps separately from warnings', async () => {
    render(<App dataSource={dataSourceFor({
      ...document,
      gaps: ['NETWORK_INTERFACE_OWNER_UNKNOWN'],
      warnings: ['Projection is partial'],
    })} deviceDetailsDataSource={deviceDetailsDataSource} />);

    expect(await screen.findByText('NETWORK_INTERFACE_OWNER_UNKNOWN')).toBeInTheDocument();
    expect(screen.getByText('Пробел проекции')).toBeInTheDocument();
    expect(screen.getByText('Projection is partial')).toBeInTheDocument();
  });

  it('keeps node selection and inspector source refs working', async () => {
    render(<App dataSource={dataSourceFor()} deviceDetailsDataSource={deviceDetailsDataSource} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать узел' }));

    expect(screen.getByRole('heading', { name: 'Устройство abcdef12' })).toBeInTheDocument();
    const details = screen.getByText('Технические детали').closest('details')!;
    await userEvent.click(within(details).getByText('Технические детали'));
    expect(within(details).getByText('NetworkInterfacePhysicalOwner')).toBeInTheDocument();
  });

  it('keeps edge selection and inspector source refs working', async () => {
    render(<App dataSource={dataSourceFor()} deviceDetailsDataSource={deviceDetailsDataSource} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать связь' }));

    expect(screen.getByRole('heading', {
      name: 'Устройство abcdef12 ↔ CORE-B',
    })).toBeInTheDocument();
    const details = screen.getByText('Технические детали').closest('details')!;
    await userEvent.click(within(details).getByText('Технические детали'));
    expect(within(details).getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('Да')).toBeInTheDocument();
  });

  it('keeps topology visible when the selected device details request fails', async () => {
    const failingDetails: DeviceDetailsDataSource = {
      loadDeviceDetails: vi.fn().mockRejectedValue(new Error('details unavailable')),
    };
    render(<App dataSource={dataSourceFor()} deviceDetailsDataSource={failingDetails} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать CORE-B' }));

    expect(await screen.findByText(/details unavailable/)).toBeInTheDocument();
    expect(screen.getByLabelText('Логическая схема сети')).toBeInTheDocument();
    expect(screen.getAllByText('CORE-B').length).toBeGreaterThan(0);
  });

  it('refreshes the projection and selects the canonical node after create', async () => {
    const newDeviceId = '00000000-0000-0000-0000-000000000010';
    const newInterfaceId = '00000000-0000-0000-0000-000000000011';
    const created: DeviceDetailsDocument = {
      schema_version: '1.0',
      device: {
        source_ref: {
          ref_type: 'CANONICAL_FACT',
          entity_type: 'PhysicalObject',
          entity_id: newDeviceId,
        },
        label: 'CORE-NEW',
      },
      interfaces: [{
        interface_ref: {
          ref_type: 'CANONICAL_FACT',
          entity_type: 'NetworkInterface',
          entity_id: newInterfaceId,
        },
        label: 'eth0',
        addresses: [],
        l2_binding_count: 0,
        l3_binding_count: 0,
        direct_physical_bindings: [],
        realization_down_count: 0,
        realization_up_count: 0,
        source_refs: [],
      }],
      gaps: [],
      warnings: [],
    };
    const refreshed: TopologyProjectionDocument = {
      ...document,
      nodes: [{
        id: 'projection-device-new',
        kind: 'NETWORK_DEVICE',
        label: 'CORE-NEW',
        source_refs: [created.device.source_ref],
        attributes: { label_source: 'ALIAS_DISPLAY', owned_interface_count: 1 },
        status: 'CONFIGURED',
      }],
      edges: [],
    };
    const loadProjection = vi.fn()
      .mockResolvedValueOnce({ ...document, nodes: [], edges: [] })
      .mockResolvedValueOnce(refreshed);
    const createNetworkDevice = vi.fn().mockResolvedValue(created);
    const writeSource: DeviceWriteDataSource = { createNetworkDevice };
    const detailsSource: DeviceDetailsDataSource = {
      loadDeviceDetails: vi.fn().mockResolvedValue(created),
    };
    render(
      <App
        dataSource={{ loadProjection }}
        deviceDetailsDataSource={detailsSource}
        deviceWriteDataSource={writeSource}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: '+ Добавить' }));
    await userEvent.type(screen.getByLabelText('Название устройства'), 'CORE-NEW');
    await userEvent.type(screen.getByLabelText('Первый интерфейс'), 'eth0');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByRole('heading', { name: 'CORE-NEW' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'eth0' })).toBeInTheDocument();
    expect(loadProjection).toHaveBeenCalledTimes(2);
    expect(createNetworkDevice).toHaveBeenCalledTimes(1);
    expect(detailsSource.loadDeviceDetails).toHaveBeenCalledWith(newDeviceId);
  });

  it('refreshes projection after interface create and keeps the same device selected', async () => {
    const deviceId = document.nodes[1].source_refs[0].entity_id;
    const initialDetails: DeviceDetailsDocument = {
      schema_version: '1.0',
      device: { source_ref: document.nodes[1].source_refs[0], label: 'CORE-B' },
      interfaces: [{
        interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'eth0-id' },
        label: 'eth0', addresses: [], l2_binding_count: 0, l3_binding_count: 0,
        direct_physical_bindings: [], realization_down_count: 0, realization_up_count: 0,
        source_refs: [],
      }], gaps: [], warnings: [],
    };
    const updatedDetails: DeviceDetailsDocument = {
      ...initialDetails,
      interfaces: [
        ...initialDetails.interfaces,
        {
          ...initialDetails.interfaces[0],
          interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'eth1-id' },
          label: 'eth1',
        },
      ],
    };
    const refreshed: TopologyProjectionDocument = {
      ...document,
      nodes: document.nodes.map((item) => item.id === document.nodes[1].id
        ? { ...item, attributes: { ...item.attributes, owned_interface_count: 2 } }
        : item),
    };
    const loadProjection = vi.fn()
      .mockResolvedValueOnce(document)
      .mockResolvedValueOnce(refreshed);
    const detailsSource: DeviceDetailsDataSource = {
      loadDeviceDetails: vi.fn().mockResolvedValue(initialDetails),
    };
    const createDeviceInterface = vi.fn().mockResolvedValue(updatedDetails);
    const interfaceWriteSource: DeviceInterfaceWriteDataSource = { createDeviceInterface };
    render(
      <App
        dataSource={{ loadProjection }}
        deviceDetailsDataSource={detailsSource}
        deviceInterfaceWriteDataSource={interfaceWriteSource}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать CORE-B' }));
    await screen.findByRole('heading', { name: 'eth0' });
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить интерфейс' }));
    await userEvent.type(screen.getByLabelText('Название'), 'eth1');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByRole('heading', { name: 'eth1' })).toBeInTheDocument();
    expect(await screen.findByText('2', { selector: '.inspector__facts strong' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CORE-B' })).toBeInTheDocument();
    expect(loadProjection).toHaveBeenCalledTimes(2);
    expect(createDeviceInterface).toHaveBeenCalledWith(deviceId, { display_name: 'eth1' });
  });

  it('creates a physical link, refreshes the projection, and keeps the source selected', async () => {
    const coreId = '00000000-0000-0000-0000-000000000101';
    const fwId = '00000000-0000-0000-0000-000000000102';
    const coreInterfaceId = '00000000-0000-0000-0000-000000000201';
    const fwInterfaceId = '00000000-0000-0000-0000-000000000202';
    const nodes = [{
      id: 'projection-core', kind: 'NETWORK_DEVICE', label: 'CORE', status: 'CONFIGURED',
      source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: coreId }],
      attributes: { owned_interface_count: 1 },
    }, {
      id: 'projection-fw', kind: 'NETWORK_DEVICE', label: 'FW', status: 'CONFIGURED',
      source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: fwId }],
      attributes: { owned_interface_count: 1 },
    }];
    const isolated: TopologyProjectionDocument = { ...document, nodes, edges: [] };
    const linked: TopologyProjectionDocument = {
      ...isolated,
      edges: [{
        id: 'projection-core-fw',
        from_node_id: nodes[0].id,
        to_node_id: nodes[1].id,
        kind: 'L2_DEVICE_LINK',
        aggregate: true,
        status: 'CONFIGURED',
        source_refs: [],
        attributes: { supporting_path_count: 1, supporting_interface_pair_count: 1 },
      }],
    };
    const interfaceDetails = (
      interfaceId: string,
      label: string,
      bound = false,
    ): DeviceInterfaceDetails => ({
      interface_ref: {
        ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: interfaceId,
      },
      label,
      addresses: [],
      l2_binding_count: 0,
      l3_binding_count: 0,
      direct_physical_bindings: bound ? [{
        connection_point_ref: {
          ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: `${interfaceId}-point`,
        },
        member_index: 1,
        source_refs: [],
      }] : [],
      realization_down_count: 0,
      realization_up_count: 0,
      source_refs: [],
    });
    let created = false;
    const detailsSource: DeviceDetailsDataSource = {
      loadDeviceDetails: vi.fn((id) => Promise.resolve({
        schema_version: '1.0',
        device: {
          source_ref: {
            ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id,
          },
          label: id === coreId ? 'CORE' : 'FW',
        },
        interfaces: [id === coreId
          ? interfaceDetails(coreInterfaceId, 'eth0', created)
          : interfaceDetails(fwInterfaceId, 'eth0')],
        gaps: [], warnings: [],
      } satisfies DeviceDetailsDocument)),
    };
    const creation: PhysicalConnectionCreationDocument = {
      schema_version: '1.0',
      source_interface_ref: interfaceDetails(coreInterfaceId, 'eth0').interface_ref,
      target_interface_ref: interfaceDetails(fwInterfaceId, 'eth0').interface_ref,
      cable_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'cable-id' },
      source_binding_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'InterfacePhysicalBinding', entity_id: 'source-binding' },
      target_binding_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'InterfacePhysicalBinding', entity_id: 'target-binding' },
      connection_refs: ['1', '2', '3'].map((id) => ({
        ref_type: 'CANONICAL_FACT', entity_type: 'Connection', entity_id: id,
      })),
    };
    const createPhysicalLink = vi.fn().mockImplementation(() => {
      created = true;
      return Promise.resolve(creation);
    });
    const physicalWriteSource: PhysicalLinkWriteDataSource = { createPhysicalLink };
    const loadProjection = vi.fn()
      .mockResolvedValueOnce(isolated)
      .mockResolvedValueOnce(linked);
    render(
      <App
        dataSource={{ loadProjection }}
        deviceDetailsDataSource={detailsSource}
        physicalLinkWriteDataSource={physicalWriteSource}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать узел' }));
    await screen.findByRole('heading', { name: 'eth0' });
    await userEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await userEvent.selectOptions(screen.getByLabelText('Куда: устройство'), fwId);
    await screen.findByRole('option', { name: 'eth0' });
    await userEvent.selectOptions(screen.getByLabelText('Куда: интерфейс'), fwInterfaceId);
    await userEvent.type(screen.getByLabelText('Кабель'), 'CORE-FW-01');
    await userEvent.click(screen.getAllByRole('button', { name: 'Подключить' }).at(-1)!);

    expect(await screen.findByRole('heading', { name: 'CORE' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Соседние устройства 1' }),
    ).toBeInTheDocument();
    expect(screen.getByText('FW', { selector: '.neighbor-list strong' })).toBeInTheDocument();
    expect(
      await screen.findByText('Прямых физических привязок:', { exact: false }),
    ).toHaveTextContent('Прямых физических привязок: 1');
    expect(loadProjection).toHaveBeenCalledTimes(2);
    expect(createPhysicalLink).toHaveBeenCalledWith({
      source_interface_id: coreInterfaceId,
      target_interface_id: fwInterfaceId,
      cable_display_name: 'CORE-FW-01',
    });
  });

  it('switches logical and physical requests while preserving only canonical counterparts', async () => {
    const coreRef = {
      ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'po-core',
    };
    const firewallRef = {
      ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'po-fw',
    };
    const cableRef = {
      ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'po-cable',
    };
    const logical: TopologyProjectionDocument = {
      ...document,
      nodes: [{
        id: 'l2-core', kind: 'NETWORK_DEVICE', label: 'CORE', source_refs: [coreRef],
        attributes: { owned_interface_count: 1 }, status: 'CONFIGURED',
      }, {
        id: 'l2-fw', kind: 'NETWORK_DEVICE', label: 'FW', source_refs: [firewallRef],
        attributes: { owned_interface_count: 1 }, status: 'CONFIGURED',
      }],
      edges: [],
    };
    const physical: TopologyProjectionDocument = {
      schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT',
      nodes: [{
        id: 'l1-core', kind: 'PHYSICAL_OBJECT', label: 'CORE', source_refs: [coreRef],
        attributes: { connection_point_count: 1, owned_interface_count: 1 }, status: 'CONFIGURED',
      }, {
        id: 'l1-cable', kind: 'PHYSICAL_OBJECT', label: 'CORE-FW-01', source_refs: [cableRef],
        attributes: { connection_point_count: 2, owned_interface_count: 0 }, status: 'CONFIGURED',
      }, {
        id: 'l1-fw', kind: 'PHYSICAL_OBJECT', label: 'FW', source_refs: [firewallRef],
        attributes: { connection_point_count: 1, owned_interface_count: 1 }, status: 'CONFIGURED',
      }],
      edges: [], gaps: [], warnings: [],
    };
    const loadProjection = vi.fn((request) => Promise.resolve(
      request.layer === 'L1' ? physical : logical,
    ));
    const detailsSource: DeviceDetailsDataSource = {
      loadDeviceDetails: vi.fn().mockResolvedValue({
        schema_version: '1.0', device: { source_ref: coreRef, label: 'CORE' },
        interfaces: [], gaps: [], warnings: [],
      }),
    };
    render(<App dataSource={{ loadProjection }} deviceDetailsDataSource={detailsSource} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать узел' }));
    expect(screen.getByRole('heading', { name: 'CORE' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Физическая' }));

    expect(await screen.findByRole('heading', { name: 'Физическая топология' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CORE' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Интерфейсы' })).not.toBeInTheDocument();
    expect(loadProjection).toHaveBeenNthCalledWith(2, {
      layer: 'L1', detail_level: 'PHYSICAL_OBJECT',
      scope: { include_location_subtrees: [], include_entities: [] },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Выбрать CORE-B' }));
    expect(screen.getByRole('heading', { name: 'CORE-FW-01' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Логическая' }));

    expect(await screen.findByRole('heading', { name: 'Логическая топология' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Инспектор' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'CORE-FW-01' })).not.toBeInTheDocument();
  });

  it('creates a physical object, refreshes L1, selects it, and loads its point details', async () => {
    const objectId = '00000000-0000-0000-0000-000000000501';
    const pointId = '00000000-0000-0000-0000-000000000502';
    const objectRef = {
      ref_type: 'CANONICAL_FACT' as const,
      entity_type: 'PhysicalObject',
      entity_id: objectId,
    };
    const created: PhysicalObjectDetailsDocument = {
      schema_version: '1.0',
      physical_object: { source_ref: objectRef, label: 'Розетка 101-1' },
      connection_points: [{
        connection_point_ref: {
          ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: pointId,
        },
        label: 'Порт',
        cardinality: 1,
        incident_connection_count: 0,
        direct_interface_binding_count: 0,
        source_refs: [],
      }],
      owned_interface_count: 0,
      gaps: [],
      warnings: [],
    };
    const emptyPhysical: TopologyProjectionDocument = {
      schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT',
      nodes: [], edges: [], gaps: [], warnings: [],
    };
    const refreshedPhysical: TopologyProjectionDocument = {
      ...emptyPhysical,
      nodes: [{
        id: 'l1-outlet', kind: 'PHYSICAL_OBJECT', label: 'Розетка 101-1',
        source_refs: [objectRef],
        attributes: { connection_point_count: 1, owned_interface_count: 0 },
        status: 'CONFIGURED',
      }],
    };
    const loadProjection = vi.fn()
      .mockResolvedValueOnce({ ...document, nodes: [], edges: [] })
      .mockResolvedValueOnce(emptyPhysical)
      .mockResolvedValueOnce(refreshedPhysical)
      .mockResolvedValueOnce({ ...document, nodes: [], edges: [] });
    const createPhysicalObject = vi.fn().mockResolvedValue(created);
    const writeSource: PhysicalObjectWriteDataSource = { createPhysicalObject };
    const physicalDetailsSource: PhysicalObjectDetailsDataSource = {
      loadPhysicalObjectDetails: vi.fn().mockResolvedValue(created),
    };
    render(
      <App
        dataSource={{ loadProjection }}
        deviceDetailsDataSource={deviceDetailsDataSource}
        physicalObjectWriteDataSource={writeSource}
        physicalObjectDetailsDataSource={physicalDetailsSource}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Физическая' }));
    expect(await screen.findByText('В этом scope пока пусто')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await userEvent.type(screen.getByLabelText('Название'), 'Розетка 101-1');
    await userEvent.type(screen.getByLabelText('Первая точка подключения'), 'Порт');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect(await screen.findByRole('heading', { name: 'Розетка 101-1' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Порт' })).toBeInTheDocument();
    expect(createPhysicalObject).toHaveBeenCalledWith({
      display_name: 'Розетка 101-1',
      initial_connection_point: { display_name: 'Порт' },
    });
    expect(loadProjection).toHaveBeenNthCalledWith(3, {
      layer: 'L1', detail_level: 'PHYSICAL_OBJECT',
      scope: { include_location_subtrees: [], include_entities: [] },
    });
    expect(physicalDetailsSource.loadPhysicalObjectDetails).toHaveBeenCalledWith(objectId);

    await userEvent.click(screen.getByRole('button', { name: 'Логическая' }));
    expect(await screen.findByRole('heading', { name: 'Логическая топология' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Розетка 101-1' })).not.toBeInTheDocument();
  });
});
