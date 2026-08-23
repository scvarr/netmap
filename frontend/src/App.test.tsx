import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App, type AppProps } from './App';
import type { DeviceDetailsDocument } from './topology/deviceDetailsTypes';
import type { PhysicalObjectDetailsDocument } from './topology/physicalObjectDetailsTypes';
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

  it('runs L1 from Physical view using the logical projection and shows only evidenced overlay after REACHABLE', async () => {
    const traceDataSource = { traceInterfacePhysical: vi.fn().mockResolvedValue({
      schema_version: 1,
      query: { from_interface_id: 'eth0-id', to_interface_id: 'eth0-id' },
      verdict: 'REACHABLE',
      branches: [{ branch_id: 'branch', source_candidate_id: 'source', target_candidate_id: 'target', edge_ids: ['trace-edge'], evidence_refs: [] }],
      nodes: [],
      edges: [{ id: 'trace-edge', from_node_id: 'n1', to_node_id: 'n2', evidence_refs: [{ entity_type: 'PhysicalObject', entity_id: swId }] }],
      gaps: [], warnings: [],
    } as const) };
    const { dataSource } = renderApp('/map?view=physical', { traceDataSource });
    expect(await screen.findByLabelText('Физическая схема сети')).toBeInTheDocument();
    await waitFor(() => expect(dataSource.loadProjection).toHaveBeenCalledWith(LOGICAL_PROJECTION_REQUEST));
    await userEvent.type(screen.getByLabelText('Trace command'), 'trace SW1 SW1 l1');
    await userEvent.click(screen.getByRole('button', { name: 'Trace' }));
    await waitFor(() => expect(traceDataSource.traceInterfacePhysical).toHaveBeenCalledWith({
      from_interface_id: 'eth0-id', to_interface_id: 'eth0-id',
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

  it('loads the catalog through L1 / PHYSICAL_OBJECT and renders factual columns', async () => {
    const { dataSource } = renderApp('/infrastructure/objects');
    expect(await screen.findByRole('heading', { name: 'Объекты' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PP1' })).toBeInTheDocument();
    expect(screen.getByText('patch_panel')).toBeInTheDocument();
    expect(dataSource.loadProjection).toHaveBeenCalledWith(PHYSICAL_PROJECTION_REQUEST);
  });

  it('links an object row to the canonical detail URL', async () => {
    renderApp('/infrastructure/objects');
    expect(await screen.findByRole('link', { name: 'PP1' })).toHaveAttribute(
      'href', `/infrastructure/objects/${ppId}`,
    );
  });

  it('loads PhysicalObjectDetailsDocument on object detail and links back to canonical map focus', async () => {
    const loadPhysicalObjectDetails = vi.fn().mockResolvedValue(ppDetails);
    renderApp(`/infrastructure/objects/${ppId}`, {
      physicalObjectDetailsDataSource: { loadPhysicalObjectDetails },
    });
    expect(await screen.findByRole('heading', { name: 'PP1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Port01' })).toBeInTheDocument();
    expect(loadPhysicalObjectDetails).toHaveBeenCalledWith(ppId);
    expect(screen.getByRole('link', { name: 'Показать на карте' })).toHaveAttribute(
      'href', `/map?view=physical&focus=${ppId}`,
    );
  });

  it('reuses existing detail write sections for active objects', async () => {
    renderApp(`/infrastructure/objects/${swId}`, {
      deviceInterfaceWriteDataSource: { createDeviceInterface: vi.fn() },
      connectionPointWriteDataSource: { createConnectionPoint: vi.fn() },
      physicalObjectClassWriteDataSource: { setPhysicalObjectClass: vi.fn() },
    });
    expect(await screen.findByRole('heading', { name: 'SW1' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '+ Добавить интерфейс' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Добавить точку' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить тип' })).toBeInTheDocument();
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

  it('keeps loading, error, and empty map states working', async () => {
    const pending: TopologyDataSource = {
      loadProjection: vi.fn(() => new Promise<TopologyProjectionDocument>(() => undefined)),
    };
    const { unmount } = render(
      <MemoryRouter initialEntries={['/map']}>
        <App dataSource={pending} deviceDetailsDataSource={{ loadDeviceDetails: vi.fn() }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Загружаем topology projection')).toBeInTheDocument();
    unmount();

    renderApp('/map', { dataSource: { loadProjection: vi.fn().mockRejectedValue(new Error('backend unavailable')) } });
    expect(await screen.findByText('backend unavailable')).toBeInTheDocument();
  });

  it('renders the catalog empty state without inventing objects', async () => {
    renderApp('/infrastructure/objects', {
      dataSource: { loadProjection: vi.fn().mockResolvedValue({ ...physicalDocument, nodes: [], edges: [] }) },
    });
    expect(await screen.findByText('В этом scope пока пусто')).toBeInTheDocument();
  });
});
