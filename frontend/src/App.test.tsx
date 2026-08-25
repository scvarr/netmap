import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App, type AppProps } from './App';
import type { DeviceDetailsDocument } from './topology/deviceDetailsTypes';
import type { PhysicalObjectDetailsDocument } from './topology/physicalObjectDetailsTypes';
import type { CatalogInventoryDocument } from './topology/catalogInventoryTypes';
import {
  LOGICAL_PROJECTION_REQUEST,
  PHYSICAL_PROJECTION_REQUEST,
} from './topology/projection';
import type {
  TopologyDataSource,
  TopologyProjectionDocument,
  TopologySelection,
} from './topology/types';

vi.mock('./components/HealthIndicator', () => ({
  HealthIndicator: () => <div>Backend доступен</div>,
}));

vi.mock('./components/TopologyCanvas', () => ({
  TopologyCanvas: ({ document, onSelectionChange, traceOverlay }: {
    document: TopologyProjectionDocument;
    onSelectionChange: (selection: TopologySelection) => void;
    traceOverlay?: { highlightedNodeIds: Set<string>; highlightedEdgeIds: Set<string> };
  }) => (
    <div aria-label={document.layer === 'L1' ? 'Физическая схема сети' : 'Логическая схема сети'}>
      <output data-testid="trace-overlay">{[...(traceOverlay?.highlightedNodeIds ?? [])].join(',')}|{[...(traceOverlay?.highlightedEdgeIds ?? [])].join(',')}</output>
      {document.nodes.map((node) => (
        <div key={node.id}>
          <span>{node.label}</span>
          <button onClick={() => onSelectionChange({ type: 'node', item: node })}>Выбрать {node.label}</button>
        </div>
      ))}
    </div>
  ),
}));

const ppId = '00000000-0000-0000-0000-000000000101';
const swId = '00000000-0000-0000-0000-000000000102';
const physicalRef = (entityId: string) => ({
  ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: entityId,
});

const physicalDocument: TopologyProjectionDocument = {
  schema_version: '1.0',
  layer: 'L1',
  detail_level: 'PHYSICAL_OBJECT',
  nodes: [{
    id: 'physical-pp1', kind: 'PHYSICAL_OBJECT', label: 'PP1', status: 'CONFIGURED',
    source_refs: [physicalRef(ppId)],
    attributes: { class: 'patch_panel', connection_point_count: 2, owned_interface_count: 0 },
  }, {
    id: 'physical-sw1', kind: 'PHYSICAL_OBJECT', label: 'SW1', status: 'CONFIGURED',
    source_refs: [physicalRef(swId)],
    attributes: { class: 'switch', connection_point_count: 2, owned_interface_count: 2 },
  }],
  edges: [{
    id: 'physical-edge', from_node_id: 'physical-pp1', to_node_id: 'physical-sw1',
    kind: 'L1_PHYSICAL_LINK', aggregate: true, status: 'CONFIGURED', source_refs: [],
    attributes: { supporting_connection_count: 1, supporting_member_pair_count: 1 },
  }],
  gaps: [], warnings: [],
};

const logicalDocument: TopologyProjectionDocument = {
  schema_version: '1.0',
  layer: 'L2',
  detail_level: 'DEVICE',
  nodes: [{
    id: 'logical-sw1', kind: 'NETWORK_DEVICE', label: 'SW1', status: 'CONFIGURED',
    source_refs: [physicalRef(swId)], attributes: { owned_interface_count: 2 },
  }],
  edges: [], gaps: [], warnings: [],
};

const catalogDocument: CatalogInventoryDocument = {
  schema_version: '1.0',
  equipment: [{ physical_object_ref: physicalRef(ppId), label: 'PP1', class: 'patch_panel', occupancy: { total_ports: 2, connected_ports: 1, free_ports: 1 }, map_memberships: [] }, { physical_object_ref: physicalRef(swId), label: 'SW1', class: 'switch', occupancy: { total_ports: 2, connected_ports: 1, free_ports: 1 }, map_memberships: [] }],
  cables: [], gaps: [], warnings: [],
};

