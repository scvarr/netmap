import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CableReconnectError } from '../topology/apiCableReconnectDataSource';
import type { ConnectionPointDetails, PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
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
const expected = { connection_id: 'link', connection_member_id: 'wire', point_a_id: 'a1', point_b_id: 'b1', label: 'Cable 12' };
const docs = {
  A: object('A', [point('a1', 'front'), point('a2', 'front')], [panel('front', 1, 'FRONT')]),
  B: object('B', [point('b1')]),
  C: object('C', [point('busy', 'rear', 1), point('wide', 'rear', 0, 2), point('c1', 'rear'), point('c2')], [
    panel('front', 1, 'FRONT'), panel('rear', 2, 'REAR'), panel('rear-2', 3, 'REAR'),
  ]),
};
const select = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

async function open() {
  const preview = vi.fn().mockResolvedValue({ expected, object_a_id: 'A', object_b_id: 'B', display_label: 'Cable 12' });
  const reconnect = vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(<CableReconnectDialog cableId="cable" objects={Object.keys(docs).map(id => ({ id, label: id }))}
    details={{ loadPhysicalObjectDetails: async id => docs[id as keyof typeof docs] }}
    writer={{ preview, reconnect }} refresh={refresh} close={close} />);
  await screen.findByText('B / Без панели / b1');
  return { reconnect, refresh, close };
}

it('chooses the endpoint, object, panel key and free point and reviews both connections', async () => {
  const { reconnect, close } = await open();
  expect(screen.getByText('A / Patch · Спереди / a1')).toBeVisible();
  select('Переносимое окончание', 'B');
  select('Целевой физический объект', 'A');
  expect(await screen.findByRole('option', { name: 'a2 · Недоступен' })).toBeDisabled();
  select('Целевой физический объект', 'C');
  await screen.findByRole('option', { name: 'Patch · Сзади · #3' });
  select('Панель', 'rear');
  expect(screen.getByRole('option', { name: 'busy · Подключён' })).toBeDisabled();
  expect(screen.getByRole('option', { name: 'wide · Недоступен' })).toBeDisabled();
  select('Порт', 'c1');
  click('Предпросмотр');
  expect(screen.getByRole('heading', { name: 'Cable 12' })).toBeVisible();
  expect(screen.getAllByText('A / Patch · Спереди / a1')).toHaveLength(2);
  expect(screen.getByText('B / Без панели / b1')).toBeVisible();
  expect(screen.getByText('C / Patch · Сзади · #2 / c1')).toBeVisible();
  expect(reconnect).not.toHaveBeenCalled();
  click('Подтвердить переподключение');
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(reconnect).toHaveBeenCalledExactlyOnceWith('cable', expected, 'B', 'c1');
});

it.each([false, true])('only retries the read after confirmation (conflict=%s)', async conflict => {
  const { reconnect, refresh, close } = await open();
  if (conflict) reconnect.mockRejectedValueOnce(new CableReconnectError(409));
  else refresh.mockRejectedValueOnce(new Error('projection unavailable'));
  select('Целевой физический объект', 'C');
  await screen.findByRole('option', { name: 'Без панели' });
  select('Панель', '');
  select('Порт', 'c2');
  click('Предпросмотр');
  expect(screen.getByText('C / Без панели / c2')).toBeVisible();
  click('Подтвердить переподключение');
  expect(await screen.findByRole('alert')).toHaveTextContent(conflict ? 'доступность порта изменились' : 'Кабель переподключён');
  expect(refresh).toHaveBeenCalledTimes(conflict ? 0 : 1);
  click('Повторить обновление');
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(reconnect).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledTimes(conflict ? 1 : 2);
});
