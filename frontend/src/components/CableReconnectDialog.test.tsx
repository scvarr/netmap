import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CableReconnectError } from '../topology/apiCableReconnectDataSource';
import type { ConnectionPointDetails, PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import type { CableReconnectDataSource } from '../topology/apiCableReconnectDataSource';
import { CableReconnectDialog } from './CableReconnectDialog';

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });
const panel = (panel_key: string, panel_number: number, face: 'FRONT' | 'REAR') =>
  ({ panel_key, panel_number, face, display_name: 'Patch' });
const point = (id: string, panel_key?: string, external_connection_count = 0, cardinality = 1): ConnectionPointDetails => ({
  connection_point_ref: ref('ConnectionPoint', id), label: id, cardinality,
  external_connection_count, incident_connection_count: external_connection_count,
  direct_interface_binding_count: 0, source_refs: [],
  ...(panel_key && { panel_context: { panel_key, panel_name: 'Patch', port_name: id } }),
});
const object = (id: string, connection_points: ConnectionPointDetails[], panels?: PhysicalObjectDetailsDocument['panels']): PhysicalObjectDetailsDocument => ({
  schema_version: '1.0', physical_object: { source_ref: ref('PhysicalObject', id), label: id },
  connection_points, panels, owned_interface_count: 0, gaps: [], warnings: [],
});
const expected = { connection_id: 'link', connection_member_id: 'wire', point_a_id: 'a1', point_b_id: 'b1', point_a_member: 1, point_b_member: 1, label: 'Cable 12' };
const docs = {
  A: object('A', [point('a1', 'front'), point('a2', 'front')], [panel('front', 1, 'FRONT')]),
  B: object('B', [point('b1')]),
  C: object('C', [point('busy', 'rear', 1), point('wide', 'rear', 0, 2), point('c1', 'rear'), point('c2')], [
    panel('front', 1, 'FRONT'), panel('rear', 2, 'REAR'), panel('rear-2', 3, 'REAR'),
  ]),
};
const select = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

const allow = { verdict: 'ALLOW', token: 'allow-token', pairs: [] } as const;
const agreement = { token: 'allow-token', accept_unknown: false };

async function open(documents = docs, previewCompatibility: CableReconnectDataSource['previewCompatibility'] =
  vi.fn().mockResolvedValue(allow), current = expected) {
  const preview = vi.fn().mockResolvedValue({ expected: current, object_a_id: 'A', object_b_id: 'B', display_label: 'Cable 12' });
  const reconnect = vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  const loadDetails = vi.fn(async (id: string) => documents[id as keyof typeof docs]);
  render(<CableReconnectDialog cableId="cable" objects={Object.keys(documents).map(id => ({ id, label: id }))}
    details={{ loadPhysicalObjectDetails: loadDetails }}
    writer={{ preview, previewCompatibility, reconnect }} refresh={refresh} close={close} />);
  await screen.findByText('B / Без панели / b1 · 1');
  return { preview, loadDetails, reconnect, refresh, close };
}

