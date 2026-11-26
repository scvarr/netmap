import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { BulkPhysicalConnectionError } from '../topology/apiPhysicalEndpointConnectionWriteDataSource';
import type { PhysicalEndpointConnectionWriteDataSource } from '../topology/physicalEndpointConnectionWriteTypes';
import type { ConnectionPointDetails, PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import type { TopologyProjectionDocument } from '../topology/types';
import { MapPage } from './MapPage';
import { createMapPageHarness, objectTraceFixture } from './MapPage.testHarness';

afterEach(() => vi.unstubAllGlobals());

vi.mock('../components/TopologyCanvas', () => ({ TopologyCanvas: (props: any) => <div data-testid="bulk-canvas">
  <button onClick={() => props.onPhysicalNodeContextMenu?.(nodes[0], { x: 20, y: 20 })}>source object menu</button>
  <output data-testid="trace-visual">{String(props.traceOwnsFaces)}:{props.traceOverlay?.highlightedNodeIds.size}</output>
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

function setup(
  previewCompatibility?: PhysicalEndpointConnectionWriteDataSource['previewBulkPhysicalConnections'],
  objectDetails = details,
  tracing?: ReturnType<typeof objectTraceFixture>,
) {
  const projection = vi.fn().mockResolvedValue(doc);
  const create = vi.fn().mockResolvedValue({ created: [] });
  const preview = vi.fn().mockResolvedValue({ labels: ['B001'] });
  const loadDetails = vi.fn(async (id: string) => objectDetails(id));
  renderPage({
    traceDataSource: tracing?.traceDataSource,
    catalogInventoryDataSource: tracing?.catalogInventoryDataSource,
    dataSource: { loadProjection: projection },
    savedMapDataSource: { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map) } as any,
    physicalObjectDetailsDataSource: { loadPhysicalObjectDetails: loadDetails },
    physicalEndpointConnectionWriteDataSource: { createPhysicalEndpointConnection: vi.fn(), createBulkPhysicalConnections: create,
      previewBulkCableLabels: preview, previewBulkPhysicalConnections: previewCompatibility },
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

async function start(lastSource = 'P48', lastTarget = 'P48') {
  await screen.findByTestId('bulk-canvas');
  fireEvent.click(button('source object menu'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Массовое подключение' }));
  select(screen.getByLabelText('Целевой физический объект'), 'b');
  await left().findByRole('checkbox', { name: lastSource });
  await right().findByRole('checkbox', { name: lastTarget });
}

async function selectOne() {
  check(left(), 1);
  check(right(), 1);
  match();
  review();

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
    if (reverse) select(right().getByLabelText('Порядок окончаний'), 'descending');
    expect(left().getAllByRole('checkbox')[0]).toHaveAccessibleName('P1');
    const firstTarget = reverse ? 48 : 1;
    expect(right().getAllByRole('checkbox')[0]).toHaveAccessibleName(`P${firstTarget}`);
    match();
    expect(screen.getByRole('region', { name: 'Сопоставленные пары (48)' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Источник' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Назначение' })).not.toBeInTheDocument();
    fireEvent.click(button('К выбору портов'));
    expect(left().getByRole('checkbox', { name: 'P48' })).toBeChecked();
    match();
    review();

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
    select(screen.getByRole('combobox', { name: /Назначение для A .* P4$/ }), 'b8/1');
    expect(screen.getByRole('combobox', { name: /Назначение для A .* P8$/ })).toHaveValue('b4/1');
    fireEvent.click(screen.getAllByRole('button', { name: 'Исключить' })[2]);
    review();

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
    fireEvent.click(button('К выбору портов'));
    select(left().getByLabelText('Панель'), 'other');
    expect(left().getByRole('checkbox', { name: 'Other' })).toBeVisible();
    expect(button('Сопоставить')).toBeDisabled();
    select(left().getByLabelText('Панель'), '');
    fireEvent.click(left().getByRole('checkbox', { name: 'Loose' }));
    match();
    expect(button('Предпросмотр')).toBeEnabled();
    fireEvent.click(button('К выбору портов'));
    select(screen.getByLabelText('Целевой физический объект'), 'c');
    expect(button('Сопоставить')).toBeDisabled();
    expect(await right().findByRole('checkbox', { name: 'P1' })).not.toBeChecked();
  });

  it('previews reusable names and refreshes stale names before another write', async () => {
    const { create, preview } = setup();
    create.mockRejectedValueOnce(new BulkPhysicalConnectionError(422, 'BULK_LABEL_PREVIEW_STALE'));
    preview.mockResolvedValueOnce({ labels: ['B001'] }).mockResolvedValueOnce({ labels: ['B009'] });
    await start();
    await selectOne();
    await screen.findByRole('option', { name: 'Bulk' });
    select(screen.getByLabelText('Имена кабелей'), 'template');
    expect(await screen.findByText('B001')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    confirm();
    expect(await screen.findByText('B009')).toBeVisible();
    expect(create).toHaveBeenCalledTimes(1);
    confirm();
    await waitFor(() => expect(create).toHaveBeenLastCalledWith(expect.objectContaining({
      expected_generated_labels: ['B009'],
    })));
  });

  it('groups compatibility, reveals the individual denial and clears confirmation on edits', async () => {
    const denied = [{ pair: 1, verdict: 'DENY', reasons: ['MEDIUM_MISMATCH'] }];
    const unknown = [{ pair: 1, verdict: 'UNKNOWN', reasons: ['PORT_COMPATIBILITY_UNDEFINED'] }];
    const compatibility = vi.fn().mockResolvedValueOnce({ verdict: 'DENY', token: null, pairs: denied })
      .mockResolvedValueOnce({ verdict: 'UNKNOWN', token: 'first', pairs: unknown })
      .mockResolvedValueOnce({ verdict: 'UNKNOWN', token: 'second', pairs: unknown });
    const { create } = setup(compatibility);
    await start();
    await selectOne();
    await waitFor(() => expect(button('Проверить совместимость')).toBeEnabled());
    fireEvent.click(button('Проверить совместимость'));
    expect(await screen.findByRole('alert')).toHaveTextContent('DENY');
    expect(screen.getByText(/среды физических окончаний различаются.*пар: 1/)).toBeVisible();
    expect(button('Подтвердить создание')).toBeDisabled();
    fireEvent.click(screen.getByText('Подробности по парам'));
    select(screen.getByLabelText('Номер пары'), '1');
    expect(screen.getByText(/Пара 1.*DENY.*среды физических окончаний различаются/)).toBeVisible();
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(button('Назад'));
    review();
    await waitFor(() => expect(button('Проверить совместимость')).toBeEnabled());
    fireEvent.click(button('Проверить совместимость'));
    const consent = 'Подтверждение физической совместимости';
    await screen.findByText('Совместимость · UNKNOWN');
    confirm();
    const first = await screen.findByRole('dialog', { name: consent });
    fireEvent.click(within(first).getByRole('button', { name: 'Отмена' }));
    expect(create).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('Имена кабелей')).toBeEnabled());
    await screen.findByRole('option', { name: 'Bulk' });
    select(screen.getByLabelText('Имена кабелей'), 'template');
    expect(await screen.findByText('B001')).toBeVisible();
    fireEvent.click(button('Проверить совместимость'));
    await screen.findByText('Совместимость · UNKNOWN');
    confirm();
    const fresh = await screen.findByRole('dialog', { name: consent });
    fireEvent.click(within(fresh).getByRole('button', { name: 'Подтвердить и создать' }));
    await waitFor(() => expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      compatibility: { token: 'second', accept_unknown: true },
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
    expect(button('Сопоставить')).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('invalidates trace at acknowledged creation and retries only reads (pending trace: %s)', async pending => {
    const tracing = objectTraceFixture('a', 'b');
    let finishTrace!: (artifact: typeof tracing.artifact) => void;
    if (pending) tracing.trace.mockReturnValueOnce(new Promise(resolve => { finishTrace = resolve; }));
    const { create, projection } = setup(undefined, details, tracing);
    await screen.findByTestId('bulk-canvas');
    await tracing.submit();
    if (!pending) {
      expect(await screen.findByText('Физический L1-путь доказан')).toBeVisible();
      expect(screen.getByTestId('trace-visual')).toHaveTextContent('true:1');
    }
    await start();
    await selectOne();
    let failRefresh!: (reason: Error) => void;
    projection.mockReturnValueOnce(new Promise((_, reject) => { failRefresh = reject; }));
    await waitFor(() => expect(button('Подтвердить создание')).toBeEnabled());
    confirm();
    await waitFor(() => expect(failRefresh).toBeDefined());
    if (pending) await act(async () => finishTrace(tracing.artifact));
    expect(screen.queryByText('Физический L1-путь доказан')).not.toBeInTheDocument();
    expect(screen.getByTestId('trace-visual')).toHaveTextContent('false:0');
    await act(async () => failRefresh(new Error('refresh failed')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Соединения созданы, но карту не удалось обновить.');
    expect(screen.queryByRole('button', { name: 'Подтвердить создание' })).not.toBeInTheDocument();
    fireEvent.click(button('Повторить обновление'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(create).toHaveBeenCalledTimes(1);
  });
});

function memberDetails(sourceCapacities: number[], targetCapacities: number[], occupiedTarget?: string) {
  return (id: string): PhysicalObjectDetailsDocument => ({
    ...details(id),
    connection_points: (id === 'a' ? sourceCapacities : targetCapacities).map((cardinality, index) => ({
      ...points(id)[0],
      connection_point_ref: ref('ConnectionPoint', `${id}${index + 1}`),
      panel_context: id === 'a' ? { panel_key: 'main', panel_name: 'Panel', port_name: `P${index + 1}` } : undefined,
      label: `P${index + 1}`,
      cardinality,
      members: Array.from({ length: cardinality }, (_, offset) => ({
        index: offset + 1, designation: `M${offset + 1}`,
        occupied: id === 'b' && occupiedTarget === `${index + 1}/${offset + 1}`,
      })),
    })),
  });
}

const allow = vi.fn(async ({ pairs }: Parameters<NonNullable<PhysicalEndpointConnectionWriteDataSource['previewBulkPhysicalConnections']>>[0]) => ({
  verdict: 'ALLOW' as const, token: 'reviewed',
  pairs: pairs.map((_, index) => ({ pair: index + 1, verdict: 'ALLOW' as const, reasons: [] })),
}));

function range(scope: ReturnType<typeof side>, from: string, to = '', unit = 'channels') {
  select(scope.getByLabelText('Диапазон'), unit);
  select(scope.getByLabelText('Начало'), from);
  select(scope.getByLabelText('Конец'), to);
  fireEvent.click(scope.getByRole('button', { name: 'Выбрать диапазон' }));
}

async function submitAllowed() {
  review();
  await waitFor(() => expect(button('Проверить совместимость')).toBeEnabled());
  fireEvent.click(button('Проверить совместимость'));
  await screen.findByText('Совместимость · ALLOW');
  confirm();
}

describe('multichannel bulk pairing', () => {
  it('selects a group and forms 96 ordered pairs using endpoint range and destination start', async () => {
    const { create } = setup(allow, memberDetails(Array(48).fill(2), Array(96).fill(1)));
    await start('P48 · M2', 'P96');
    const group = left().getByRole('checkbox', { name: 'Выделить каналы P1' });
    fireEvent.click(left().getByRole('checkbox', { name: 'P1 · M1' }));
    expect(group).toBePartiallyChecked();
    fireEvent.click(group);
    expect(left().getByRole('checkbox', { name: 'P1 · M2' })).toBeChecked();
    range(left(), 'a1', 'a48', 'points');
    range(right(), 'b1/1');
    match();
    expect(screen.getByRole('region', { name: 'Сопоставленные пары (96)' })).toBeVisible();
    await submitAllowed();
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    const { pairs, compatibility } = create.mock.calls[0][0];
    expect(compatibility).toEqual({ token: 'reviewed', accept_unknown: false });
    expect(pairs.map(({ source, target }: any) => [source.connection_point_id, source.member_index, target.connection_point_id]))
      .toEqual(Array.from({ length: 96 }, (_, index) => [`a${Math.floor(index / 2) + 1}`, index % 2 + 1, `b${index + 1}`]));
  }, 20000);

  it.each([
    [[2, 2], [2, 2], false, false, ['a1/1', 'a1/2', 'a2/1', 'a2/2']],
    [[2, 2], [2, 2], false, true, ['a1/2', 'a1/1', 'a2/2', 'a2/1']],
    [[2, 2], [2, 2], true, false, ['a2/1', 'a2/2', 'a1/1', 'a1/2']],
    [[24, 1, 2], Array(27).fill(1), false, false, [
      ...Array.from({ length: 24 }, (_, index) => `a1/${index + 1}`), 'a2/1', 'a3/1', 'a3/2',
    ]],
  ])('keeps endpoint and member order independent (%j to %j, endpoints=%s members=%s)', async (
    source, target, reversePoints, reverseMembers, expected,
  ) => {
    const { create } = setup(allow, memberDetails(source, target));
    await start('P1 · M1', target[0] === 1 ? 'P1' : 'P1 · M1');
    if (reversePoints) select(left().getByLabelText('Порядок окончаний'), 'descending');
    if (reverseMembers) select(left().getByLabelText('Порядок каналов'), 'descending');
    for (const table of [left(), right()]) fireEvent.click(table.getByRole('button', { name: 'Выбрать все свободные' }));
    match();
    await submitAllowed();
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0].pairs.map(({ source }: any) => `${source.connection_point_id}/${source.member_index}`)).toEqual(expected);
  });

  it.each(['positions', 'free'])('keeps free group selection separate from position selection in %s mode', async mode => {
    const { create } = setup(allow, memberDetails([2, 2], [2, 2], '1/2'));
    await start('P1 · M1', 'P1 · M1');
    if (mode === 'free') select(screen.getByLabelText('Режим сопоставления'), 'free');

    const target = right();
    const group = target.getByRole('checkbox', { name: 'Выделить каналы P1' });
    const free = target.getByRole('checkbox', { name: 'P1 · M1' });
    const occupied = target.getByRole('checkbox', { name: 'P1 · M2' });
    expect(occupied).toBeDisabled();
    expect(group).not.toBeChecked();
    fireEvent.click(group);
    expect(group).toBeChecked();
    expect(group).not.toBePartiallyChecked();
    expect(free).toBeChecked();
    expect(occupied).not.toBeChecked();
    fireEvent.click(group);
    expect(group).not.toBeChecked();
    expect(free).not.toBeChecked();

    const secondGroup = target.getByRole('checkbox', { name: 'Выделить каналы P2' });
    const secondMember = target.getByRole('checkbox', { name: 'P2 · M2' });
    fireEvent.click(target.getByRole('checkbox', { name: 'P2 · M1' }));
    expect(secondGroup).toBePartiallyChecked();
    fireEvent.click(secondGroup);
    expect(secondGroup).toBeChecked();
    expect(secondMember).toBeChecked();
    fireEvent.click(secondGroup);
    expect(secondGroup).not.toBeChecked();
    expect(secondGroup).not.toBePartiallyChecked();
    expect(secondMember).not.toBeChecked();

    const allFree = target.getByRole('button', { name: 'Выбрать все свободные' });
    const allPositions = target.queryByRole('button', { name: 'Выбрать все позиции' });
    fireEvent.click(allFree);
    expect(group).toBeChecked();
    expect(secondGroup).toBeChecked();
    expect(occupied).not.toBeChecked();
    if (mode === 'free') {
      expect(allPositions).not.toBeInTheDocument();
      return;
    }

    expect(allPositions).toBeEnabled();
    fireEvent.click(allPositions!);
    expect(occupied).toBeChecked();
    fireEvent.click(group);
    expect(group).not.toBeChecked();
    expect(free).not.toBeChecked();
    expect(occupied).toBeChecked();
    fireEvent.click(group);
    expect(free).toBeChecked();
    expect(occupied).toBeChecked();
    fireEvent.click(allFree);
    expect(occupied).not.toBeChecked();

    fireEvent.click(left().getByRole('button', { name: 'Выбрать все свободные' }));
    fireEvent.click(allPositions!);
    match();
    expect(screen.getByRole('combobox', { name: /Назначение для A .* P1 · M2$/ })).toHaveValue('b1/2');
    expect(screen.getByRole('combobox', { name: /Назначение для A .* P2 · M1$/ })).toHaveValue('b2/1');
    expect(button('Предпросмотр')).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['positions', 'free'])('handles a partially occupied member in %s mode', async mode => {
    const { create } = setup(allow, memberDetails([2, 1], [2, 2], '1/2'));
    await start('P1 · M1', 'P1 · M1');
    if (mode === 'free') select(screen.getByLabelText('Режим сопоставления'), 'free');
    expect(right().getByRole('checkbox', { name: 'P1 · M2' })).toBeDisabled();
    expect(right().getByRole('checkbox', { name: 'Выделить каналы P1' })).toBeEnabled();
    fireEvent.click(left().getByRole('button', { name: 'Выбрать все свободные' }));
    range(right(), 'b2/2');
    expect(right().getByRole('status')).toHaveTextContent('недостаточно каналов');
    range(right(), 'b1/1');
    match();
    if (mode === 'positions') {
      const destination = screen.getByRole('combobox', { name: /Назначение для A .* P1 · M2$/ });
      expect(destination).toHaveValue('b1/2');
      expect(screen.getByRole('combobox', { name: /Назначение для A .* P2 · M1$/ })).toHaveValue('b2/1');
      expect(button('Предпросмотр')).toBeDisabled();
      expect(within(destination).getByRole('option', { name: /P2 · M1$/ })).toBeDisabled();
      select(destination, 'b2/2');
    }
    await submitAllowed();
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0].pairs.map(({ target }: any) => `${target.connection_point_id}/${target.member_index}`))
      .toEqual(mode === 'positions' ? ['b1/1', 'b2/2', 'b2/1'] : ['b1/1', 'b2/1', 'b2/2']);
  });
});