const ppDetails: PhysicalObjectDetailsDocument = {
  schema_version: '1.0',
  physical_object: { source_ref: physicalRef(ppId), label: 'PP1', class: 'patch_panel' },
  connection_points: [{
    connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'port-01' },
    label: 'Port01', cardinality: 1, incident_connection_count: 1,
    direct_interface_binding_count: 0, source_refs: [],
  }, {
    connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'port-02' },
    label: 'Port02', cardinality: 1, incident_connection_count: 1,
    direct_interface_binding_count: 0, source_refs: [],
  }],
  owned_interface_count: 0, gaps: [], warnings: [],
};

const swDetails: PhysicalObjectDetailsDocument = {
  ...ppDetails,
  physical_object: { source_ref: physicalRef(swId), label: 'SW1', class: 'switch' },
  connection_points: ppDetails.connection_points.map((point, index) => ({
    ...point,
    connection_point_ref: { ...point.connection_point_ref, entity_id: `sw-port-${index}` },
  })),
  owned_interface_count: 2,
};

const deviceDetails: DeviceDetailsDocument = {
  schema_version: '1.0',
  device: { source_ref: physicalRef(swId), label: 'SW1' },
  interfaces: [{
    interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'eth0-id' },
    label: 'eth0', addresses: [], l2_binding_count: 0, l3_binding_count: 0,
    direct_physical_bindings: [], realization_down_count: 0, realization_up_count: 0,
    source_refs: [],
  }], gaps: [], warnings: [],
};

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
};

const dataSourceFor = () => ({
  loadProjection: vi.fn((request) => Promise.resolve(
    request.layer === 'L1' ? physicalDocument : logicalDocument,
  )),
} satisfies TopologyDataSource);

const renderApp = (route: string, overrides: Partial<AppProps> = {}) => {
  const dataSource = overrides.dataSource ?? dataSourceFor();
  const props: AppProps = {
    dataSource,
    deviceDetailsDataSource: {
      loadDeviceDetails: vi.fn().mockResolvedValue(deviceDetails),
    },
    physicalObjectDetailsDataSource: {
      loadPhysicalObjectDetails: vi.fn((id) => Promise.resolve(id === swId ? swDetails : ppDetails)),
    },
    catalogInventoryDataSource: { loadCatalogInventory: vi.fn().mockResolvedValue(catalogDocument) },
    ...overrides,
  };
  render(
    <MemoryRouter initialEntries={[route]}>
      <App {...props} />
      <LocationProbe />
    </MemoryRouter>,
  );
  return { props, dataSource };
};