it.each(['DENY', 'UNKNOWN'] as const)('gates reconnect confirmation for %s', async verdict => {
  const check = vi.fn().mockResolvedValue({
    verdict, token: verdict === 'UNKNOWN' ? 'preview-token' : null,
    pairs: [{ pair: 1, verdict, reasons: [verdict === 'DENY' ? 'PORT_TYPES_NOT_ALLOWED' : 'PORT_B_TYPE_UNRESOLVED'] }],
  });
  const { reconnect } = await open(docs, check);
  select('Переносимое окончание', 'B');
  select('Целевой физический объект', 'C');
  await screen.findByRole('option', { name: 'Patch · Сзади · #3' });
  select('Панель', 'rear');
  select('Порт', 'c1');
  click('Предпросмотр');
  const warning = await screen.findByRole('alert');
  const submit = screen.getByRole('button', { name: 'Подтвердить переподключение' });
  expect(check).toHaveBeenCalledExactlyOnceWith('cable', expected, 'B', 'c1', 1);
  if (verdict === 'DENY') expect(submit).toBeDisabled();
  expect(reconnect).not.toHaveBeenCalled();
  if (verdict === 'DENY') {
    expect(warning).toHaveTextContent('режим или матрица запрещает пару типов');
    expect(screen.queryByRole('checkbox')).toBeNull();
  } else {
    expect(warning).toHaveTextContent('достоверный тип окончания B отсутствует');
    fireEvent.click(submit);
    await screen.findByRole('dialog', { name: 'Подтверждение физической совместимости' });
    expect(reconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить и переподключить' }));
    await waitFor(() => expect(reconnect).toHaveBeenCalledExactlyOnceWith('cable', expected, 'B', 'c1', 1, {
      token: 'preview-token', accept_unknown: true,
    }));
  }
});

it('chooses the endpoint, object, panel key and free point and reviews both connections', async () => {
  const { reconnect, close } = await open();
  expect(screen.getByText('A / Patch · Спереди / a1 · 1')).toBeVisible();
  select('Переносимое окончание', 'B');
  expect(screen.getByRole('option', { name: 'A' })).toBeDisabled();
  select('Целевой физический объект', 'C');
  await screen.findByRole('option', { name: 'Patch · Сзади · #3' });
  select('Панель', 'rear');
  expect(screen.getByRole('option', { name: 'busy · Подключён' })).toBeDisabled();
  expect(screen.getByRole('option', { name: 'wide · Недоступен' })).toBeDisabled();
  select('Порт', 'c1');
  click('Предпросмотр');
  expect(await screen.findByRole('heading', { name: 'Cable 12' })).toBeVisible();
  expect(screen.getAllByText('A / Patch · Спереди / a1 · 1')).toHaveLength(2);
  expect(screen.getByText('B / Без панели / b1 · 1')).toBeVisible();
  expect(screen.getByText('C / Patch · Сзади · #2 / c1 · 1')).toBeVisible();
  expect(reconnect).not.toHaveBeenCalled();
  click('Подтвердить переподключение');
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(reconnect).toHaveBeenCalledExactlyOnceWith('cable', expected, 'B', 'c1', 1, agreement);
});

it('sorts shuffled ports by visible name within each physical panel and keeps busy options', async () => {
  const numbers = Array.from({ length: 48 }, (_, index) => String(index + 1));
  const shuffled = numbers.map((_, index) => numbers[(index * 17 + 12) % numbers.length]);
  const numbered = shuffled.map((name, index) => ({
    ...point(name, 'front', name === '13' ? 1 : 0),
    connection_point_ref: ref('ConnectionPoint', `id-${index}`),
    ordering_key: `slot-${index}`,
  }));
  const mixed = ['mgmt', 'xe10', 'console', 'xe2', 'xe1', 'Port 2', 'Port 02'].map(label => point(label, 'rear'));
  await open({ ...docs, C: object('C', [...numbered, ...mixed], docs.C.panels) });
  select('Целевой физический объект', 'C');
  await screen.findByRole('option', { name: '13 · Подключён' });
  const options = () => within(screen.getByLabelText('Порт')).getAllByRole('option').slice(1);
  expect(options().map(item => item.textContent)).toEqual(numbers.map(name => name === '13' ? '13 · Подключён' : name));
  expect(screen.getByRole('option', { name: '13 · Подключён' })).toBeDisabled();
  select('Панель', 'rear');
  expect(options().map(item => item.textContent)).toEqual(['console', 'mgmt', 'Port 02', 'Port 2', 'xe1', 'xe2', 'xe10']);
  select('Панель', 'front');
  expect(options()).toHaveLength(48);
});

it('requires an explicit free member and previews both exact addresses on the same point', async () => {
  const wide = {
    ...point('a1', 'front', 1, 2),
    members: [{ index: 1, designation: 'TX', occupied: true }, { index: 2, designation: 'RX', occupied: false }],
  };
  const check = vi.fn().mockResolvedValue(allow);
  const { reconnect } = await open({
    ...docs, A: object('A', [wide, point('a2', 'front', 2, 2)], docs.A.panels),
  }, check);
  select('Целевой физический объект', 'A');
  expect(await screen.findByRole('option', { name: 'a1' })).toBeEnabled();
  expect(screen.getByRole('option', { name: 'a2 · Подключён' })).toBeDisabled();
  select('Порт', 'a1');
  const review = () => screen.getByRole('button', { name: 'Предпросмотр' });
  expect(review()).toBeDisabled();
  expect(screen.getByRole('option', { name: 'TX · Подключён' })).toBeDisabled();
  expect(screen.getByRole('option', { name: 'RX' })).toBeEnabled();
  select('Канал назначения', '2');
  fireEvent.click(review());
  expect(await screen.findByText('A / Patch · Спереди / a1 · RX')).toBeVisible();
  expect(screen.getByText('A / Patch · Спереди / a1 · TX')).toBeVisible();
  expect(screen.getAllByText('B / Без панели / b1 · 1')).toHaveLength(2);
  click('Назад');
  select('Порт', '');
  select('Порт', 'a1');
  expect(review()).toBeDisabled();
  select('Канал назначения', '2');
  fireEvent.click(review());
  expect(await screen.findByText('A / Patch · Спереди / a1 · RX')).toBeVisible();
  click('Подтвердить переподключение');
  await waitFor(() => expect(reconnect).toHaveBeenCalledExactlyOnceWith('cable', expected, 'A', 'a1', 2, agreement));
  expect(check).toHaveBeenCalledTimes(2);
});

async function reviewUnassignedPoint() {
  select('Целевой физический объект', 'C');
  await screen.findByRole('option', { name: 'Без панели' });
  select('Панель', '');
  select('Порт', 'c2');
  click('Предпросмотр');
  await screen.findByRole('button', { name: 'Подтвердить переподключение' });
}

it('rereads canonical endpoints after 409 and requires a new choice and preview', async () => {
  const { preview, loadDetails, reconnect, refresh, close } = await open();
  reconnect.mockRejectedValueOnce(new CableReconnectError(409));
  await reviewUnassignedPoint();
  click('Подтвердить переподключение');
  expect(await screen.findByRole('alert')).toHaveTextContent('доступность порта изменились');
  const next = { ...expected, point_b_id: 'b2' };
  preview.mockResolvedValueOnce({ expected: next, object_a_id: 'A', object_b_id: 'B', display_label: 'Cable 12' });
  loadDetails.mockImplementation(async id => id === 'B' ? object('B', [point('b2')]) : docs[id as keyof typeof docs]);
  click('Обновить подключение');
  expect(await screen.findByText('B / Без панели / b2 · 1')).toBeVisible();
  expect(screen.queryByText('B / Без панели / b1 · 1')).not.toBeInTheDocument();
  expect(preview.mock.calls).toEqual([['cable'], ['cable']]);
  expect(loadDetails.mock.calls).toEqual([['A'], ['B'], ['C'], ['A'], ['B']]);
  expect(screen.getByLabelText('Целевой физический объект')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Предпросмотр' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Подтвердить переподключение' })).not.toBeInTheDocument();
  expect(reconnect).toHaveBeenCalledOnce();
  expect(refresh).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();

  await reviewUnassignedPoint();
  expect(loadDetails).toHaveBeenLastCalledWith('C');
  expect(screen.getAllByText('B / Без панели / b2 · 1')).toHaveLength(2);
  click('Подтвердить переподключение');
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(reconnect).toHaveBeenNthCalledWith(2, 'cable', next, 'A', 'c2', 1, agreement);
});

it('only retries L1 projection after a successful write', async () => {
  const { preview, loadDetails, reconnect, refresh, close } = await open();
  refresh.mockRejectedValueOnce(new Error('projection unavailable'));
  await reviewUnassignedPoint();
  expect(screen.getByText('C / Без панели / c2 · 1')).toBeVisible();
  click('Подтвердить переподключение');
  expect(await screen.findByRole('alert')).toHaveTextContent('Кабель переподключён');
  expect(refresh).toHaveBeenCalledOnce();
  click('Повторить обновление');
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(reconnect).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(preview).toHaveBeenCalledOnce();
  expect(loadDetails.mock.calls).toEqual([['A'], ['B'], ['C']]);
});
