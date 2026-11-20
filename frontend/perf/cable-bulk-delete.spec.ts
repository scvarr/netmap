import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('deletes a selected Cable and refreshes the same map after a failed read', async ({ page, request }) => {
  const name = `Bulk delete smoke ${randomUUID()}`;
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const portType = await post('/port-types', { name, color: '#336699', medium: 'COPPER', members: ['1'] });
  const cableType = await post('/cable-types', { name, color: '#336699', medium: 'COPPER', construction: 'TWISTED_PAIR' });
  const blueprint = await post('/library/base-templates', {
    name,
    body: { kind: 'RECTANGLE', width: 160, height: 70 },
    panels: [{ panel_key: 'front', panel_number: 1, display_name: 'Front', face: 'FRONT', x: 0, y: 0, width: 160, height: 70 }],
    slots: ['p1', 'p2'].map((key, i) => ({
      key, display_name: key, port_type_id: portType.id, kind: 'CONNECTION_POINT',
      panel_key: 'front', rendered_position: { x: (i + 1) / 3, y: 0.5 },
    })),
    internal_links: [],
  });
  const panel = (display_name: string) => post('/topology/physical-objects', { display_name, base_template_id: blueprint.blueprint_ref.entity_id });
  const source = await panel('Smoke panel A');
  const target = await panel('Smoke panel B');
  const sourceId = source.physical_object_ref.entity_id;
  const targetId = target.physical_object_ref.entity_id;
  const point = (object: typeof source, key: string): string =>
    object.slots.find((slot: { slot_key: string }) => slot.slot_key === key).connection_point_ref.entity_id;
  const endpoint = (connection_point_id: string) => ({ connection_point_id, kind: 'CONNECTION_POINT', member_index: 1 });
  const created = await post('/topology/physical-connections/bulk', {
    cable_type_id: cableType.id,
    pairs: ['p1', 'p2'].map(key => ({ source: endpoint(point(source, key)), target: endpoint(point(target, key)) })),
  });
  const map = await post('/maps', { name });
  const mapId = map.map_ref.entity_id;
  for (const [i, id] of [sourceId, targetId].entries()) {
    await post(`/maps/${mapId}/placements`, { physical_object_id: id, x: 240 + 360 * i, y: 160 });
  }
  const variant = await post(`/maps/${mapId}/presentation-variants`, {
    name: 'Smoke variant', source_variant_id: map.active_variant_ref.entity_id,
  });
  const mapUrl = `/map?map=${mapId}&variant=${variant.variant_ref.entity_id}&view=physical`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(mapUrl);
  const sourceNode = page.locator('.react-flow__node').filter({ hasText: 'Smoke panel A' });
  const sourcePort = (key: string) => sourceNode.locator(`[data-connection-point-id="${point(source, key)}"]`);
  await expect(sourcePort('p1')).toHaveCSS('background-color', 'rgb(51, 102, 153)');
  const viewport = page.locator('.react-flow__viewport');
  const translate = (node: Element) => (node as HTMLElement).style.transform;
  const viewportBefore = await viewport.evaluate(translate);
  const positions = () => page.locator('.react-flow__node').evaluateAll(nodes =>
    nodes.map(node => [(node as HTMLElement).dataset.id, (node as HTMLElement).style.transform]).sort());
  const positionsBefore = await positions();

  await sourceNode.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Массовое удаление кабелей' }).click();
  const dialog = page.getByRole('dialog', { name: 'Массовое удаление кабелей' });
  await dialog.getByLabel('Второй физический объект').selectOption(targetId);
  await dialog.getByRole('button', { name: 'Показать кабели' }).click();
  await expect(dialog.getByRole('row')).toHaveCount(3);
  await expect(dialog.getByRole('cell', { name: 'p1 · Спереди' })).toHaveCount(2);
  const firstRow = dialog.getByRole('row').filter({ hasText: 'p1' });
  await firstRow.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Проверить выбранные' }).click();
  await expect(dialog.getByRole('row')).toHaveCount(2);
  await expect(dialog.getByRole('status')).toContainText('физические соединения (1)');

  let deletes = 0;
  page.on('request', req => {
    if (req.method() === 'POST' && req.url().endsWith('/cables/bulk-delete')) deletes++;
  });
  await page.route('**/api/v1/topology/projection', route => route.abort(), { times: 1 });
  const mutation = page.waitForResponse(response => response.url().endsWith('/cables/bulk-delete'));
  await dialog.getByRole('button', { name: 'Подтвердить удаление' }).click();
  const acknowledged = await mutation;
  expect(acknowledged.status()).toBe(204);
  expect(acknowledged.request().postDataJSON().cables.map((row: { cable_id: string }) => row.cable_id)).toEqual([created.created[0].cable_id]);
  await expect(dialog.getByRole('alert')).toHaveText('Кабели удалены, но карту не удалось обновить.');
  await dialog.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(dialog).toBeHidden();
  expect(deletes).toBe(1);
  await expect(sourcePort('p1')).toHaveCSS('background-color', 'rgb(10, 21, 24)');
  await expect(sourcePort('p2')).toHaveCSS('background-color', 'rgb(51, 102, 153)');
  await expect(page).toHaveURL(new URL(mapUrl, page.url()).href);
  expect(await viewport.evaluate(translate)).toBe(viewportBefore);
  expect(await positions()).toEqual(positionsBefore);
});