describe('UI-SHELL.1 routes and product surfaces', () => {
  it('redirects / to /map and uses the stable logical default', async () => {
    const { dataSource } = renderApp('/');
    expect(await screen.findByTestId('location')).toHaveTextContent('/map');
    await waitFor(() => expect(dataSource.loadProjection).toHaveBeenCalledWith(LOGICAL_PROJECTION_REQUEST));
  });

  it('opens topology on /map', async () => {
    renderApp('/map');
    expect(await screen.findByLabelText('Логическая схема сети')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Основная навигация' })).toBeInTheDocument();
  });

  it.each([
    ['logical', LOGICAL_PROJECTION_REQUEST, 'Логическая схема сети'],
    ['physical', PHYSICAL_PROJECTION_REQUEST, 'Физическая схема сети'],
  ] as const)('selects the %s projection from URL state', async (view, request, label) => {
    const { dataSource } = renderApp(`/map?view=${view}`);
    expect(await screen.findByLabelText(label)).toBeInTheDocument();
    expect(dataSource.loadProjection).toHaveBeenCalledWith(request);
  });

  it('focuses a projection node through its canonical PhysicalObject ref', async () => {
    renderApp(`/map?view=physical&focus=${ppId}`);
    expect(await screen.findByRole('heading', { name: 'PP1' })).toBeInTheDocument();
    expect(screen.getByText('ПАТЧ-ПАНЕЛЬ')).toBeInTheDocument();
  });

  it('handles a canonical focus absent from the projection without crashing', async () => {
    renderApp('/map?view=physical&focus=absent-object');
    expect(await screen.findByText(/отсутствует в этой проекции/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Быстрый инспектор')).not.toBeInTheDocument();
  });

  it('preserves canonical selection across projection switches', async () => {
    const { dataSource } = renderApp('/map?view=logical');
    await userEvent.click(await screen.findByRole('button', { name: 'Выбрать SW1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Физическая' }));
    expect(await screen.findByLabelText('Физическая схема сети')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'SW1' })).toBeInTheDocument();
    expect(dataSource.loadProjection).toHaveBeenCalledWith(PHYSICAL_PROJECTION_REQUEST);
  });

  it('runs object L1 from Physical view and shows only selected evidenced overlay after REACHABLE', async () => {
    const traceDataSource = { tracePhysicalObjectsL1: vi.fn().mockResolvedValue({
      schema_version: 1,
      query: { from_physical_object_id: swId, to_physical_object_id: swId },
      verdict: 'REACHABLE',
      source_candidates: [], target_candidates: [], cycles: [], evidence_refs: [],
      branches: [{ branch_id: 'branch', source: { point_id: 'point-a', member_index: 1 }, target: { point_id: 'point-b', member_index: 1 }, edge_ids: ['trace-edge'], evidence_refs: [] }],
      nodes: [],
      edges: [{ id: 'trace-edge', from_node_id: 'n1', to_node_id: 'n2', evidence_refs: [{ entity_type: 'PhysicalObject', entity_id: swId }] }],
      gaps: [], warnings: [],
    } as const) };
    const { dataSource } = renderApp('/map?view=physical', { traceDataSource });
    expect(await screen.findByLabelText('Физическая схема сети')).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText('Откуда'), swId);
    await userEvent.selectOptions(screen.getByLabelText('Куда'), swId);
    await userEvent.click(screen.getByRole('button', { name: 'Трассировать' }));
    await waitFor(() => expect(traceDataSource.tracePhysicalObjectsL1).toHaveBeenCalledWith({
      from_physical_object_id: swId, to_physical_object_id: swId,
    }));
    expect(screen.getByTestId('trace-overlay')).toHaveTextContent('physical-sw1|');
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить трассировку' }));
    expect(screen.getByTestId('trace-overlay')).toHaveTextContent('|');
  });

  it('opens object detail from Quick Inspector and exposes no canonical forms on Map', async () => {
    renderApp(`/map?view=physical&focus=${ppId}`);
    const open = await screen.findByRole('link', { name: 'Открыть объект' });
    expect(open).toHaveAttribute('href', `/infrastructure/objects/${ppId}`);
    expect(screen.queryByLabelText('Название устройства')).not.toBeInTheDocument();
    expect(screen.queryByText('+ Добавить точку')).not.toBeInTheDocument();
    expect(screen.queryByText('Сохранить тип')).not.toBeInTheDocument();
  });

  it('loads the catalog through its inventory datasource without an L1 projection', async () => {
    const inventory = { loadCatalogInventory: vi.fn().mockResolvedValue(catalogDocument) };
    const { dataSource } = renderApp('/infrastructure/objects', { catalogInventoryDataSource: inventory });
    expect(await screen.findByRole('heading', { name: 'Каталог' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PP1' })).toBeInTheDocument();
    expect(screen.getByText('patch_panel')).toBeInTheDocument();
    expect(inventory.loadCatalogInventory).toHaveBeenCalledTimes(1);
    expect(dataSource.loadProjection).not.toHaveBeenCalled();
  });

  it('links an object row to the canonical detail URL', async () => {
    renderApp('/infrastructure/objects');
    expect(await screen.findByRole('link', { name: 'PP1' })).toHaveAttribute(
      'href', `/infrastructure/objects/${ppId}`,
    );
  });

  it('loads PhysicalObjectDetailsDocument on object detail without inventing map membership', async () => {
    const loadPhysicalObjectDetails = vi.fn().mockResolvedValue(ppDetails);
    renderApp(`/infrastructure/objects/${ppId}`, {
      physicalObjectDetailsDataSource: { loadPhysicalObjectDetails },
      l2ForwardingContextWriteDataSource: { createL2ForwardingContext: vi.fn() },
    });
    expect(await screen.findByRole('heading', { name: 'PP1' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Port01' })).toBeInTheDocument();
    expect(loadPhysicalObjectDetails).toHaveBeenCalledWith(ppId);
    expect(await screen.findByText('На картах: нет')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Показать на карте' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'L2 forwarding' })).not.toBeInTheDocument();
  });

  it('reuses existing detail write sections for active objects', async () => {
    const twoInterfaces = {
      ...deviceDetails,
      interfaces: [
        ...deviceDetails.interfaces,
        { ...deviceDetails.interfaces[0], interface_ref: { ...deviceDetails.interfaces[0].interface_ref, entity_id: 'eth1-id' }, label: 'eth1' },
      ],
    };
    renderApp(`/infrastructure/objects/${swId}`, {
      deviceDetailsDataSource: { loadDeviceDetails: vi.fn().mockResolvedValue(twoInterfaces) },
      deviceInterfaceWriteDataSource: { createDeviceInterface: vi.fn() },
      connectionPointWriteDataSource: { createConnectionPoint: vi.fn() },
      physicalObjectClassWriteDataSource: { setPhysicalObjectClass: vi.fn() },
      l2ForwardingContextWriteDataSource: { createL2ForwardingContext: vi.fn() },
    });
    expect(await screen.findByRole('heading', { name: 'SW1' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '+ Добавить интерфейс' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Добавить точку' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить тип' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'L2 forwarding' })).toBeInTheDocument();
  });

  it('uses the existing device write datasource and navigates to canonical detail after success', async () => {
    const createdId = '00000000-0000-0000-0000-000000000501';
    const createNetworkDevice = vi.fn().mockResolvedValue({
      ...deviceDetails,
      device: { ...deviceDetails.device, source_ref: physicalRef(createdId), label: 'CORE-NEW' },
    });
    renderApp('/infrastructure/objects/new', {
      deviceWriteDataSource: { createNetworkDevice },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Создать вручную' }));
    await userEvent.type(screen.getByLabelText('Название устройства'), ' CORE-NEW ');
    await userEvent.type(screen.getByLabelText('Первый интерфейс'), ' eth0 ');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(createNetworkDevice).toHaveBeenCalledWith({
      display_name: 'CORE-NEW', initial_interface: { display_name: 'eth0' },
    });
    expect(await screen.findByTestId('location')).toHaveTextContent(`/infrastructure/objects/${createdId}`);
  });

  it('uses the existing physical-object write datasource and navigates after success', async () => {
    const createdId = '00000000-0000-0000-0000-000000000502';
    const createPhysicalObject = vi.fn().mockResolvedValue({
      ...ppDetails,
      physical_object: { ...ppDetails.physical_object, source_ref: physicalRef(createdId), label: 'Outlet1' },
    });
    renderApp('/infrastructure/objects/new', {
      physicalObjectWriteDataSource: { createPhysicalObject },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Создать вручную' }));
    await userEvent.click(screen.getByRole('button', { name: /Физический объект/ }));
    await userEvent.type(screen.getByLabelText('Название'), 'Outlet1');
    await userEvent.type(screen.getByLabelText('Первая точка подключения'), 'Port');
    await userEvent.selectOptions(screen.getByLabelText('Категория'), 'outlet');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(createPhysicalObject).toHaveBeenCalledWith({
      display_name: 'Outlet1', initial_connection_point: { display_name: 'Port' }, class: 'outlet',
    });
    expect(await screen.findByTestId('location')).toHaveTextContent(`/infrastructure/objects/${createdId}`);
  });

  it('makes blueprint materialization the primary object creation flow', async () => {
    const createdId = '00000000-0000-0000-0000-000000000503';
    const blueprint = { schema_version: '1.0' as const, blueprints: [{ blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp-switch' }, name: 'Switch 24', version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v-switch' }, version_number: 3, body: { kind: 'RECTANGLE' as const, width: 120, height: 40 }, slot_count: 24, internal_link_count: 0, version_count: 3 }] };
    const instantiateObjectBlueprint = vi.fn().mockResolvedValue({ schema_version: '1.0' as const, blueprint_ref: blueprint.blueprints[0].blueprint_ref, version_ref: blueprint.blueprints[0].version_ref, physical_object_ref: physicalRef(createdId), slots: [] });
    renderApp('/infrastructure/objects/new', { objectBlueprintDataSource: { loadObjectBlueprints: vi.fn().mockResolvedValue(blueprint), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint: vi.fn(), instantiateObjectBlueprint } });
    expect(await screen.findByRole('heading', { name: 'Switch 24' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Сетевое устройство/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать шаблон' }));
    await userEvent.type(screen.getByLabelText('Имя экземпляра'), ' SW1 ');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(instantiateObjectBlueprint).toHaveBeenCalledWith('bp-switch', 'v-switch', { display_name: 'SW1' });
    expect(await screen.findByTestId('location')).toHaveTextContent(`/infrastructure/objects/${createdId}`);
  });

  it('shows an actionable no-template state while keeping manual creation advanced', async () => {
    const objectBlueprintDataSource = { loadObjectBlueprints: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, blueprints: [] }), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint: vi.fn() };
    renderApp('/infrastructure/objects/new', { objectBlueprintDataSource });
    expect(await screen.findByRole('heading', { name: 'Сначала создайте шаблон' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Создать первый шаблон' })).toHaveAttribute('href', '/library/object-blueprints/new');
    expect(screen.queryByLabelText('Тип ручного создания')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Создать вручную' }));
    expect(screen.getByLabelText('Тип ручного создания')).toBeInTheDocument();
  });

  it('keeps loading, error, and empty map states working', async () => {
    const pending: TopologyDataSource = {
      loadProjection: vi.fn(() => new Promise<TopologyProjectionDocument>(() => undefined)),
    };
    const { unmount } = render(
      <MemoryRouter initialEntries={['/map']}>
      <App dataSource={pending} deviceDetailsDataSource={{ loadDeviceDetails: vi.fn() }} catalogInventoryDataSource={{ loadCatalogInventory: vi.fn() }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Загружаем topology projection')).toBeInTheDocument();
    unmount();

    renderApp('/map', { dataSource: { loadProjection: vi.fn().mockRejectedValue(new Error('backend unavailable')) } });
    expect(await screen.findByText('backend unavailable')).toBeInTheDocument();
  });

  it('renders the catalog empty state without inventing objects', async () => {
    renderApp('/infrastructure/objects', {
      catalogInventoryDataSource: { loadCatalogInventory: vi.fn().mockResolvedValue({ ...catalogDocument, equipment: [], cables: [] }) },
    });
    expect(await screen.findByText('Каталог пока пуст.')).toBeInTheDocument();
  });

  it('routes the Object Library, renders saved blueprints, and saves explicit editor output', async () => {
    const blueprint = {
      schema_version: '1.0' as const,
      blueprints: [{
        blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp-1' },
        name: 'Generic cable', version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v-1' }, version_number: 1,
        default_physical_object_class: 'cable', body: { kind: 'RECTANGLE' as const, width: 120, height: 6, fill_color: '#123456' }, slot_count: 2, internal_link_count: 1, version_count: 1,
      }],
    };
    const objectBlueprintDataSource = {
      loadObjectBlueprints: vi.fn().mockResolvedValue(blueprint),
      loadObjectBlueprintVersion: vi.fn().mockResolvedValue({ ...blueprint.blueprints[0], slots: [
        { key: 'A01', display_name: 'A01', kind: 'CONNECTION_POINT' as const, anchor: { side: 'LEFT' as const, offset: .5 } },
        { key: 'B01', display_name: 'B01', kind: 'CONNECTION_POINT' as const, anchor: { side: 'RIGHT' as const, offset: .5 } },
      ], internal_links: [{ from_slot_key: 'A01', to_slot_key: 'B01' }] }),
      createObjectBlueprint: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, blueprint_ref: blueprint.blueprints[0].blueprint_ref, version_ref: blueprint.blueprints[0].version_ref }),
    };
    renderApp('/library/object-blueprints', { objectBlueprintDataSource });
    expect(await screen.findByRole('heading', { name: 'Generic cable' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Шаблоны объектов' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Создать объект' })).toHaveAttribute('href', '/infrastructure/objects/new?blueprint=bp-1&version=v-1');
    await userEvent.click(screen.getByRole('link', { name: 'Создать шаблон' }));
    await userEvent.type(screen.getByLabelText('Название шаблона'), 'Cable from editor');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить группу портов' }));
    await userEvent.type(screen.getByLabelText('Префикс отображаемого имени 1'), 'A');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }));
    await waitFor(() => expect(objectBlueprintDataSource.createObjectBlueprint).toHaveBeenCalled());
    expect(objectBlueprintDataSource.createObjectBlueprint).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Cable from editor', slots: expect.arrayContaining([expect.objectContaining({ key: expect.stringMatching(/^group-.*:1$/), display_name: 'A01' })]), internal_links: [],
      authoring_recipe: { endpoint_groups: [expect.objectContaining({ display_prefix: 'A' })], pair_recipes: [], individual_links: [] },
    }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/library/object-blueprints');
    expect(objectBlueprintDataSource.loadObjectBlueprints).toHaveBeenCalledTimes(2);
  });

  it('shows an empty Object Library and keeps its API error visible', async () => {
    const emptySource = { loadObjectBlueprints: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, blueprints: [] }), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint: vi.fn() };
    renderApp('/library/object-blueprints', { objectBlueprintDataSource: emptySource });
    expect(await screen.findByText('В этом scope пока пусто')).toBeInTheDocument();
    const failingSource = { ...emptySource, loadObjectBlueprints: vi.fn().mockRejectedValue(new Error('library unavailable')) };
    renderApp('/library/object-blueprints', { objectBlueprintDataSource: failingSource });
    expect(await screen.findByText('library unavailable')).toBeInTheDocument();
  });

  it('keeps the blueprint library usable when one preview version cannot be read', async () => {
    const source = {
      loadObjectBlueprints: vi.fn().mockResolvedValue({ schema_version: '1.0' as const, blueprints: [{
        blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'broken-bp' },
        name: 'Несовместимый шаблон', version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'broken-v' }, version_number: 1,
        body: { kind: 'RECTANGLE' as const, width: 100, height: 40 }, slot_count: 1, internal_link_count: 0, version_count: 1,
      }]}),
      loadObjectBlueprintVersion: vi.fn().mockRejectedValue(new Error('VALIDATION_ERROR: Сохранённый рецепт шаблона несовместим с текущим редактором')),
      createObjectBlueprint: vi.fn(), deleteObjectBlueprint: vi.fn(),
    };
    renderApp('/library/object-blueprints', { objectBlueprintDataSource: source });
    expect(await screen.findByRole('heading', { name: 'Несовместимый шаблон' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
    expect(screen.queryByText(/Не удалось загрузить схему/)).not.toBeInTheDocument();
  });
});
