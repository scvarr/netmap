import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CableDeleteRequestError } from '../topology/apiCableDeleteDataSource';
import { MapPage } from './MapPage';
import { createMapPageHarness } from './MapPage.testHarness';

vi.mock('../components/TopologyCanvas', () => ({
  TopologyCanvas: ({ onPhysicalNodeContextMenu, document }: any) => <>
    <button onClick={() => onPhysicalNodeContextMenu(document.nodes[0], { x: 20, y: 20 })}>Object menu</button>
    <output data-testid="scene">{document.warnings.join()}</output>
  </>,
}));

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT', entity_type, entity_id });
const nodes = ['a', 'b'].map(id => ({ id, kind: 'PHYSICAL_OBJECT', label: id.toUpperCase(), source_refs: [ref('PhysicalObject', id)], attributes: {} }));
const doc: any = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes, edges: [], gaps: [], warnings: [] };
const map: any = { map_ref: ref('SavedMap', 'map'), active_variant_ref: ref('MapPresentationVariant', 'variant'), variants: [], name: 'Map', placements: nodes.map(node => ({ physical_object_ref: ref('PhysicalObject', node.id), positions: { 'L1/PHYSICAL_OBJECT': { x: 0, y: 0 } } })) };
const candidates = [1, 2].map(i => ({
  expected: {
    cable_id: `c${i}`, connection_id: `connection-${i}`, point_a_id: `a${i}`, point_b_id: `b${i}`, cardinality: 1,
    label: ['Z', 'A'][i - 1], members: [{ id: `member-${i}`, index: 1, point_a_member: 1, point_b_member: 1 }],
  },
  display_label: ['Z', 'A'][i - 1], source_point_label: `port ${i}`, target_point_label: `peer ${i}`,
  source_is_point_a: true, source_member_designations: [`A${i}`], target_member_designations: [`B${i}`],
}));
const click = (name: string, role = 'button') => fireEvent.click(screen.getByRole(role, { name }));
const pair = { source_object_id: 'a', target_object_id: 'b' };

async function start() {
  const preview = vi.fn().mockResolvedValue({ cables: candidates });
  const remove = vi.fn().mockResolvedValue(undefined);
  const projection = vi.fn().mockResolvedValue(doc);
  const loadMap = vi.fn().mockResolvedValue(map);
  createMapPageHarness(MapPage)({
    dataSource: { loadProjection: projection },
    savedMapDataSource: { listMaps: vi.fn().mockResolvedValue([map]), loadMap } as any,
    cableDeleteDataSource: { deleteCable: vi.fn(), previewBulkDelete: preview, bulkDelete: remove },
  }, '/map?map=map&view=physical');
  fireEvent.click(await screen.findByRole('button', { name: 'Object menu' }));
  click('Массовое удаление кабелей', 'menuitem');
  fireEvent.change(screen.getByLabelText('Второй физический объект'), { target: { value: 'b' } });
  click('Показать кабели');
  await screen.findByRole('table');
  expect(preview).toHaveBeenCalledWith(pair);
  return { remove, projection, loadMap };
}

it('keeps selection by Cable ID through sorting and confirms only the previewed subset', async () => {
  const { remove, projection, loadMap } = await start();
  click('Выбрать все');
  expect(screen.getAllByRole('checkbox').every(box => (box as HTMLInputElement).checked)).toBe(true);
  click('Снять выбор');
  expect(screen.getAllByRole('checkbox').some(box => (box as HTMLInputElement).checked)).toBe(false);
  click('Z · port 1 · A1 ↔ peer 1 · B1', 'checkbox');
  click('Кабель');
  expect(screen.getAllByRole('checkbox')[1]).toBeChecked();
  click('Проверить выбранные');
  const dialog = screen.getByRole('dialog', { name: 'Массовое удаление кабелей' });
  expect(within(dialog).getByRole('status')).toHaveTextContent('кабели (1) и их физические соединения (1)');
  expect(screen.getAllByRole('row')).toHaveLength(2);
  expect(screen.getByRole('cell', { name: 'Z' })).toBeVisible();
  expect(screen.getByRole('cell', { name: 'port 1 · A1' })).toBeVisible();
  expect(screen.getByRole('cell', { name: 'peer 1 · B1' })).toBeVisible();
  expect(remove).not.toHaveBeenCalled();
  let acknowledge!: () => void;
  remove.mockReturnValueOnce(new Promise<void>(resolve => { acknowledge = resolve; }));
  projection.mockResolvedValueOnce({ ...doc, warnings: ['refreshed'] });
  click('Подтвердить удаление');
  expect(screen.getByRole('button', { name: 'Подтвердить удаление' })).toBeDisabled();
  click('Подтвердить удаление');
  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith(pair, [candidates[0].expected]);
  acknowledge();
  await waitFor(() => expect(screen.getByTestId('scene')).toHaveTextContent('refreshed'));
  expect(loadMap).toHaveBeenLastCalledWith('map', 'variant');
});

it('asks for a fresh preview on conflict and retries only reads after acknowledged deletion', async () => {
  const { remove, projection } = await start();
  remove.mockRejectedValueOnce(new CableDeleteRequestError(409));
  click('Выбрать все');
  click('Проверить выбранные');
  click('Подтвердить удаление');
  expect(await screen.findByRole('alert')).toHaveTextContent('Загрузите список заново');
  expect(screen.queryByRole('button', { name: 'Подтвердить удаление' })).toBeNull();
  click('Показать кабели');
  await screen.findByRole('table');
  click('Выбрать все');
  click('Проверить выбранные');
  projection.mockRejectedValueOnce(new Error('refresh failed'));
  click('Подтвердить удаление');
  expect(await screen.findByRole('alert')).toHaveTextContent('Кабели удалены, но карту не удалось обновить');
  click('Повторить обновление');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Массовое удаление кабелей' })).toBeNull());
  expect(remove).toHaveBeenCalledTimes(2);
});
