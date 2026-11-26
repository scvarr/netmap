import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExactMemberTracePanel, InterfaceTracePanel } from './ExactMemberTracePanel';
import type { ExactMemberTrace, ExpectedMemberPair } from '../topology/exactMemberTrace';
import type { TopologyProjectionDocument } from '../topology/types';
import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });
const equipment = ['a', 'b'].map(id => ({
  physical_object_ref: ref('PhysicalObject', id), label: 'Chassis', map_memberships: [],
}));
const details = {
  async loadPhysicalObjectDetails(id: string): Promise<PhysicalObjectDetailsDocument> {
    return {
      schema_version: '1.0',
      physical_object: { source_ref: ref('PhysicalObject', id), label: 'Chassis' },
      connection_points: ['1', '2'].map(bay => ({
        connection_point_ref: ref('ConnectionPoint', id + bay),
        label: 'MPO', cardinality: 3, incident_connection_count: 1, direct_interface_binding_count: 1,
        members: [1, 2, 3].map(index => ({ index, designation: String(index), occupied: index !== 3 })),
        panel_context: { panel_key: 'rear', panel_name: 'Rear', bay_name: 'Bay ' + bay, module_name: 'Cassette', port_name: 'MPO' },
        direct_interface_bindings: [{ interface_ref: ref('NetworkInterface', id + '-iface'), label: 'optical', evidence_refs: [] }],
        source_refs: [],
      })),
      owned_interface_count: 1, gaps: [], warnings: [],
    };
  },
};
const address = (point_id: string, member_index: number) => ({ point_id, member_index });
const pair = (from = 1, to = 2): ExpectedMemberPair => ({ from: address('a2', from), to: address('b1', to) });
const edge = (id: string, to = 'target') => ({ id, from_node_id: 'source', to_node_id: to,
  evidence_refs: [ref('Connection', 'connection'), ref('ConnectionMember', id)],
});
const trace = (query: ExpectedMemberPair, reason: ExactMemberTrace['terminations'][number]['reason'] = 'EXPECTED_MEMBER') => ({
  schema_version: 1, query, verdict: reason === 'EXPECTED_MEMBER' ? 'REACHABLE' : 'UNKNOWN',
  nodes: [
    { id: 'source', payload: query.from, canonical_refs: [ref('ConnectionPoint', query.from.point_id)] },
    { id: 'target', payload: query.to, canonical_refs: [ref('ConnectionPoint', query.to.point_id)] },
  ],
  edges: reason === 'NO_CONNECTION' ? [] : [edge('proven')],
  terminations: [{ node_id: reason === 'NO_CONNECTION' ? 'source' : 'target', reason }],
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

afterEach(() => vi.unstubAllGlobals());

async function setup(group = false) {
  const user = userEvent.setup();
  const onEvidence = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal('fetch', fetch);
  render(<ExactMemberTracePanel equipment={equipment} details={details} group={group} onEvidence={onEvidence} />);
  await user.selectOptions(screen.getByLabelText('Откуда'), 'a');
  await user.selectOptions(screen.getByLabelText('Куда'), 'b');
  await screen.findAllByRole('option', { name: /Cassette/ });
  return { user, onEvidence, fetch };
}

async function select(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  await user.selectOptions(screen.getByLabelText('Канал источника'), from);
  await user.selectOptions(screen.getByLabelText('Канал назначения'), to);
}

describe('exact member trace panel', () => {
  it('distinguishes same-named objects and installed modules and submits an explicitly selected free member', async () => {
    const { user, onEvidence, fetch } = await setup();
    const picker = within(screen.getByLabelText('Канал источника'));
    expect(picker.getByRole('option', { name: /Chassis .a. \/ Rear \/ Bay 1 \/ Cassette \/ MPO · #3 · свободен/ })).toHaveValue('a1:3');
    expect(picker.getByRole('option', { name: /Chassis .a. \/ Rear \/ Bay 2 \/ Cassette \/ MPO · #3 · свободен/ })).toHaveValue('a2:3');
    await select(user, 'a2:3', 'b1:2');
    const result = trace(pair(3, 2), 'NO_CONNECTION');
    fetch.mockResolvedValue(json(result));
    await user.click(screen.getByRole('button', { name: 'Трассировать' }));
    expect(fetch).toHaveBeenCalledWith('/api/v1/traces/l1', expect.objectContaining({ body: JSON.stringify(pair(3, 2)) }));
    expect(await screen.findByText(/Канал не подключён/)).toBeInTheDocument();
    expect(onEvidence).toHaveBeenLastCalledWith(result);
  });

  it('submits the user-entered subset and permutation, with per-pair partial evidence and canonical errors', async () => {
    const { user, onEvidence, fetch } = await setup(true);
    const add = () => user.click(screen.getByRole('button', { name: 'Добавить пару' }));
    const verify = () => user.click(screen.getByRole('button', { name: 'Проверить группу' }));
    await select(user, 'a2:1', 'b1:2');
    await add();
    const first = {
      ...trace(pair()), optical_diagnostics: [{
        status: 'CONSISTENT', conflicts: [], facts: [{ source: 'CABLE', value: 'SM', points: [], canonical_refs: [] }],
      }],
    };
    fetch.mockResolvedValueOnce(json({ results: [first], completeness: 'COMPLETE' }));
    await verify();
    expect(await screen.findByText(/COMPLETE ·/)).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/traces/l1/group', expect.objectContaining({
      body: JSON.stringify({ expected_pairs: [pair()] }),
    }));
    await select(user, 'a2:2', 'b1:1');
    await add();
    expect(screen.queryByText(/COMPLETE ·/)).not.toBeInTheDocument();
    const broken = {
      ...trace(pair(2, 1), 'INVALID_CANONICAL_DATA'), optical_diagnostics: [{
        status: 'UNKNOWN', reason: 'INCOMPLETE_PATH', conflicts: [], facts: [{
          source: 'MODULE_MEMBER_MAPPING', value: null, points: [pair(2, 1).from], canonical_refs: [],
          model_error: { code: 'MODEL_ERROR', reason: 'INVALID_CANONICAL_DATA', detail: 'AMBIGUOUS_MEMBER_MAPPING' },
        }],
      }],
    };
    fetch.mockResolvedValueOnce(json({ results: [first, broken], completeness: 'PARTIAL' }));
    await verify();
    expect(await screen.findByText(/PARTIAL ·/)).toBeInTheDocument();
    expect(screen.getByText(/SM\/MM согласованы.*\(1\).*Недостаточно сведений \(1\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Повреждён источник канонических данных/)).not.toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/traces/l1/group', expect.objectContaining({
      body: JSON.stringify({ expected_pairs: [pair(), pair(2, 1)] }),
    }));
    await user.click(screen.getByRole('button', { name: 'Не удалось подтвердить физический путь L1' }));
    expect(screen.getByText(/Некорректные данные канонической топологии/)).toBeInTheDocument();
    expect(screen.getByText('Подтверждённые участки: 1')).toBeInTheDocument();
    expect(screen.getByText(/Повреждён источник канонических данных.*AMBIGUOUS_MEMBER_MAPPING/))
      .toHaveTextContent(/Cassette \/ MPO · #2/);
    expect(screen.getByText('Физический путь неполон')).toBeInTheDocument();
    expect(onEvidence).toHaveBeenLastCalledWith(broken);
  });

  it('clears stale results and ignores a response after the endpoint changes', async () => {
    const { user, onEvidence, fetch } = await setup();
    let resolve!: (response: Response) => void;
    fetch.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    await select(user, 'a2:1', 'b1:2');
    await user.click(screen.getByRole('button', { name: 'Трассировать' }));
    const signal = fetch.mock.calls[0][1]?.signal;
    await user.selectOptions(screen.getByLabelText('Канал назначения'), 'b1:1');
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(json(trace(pair()))));
    expect(onEvidence).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText('Подтверждённые участки: 1')).not.toBeInTheDocument();
  });

  it.each([
    [409, /Ошибка канонической топологии/], [422, /Проверьте адреса каналов/], [503, /Не удалось выполнить трассировку L1/],
  ] as const)('surfaces HTTP %i and clears previous evidence', async (status, message) => {
    const { user, onEvidence, fetch } = await setup();
    await select(user, 'a2:1', 'b1:2');
    fetch.mockResolvedValueOnce(json(trace(pair()))).mockResolvedValueOnce(json({ error: { code: 'MODEL_ERROR' } }, status));
    const run = screen.getByRole('button', { name: 'Трассировать' });
    await user.click(run);
    expect(await screen.findByText('Физический L1-путь доказан')).toBeInTheDocument();
    await user.click(run);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('Физический L1-путь доказан')).not.toBeInTheDocument();
    expect(onEvidence).toHaveBeenLastCalledWith(null);
  });
});

it('shows only the selected interface branch and never includes a disconnected candidate in evidence', async () => {
  const user = userEvent.setup();
  const onEvidence = vi.fn();
  const levels = ['one', 'two'].map(id => ({ ...edge(id), layer: 'L1', transition_kind: 'L1_TRAVERSE' }));
  const branches = levels.map(level => ({
    branch_id: level.id, source_candidate_id: 'a-' + level.id, target_candidate_id: 'b-' + level.id,
    edge_ids: [level.id], evidence_refs: [],
  }));
  const query = { from_interface_id: 'a-iface', to_interface_id: 'b-iface' };
  const fetch = vi.fn().mockResolvedValue(json({
    schema_version: 1, query, verdict: 'REACHABLE', branches,
    nodes: [], edges: [...levels, edge('disconnected')], gaps: [], warnings: [],
  }));
  vi.stubGlobal('fetch', fetch);
  render(<InterfaceTracePanel equipment={equipment} details={details} onEvidence={onEvidence} />);
  await user.selectOptions(screen.getByLabelText('Откуда'), 'a');
  await user.selectOptions(screen.getByLabelText('Куда'), 'b');
  await waitFor(() => expect(screen.getByLabelText('Интерфейс назначения')).toBeEnabled());
  await user.selectOptions(screen.getByLabelText('Интерфейс источника'), 'a-iface');
  await user.selectOptions(screen.getByLabelText('Интерфейс назначения'), 'b-iface');
  await user.click(screen.getByRole('button', { name: 'Трассировать' }));
  const selectBranch = await screen.findByRole('combobox', { name: /Показать альтернативу/ });
  expect(within(selectBranch).getAllByRole('option')).toHaveLength(2);
  expect(onEvidence).toHaveBeenLastCalledWith({ edges: [levels[0]] });
  await user.selectOptions(selectBranch, 'two');
  expect(onEvidence).toHaveBeenLastCalledWith({ edges: [levels[1]] });
  expect(fetch).toHaveBeenCalledTimes(1);
});


it.each(['on-map', 'off-map', 'details unavailable'] as const)(
  'resolves intermediate canonical addresses and preserves evidence (%s)', async availability => {
    const user = userEvent.setup();
    const onEvidence = vi.fn();
    const first = address('799ee601-4c36-44ff-9ec4-f2aa7499e169', 2);
    const second = address('799ee601-4c36-44ff-9ec4-f2aa7499e170', 3);
    const passive = {
      id: 'passive', kind: 'PHYSICAL_OBJECT', label: 'Passive shelf', source_refs: [ref('PhysicalObject', 'passive')],
      attributes: { connection_points: [first, second].map(({ point_id }) => ({
        connection_point_id: point_id, display_name: 'MPO', cardinality: 3, external_connection_count: 0,
      })) },
    };
    const projection: TopologyProjectionDocument = {
      schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [passive], edges: [], gaps: [], warnings: [],
    };
    const loadProjection = vi.fn().mockResolvedValue(projection);
    const loadPhysicalObjectDetails = vi.fn(async (id: string) => {
      const doc = await details.loadPhysicalObjectDetails(id);
      if (id !== 'passive') return doc;
      if (availability === 'details unavailable') throw new Error('Address lookup failed');
      return {
        ...doc,
        physical_object: { ...doc.physical_object, label: passive.label },
        connection_points: doc.connection_points.map((point, index) => ({
          ...point, connection_point_ref: ref('ConnectionPoint', [first, second][index].point_id),
        })),
      };
    });
    const result = {
      ...trace(pair(), 'MISSING_EXTERNAL_CONNECTION'),
      nodes: [
        trace(pair()).nodes[0],
        { id: 'entry', payload: first, canonical_refs: [ref('ConnectionPoint', first.point_id)] },
        { id: 'ending', payload: second, canonical_refs: [ref('ConnectionPoint', second.point_id)] },
      ],
      edges: [edge('incoming', 'entry'), { ...edge('internal', 'ending'), from_node_id: 'entry' }],
      terminations: [{ node_id: 'ending', reason: 'MISSING_EXTERNAL_CONNECTION' }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(result)));
    render(<ExactMemberTracePanel equipment={equipment} details={{ loadPhysicalObjectDetails }} group={false}
      onEvidence={onEvidence} projection={availability === 'off-map' ? { ...projection, nodes: [] } : projection}
      projectionSource={{ loadProjection }} />);
    await user.selectOptions(screen.getByLabelText('Откуда'), 'a');
    await user.selectOptions(screen.getByLabelText('Куда'), 'b');
    await select(user, 'a2:1', 'b1:2');
    await user.click(screen.getByRole('button', { name: 'Трассировать' }));
    expect(await screen.findByText('Подтверждённые участки: 2')).toBeVisible();
    const segment = 'Passive shelf / Rear / Bay 1 / Cassette / MPO · #2 → Passive shelf / Rear / Bay 2 / Cassette / MPO · #3';
    if (availability === 'details unavailable') {
      expect(await screen.findByText(`Отсутствует внешнее соединение · Адрес недоступен · ${second.point_id} · #3`)).toBeVisible();
      expect(screen.getByText(new RegExp(`Адрес недоступен · ${first.point_id} · #2 →`))).toBeVisible();
    } else {
      expect(await screen.findByText(segment)).toBeVisible();
      expect(screen.getByText('Отсутствует внешнее соединение · Passive shelf / Rear / Bay 2 / Cassette / MPO · #3')).toBeVisible();
    }
    expect(onEvidence).toHaveBeenLastCalledWith(result);
    expect(loadPhysicalObjectDetails.mock.calls.filter(([id]) => id === 'passive')).toHaveLength(1);
    expect(loadProjection).toHaveBeenCalledTimes(availability === 'off-map' ? 1 : 0);
  },
);
