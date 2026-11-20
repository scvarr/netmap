import { selectCableType, stubCableCatalog } from '../testCableCatalog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { BulkPhysicalConnectionError } from '../topology/apiPhysicalEndpointConnectionWriteDataSource';
import type { ConnectionPointDetails, PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import type { TopologyProjectionDocument } from '../topology/types';
import { MapPage } from './MapPage';
import { createMapPageHarness } from './MapPage.testHarness';

beforeEach(stubCableCatalog);
afterEach(() => vi.unstubAllGlobals());

vi.mock('../components/TopologyCanvas', () => ({ TopologyCanvas: (props: any) => <div data-testid="bulk-canvas">
  <button onClick={() => props.onPhysicalNodeContextMenu?.(nodes[0], { x: 20, y: 20 })}>source object menu</button>
  <output data-testid="port-count">{props.document?.nodes?.length}</output>
</div> }));

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });
const ports = Array.from({ length: 48 }, (_, i) => i + 1);
const points = (id: string): ConnectionPointDetails[] => ports.map(index => ({
  connection_point_ref: ref('ConnectionPoint', `${id}${index}`),
  label: `P${index}`, cardinality: 1, external_connection_count: 0,
  incident_connection_count: 0, direct_interface_binding_count: 0, source_refs: [],
  panel_context: id === 'a' ? { panel_key: 'main', panel_name: 'Panel', port_name: `P${index}` } : undefined,
}));
const panels = [
  { panel_key: 'main', display_name: 'Panel', panel_number: 1, face: 'REAR' as const },
  { panel_key: 'other', display_name: 'Panel', panel_number: 2, face: 'REAR' as const },
  { panel_key: 'front', display_name: 'Лицевая', panel_number: 3, face: 'FRONT' as const },
  { panel_key: 'aux', display_name: 'Aux', panel_number: 4 },
];
const details = (id: string): PhysicalObjectDetailsDocument => ({
  schema_version: '1.0', physical_object: { source_ref: ref('PhysicalObject', id), label: id.toUpperCase() },
  panels: id === 'a' ? panels : undefined,
  connection_points: id === 'a' ? [
    ...points('a'),
    { ...points('a')[0], connection_point_ref: ref('ConnectionPoint', 'other'), panel_context: { panel_key: 'other', panel_name: 'Panel', port_name: 'Other' } },
    { ...points('c')[0], label: 'Loose' },
  ] : points(id),
  owned_interface_count: 0, gaps: [], warnings: [],
});
const nodes: TopologyProjectionDocument['nodes'] = ['a', 'b', 'c'].map(id => ({
  id, kind: 'PHYSICAL_OBJECT', label: id.toUpperCase(), source_refs: [ref('PhysicalObject', id)], attributes: { class: 'switch' },
}));
const doc: TopologyProjectionDocument = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes, edges: [], gaps: [], warnings: [] };
const map = { map_ref: ref('SavedMap', 'map'), active_variant_ref: ref('MapPresentationVariant', 'variant'), variants: [], name: 'Map', placements: nodes.map(node => ({ physical_object_ref: ref('PhysicalObject', node.id), positions: { 'L1/PHYSICAL_OBJECT': { x: 0, y: 0 } } })) };
const renderPage = createMapPageHarness(MapPage);

function setup() {
  const projection = vi.fn().mockResolvedValue(doc);
  const create = vi.fn().mockResolvedValue({ created: [] });
  const preview = vi.fn().mockResolvedValue({ labels: [{ label: 'B001', historical: true }] });
  const loadDetails = vi.fn(async (id: string) => details(id));
  renderPage({
    dataSource: { loadProjection: projection },
    savedMapDataSource: { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map) } as any,
    physicalObjectDetailsDataSource: { loadPhysicalObjectDetails: loadDetails },
    physicalEndpointConnectionWriteDataSource: { createPhysicalEndpointConnection: vi.fn(), createBulkPhysicalConnections: create, previewBulkCableLabels: preview },
    cableLabelDataSource: { loadCableLabelTemplates: vi.fn().mockResolvedValue({ templates: [{ id: 'template', name: 'Bulk' }] }) } as any,
  }, '/map?map=map&variant=variant&view=physical');
  return { create, preview, projection, loadDetails };
}

const select = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });
const button = (name: string) => screen.getByRole('button', { name });
const side = (name: 'Источник' | 'Назначение') => within(screen.getByRole('region', { name }));
const left = () => side('Источник');
const right = () => side('Назначение');
const match = () => fireEvent.click(button('Сопоставить'));
const review = () => fireEvent.click(button('Предпросмотр'));
const confirm = () => fireEvent.click(button('Подтвердить создание'));
const check = (scope: ReturnType<typeof side>, port: number) => fireEvent.click(scope.getByRole('checkbox', { name: `P${port}` }));

async function start() {
  await screen.findByTestId('bulk-canvas');
  fireEvent.click(button('source object menu'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Массовое подключение' }));
  select(screen.getByLabelText('Целевой физический объект'), 'b');
  await left().findByRole('checkbox', { name: 'P48' });
  await right().findByRole('checkbox', { name: 'P48' });
}

async function selectOne() {
  check(left(), 1);
  check(right(), 1);
  match();
  review();
  await selectCableType();
}

describe('MapPage bulk cable editor', () => {
  it.each([false, true])('freezes and submits all 48 pairs in visible numeric order (reverse=%s)', async reverse => {
    const { create, projection } = setup();
    await start();
    expect(left().getAllByRole('checkbox')).toHaveLength(48);
    fireEvent.click(left().getByRole('button', { name: 'Выбрать все свободные' }));
    expect(button('Сопоставить')).toBeDisabled();
    expect(screen.getByText(/одинаковое количество/)).toBeVisible();
    fireEvent.click(right().getByRole('button', { name: 'Выбрать все свободные' }));
    if (reverse) select(right().getByLabelText('Сортировка'), 'descending');
    expect(left().getAllByRole('checkbox')[0]).toHaveAccessibleName('P1');
    const firstTarget = reverse ? 48 : 1;
    expect(right().getAllByRole('checkbox')[0]).toHaveAccessibleName(`P${firstTarget}`);
    match();
    select(left().getByLabelText('Сортировка'), 'descending');
    select(right().getByLabelText('Сортировка'), reverse ? 'ascending' : 'descending');
    review();
    await selectCableType();
    expect(screen.getByText('Кабели к созданию (48)')).toBeVisible();
    expect(screen.getByText(`B / Без панели / P${firstTarget}`)).toBeVisible();
    expect(create).not.toHaveBeenCalled();
    const reads = projection.mock.calls.length;
    await waitFor(() => expect(button('Подтвердить создание')).toBeEnabled());
    confirm();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0].pairs.map(({ source, target }: any) =>
      [source.connection_point_id, target.connection_point_id])).toEqual(ports.map(port => [`a${port}`, `b${reverse ? 49 - port : port}`]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(projection).toHaveBeenCalledTimes(reads + 1);
  });

  it('matches 12 selected ports, swaps destinations and excludes one pair', async () => {
    const { create } = setup();
    await start();
    for (const port of ports.filter(port => port % 4 === 0)) {
      check(left(), port);
      check(right(), port);
    }
    match();
    expect(screen.getByText('Сопоставленные пары (12)')).toBeVisible();
    select(screen.getByRole('combobox', { name: /Назначение для A .* P4$/ }), 'b8');
    expect(screen.getByRole('combobox', { name: /Назначение для A .* P8$/ })).toHaveValue('b4');
    fireEvent.click(screen.getAllByRole('button', { name: 'Исключить' })[2]);
    review();
    await selectCableType();
    expect(screen.getByText('Кабели к созданию (11)')).toBeVisible();
    await waitFor(() => expect(button('Подтвердить создание')).toBeEnabled());
    confirm();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const pairs = create.mock.calls[0][0].pairs;
    expect(pairs.slice(0, 2).map(({ target }: any) => target.connection_point_id)).toEqual(['b8', 'b4']);
    expect(pairs.some(({ source }: any) => source.connection_point_id === 'a12')).toBe(false);
  });

  it('uses panel keys for duplicate names and clears pairs on panel or object change', async () => {
    setup();
    await start();
    const panel = left().getByLabelText('Панель');
    expect(within(panel).getAllByRole('option').map(option => (option as HTMLOptionElement).value))
      .toEqual(['main', 'other', 'front', 'aux', '']);
    expect(right().getByLabelText('Панель')).toHaveValue('');
    check(left(), 1);
    check(right(), 1);
    match();
    select(panel, 'other');
    expect(left().getByRole('checkbox', { name: 'Other' })).toBeVisible();
    expect(button('Предпросмотр')).toBeDisabled();
    select(panel, '');
    fireEvent.click(left().getByRole('checkbox', { name: 'Loose' }));
    match();
    expect(button('Предпросмотр')).toBeEnabled();
    select(screen.getByLabelText('Целевой физический объект'), 'c');
    expect(button('Предпросмотр')).toBeDisabled();
    expect(await right().findByRole('checkbox', { name: 'P1' })).not.toBeChecked();
  });

  it('previews names, requires historical consent and clears consent on a stale preview', async () => {
    const { create, preview } = setup();
    create.mockRejectedValueOnce(new BulkPhysicalConnectionError(422, 'BULK_LABEL_PREVIEW_STALE'));
    preview.mockResolvedValueOnce({ labels: [{ label: 'B001', historical: true }] })
      .mockResolvedValueOnce({ labels: [{ label: 'B009', historical: true }] });
    await start();
    await selectOne();
    await screen.findByRole('option', { name: 'Bulk' });
    select(screen.getByLabelText('Имена кабелей'), 'template');
    expect(await screen.findByText('B001')).toBeVisible();
    expect(button('Подтвердить создание')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Подтвердить повторное использование B001'));
    confirm();
    expect(await screen.findByText('B009')).toBeVisible();
    expect(button('Подтвердить создание')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Подтвердить повторное использование B009'));
    confirm();
    await waitFor(() => expect(create).toHaveBeenLastCalledWith(expect.objectContaining({
      expected_generated_labels: ['B009'], confirmed_historical_labels: ['B009'],
    })));
  });

  it('reloads canonical port occupancy after a conflict and leaves the occupied port visible', async () => {
    const { create, loadDetails } = setup();
    create.mockRejectedValueOnce(new BulkPhysicalConnectionError(422, 'CONNECTION_POINT_MEMBER_OCCUPIED'));
    await start();
    await selectOne();
    loadDetails.mockImplementation(async id => {
      const document = details(id);
      if (id === 'b') {
        document.connection_points[0].external_connection_count = 1;
        document.connection_points[0].external_physical_attachments = [{
          kind: 'CABLE', connection_ref: ref('Connection', 'l'), evidence_refs: [],
          cable_label: 'C1', remote_physical_object_label: 'Remote', remote_panel_name: 'Rear', remote_connection_point_label: 'R1',
        }];
      }
      return document;
    });
    await waitFor(() => expect(button('Подтвердить создание')).toBeEnabled());
    confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('Порты изменились или уже заняты.');
    fireEvent.click(button('Повторить обновление'));
    expect(await right().findByRole('checkbox', { name: 'P1' })).toBeDisabled();
    expect(right().getByText('C1 · Remote / Rear / R1')).toBeVisible();
    expect(button('Предпросмотр')).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('retries only the projection read after acknowledged creation', async () => {
    const { create, projection } = setup();
    await start();
    await selectOne();
    projection.mockRejectedValueOnce(new Error('refresh failed'));
    await waitFor(() => expect(button('Подтвердить создание')).toBeEnabled());
    confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('Соединения созданы, но карту не удалось обновить.');
    expect(screen.queryByRole('button', { name: 'Подтвердить создание' })).not.toBeInTheDocument();
    fireEvent.click(button('Повторить обновление'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(create).toHaveBeenCalledTimes(1);
  });
});
