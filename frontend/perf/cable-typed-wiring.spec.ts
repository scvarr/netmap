import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

for (const verdict of ['ALLOW', 'DENY', 'UNKNOWN'] as const) {
test(`typed line on the physical map · ${verdict}`, async ({ page, request }) => {
  const runId = randomUUID();
  const name = `Typed wiring ${runId}`;
  const cableLabel = `CAB-${runId}/1/24`;
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const connector = await post('/connector-types', { name, color: '#336699', mating_profile: 'RJ45', termination: 'PLUG' });
  const socket = await post('/connector-types', { name: `${name} socket`, color: '#336699', mating_profile: 'RJ45', termination: 'SOCKET' });
  const portType = await post('/port-types', {
    name, color: '#336699', medium: verdict === 'DENY' ? 'FIBER' : 'COPPER',
    members: ['1'], connector_type_id: socket.id,
  });
  const cableType = await post('/cable-types', { name, color: '#336699', medium: 'COPPER', construction: 'TWISTED_PAIR' });
  const template = await post('/library/base-templates', {
    name, body: { kind: 'RECTANGLE', width: 160, height: 70 },
    panels: [{ panel_key: 'front', panel_number: 1, display_name: 'Front', face: 'FRONT', x: 0, y: 0, width: 160, height: 70 }],
    slots: [{ key: 'p1', display_name: 'P1', kind: 'CONNECTION_POINT', port_type_id: portType.id,
      panel_key: 'front', rendered_position: { x: 0.5, y: 0.5 } }],
    internal_links: [],
  });
  const map = await post('/maps', { name });
  const mapId = map.map_ref.entity_id;
  const pointIds: string[] = [];
  for (const [index, label] of ['A', 'B'].entries()) {
    const object = await post('/topology/physical-objects', {
      display_name: `${name} ${label}`, base_template_id: template.blueprint_ref.entity_id,
    });
    await post(`/maps/${mapId}/placements`, { physical_object_id: object.physical_object_ref.entity_id, x: 160 + 440 * index, y: 240 });
    pointIds.push(object.slots[0].connection_point_ref.entity_id);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/map?map=${mapId}&view=physical`);
  const port = (id: string) => page.locator(`.blueprint-map-node__port[data-connection-point-id="${id}"]`);
  await expect(port(pointIds[0])).toBeVisible();
  await page.getByRole('button', { name: 'Инструменты' }).click();
  await page.getByRole('button', { name: 'Соединить порты' }).click();
  await port(pointIds[0]).click();
  await port(pointIds[1]).click();

  const dialog = page.getByRole('dialog', { name: 'Соединить порты' });
  const create = dialog.getByRole('button', { name: 'Создать кабель' });
  await expect(create).toBeDisabled();
  await dialog.getByLabel('Тип кабеля').selectOption(cableType.id);
  await dialog.getByLabel('Разъём A').selectOption(connector.id);
  if (verdict !== 'UNKNOWN') await dialog.getByLabel('Разъём B').selectOption(connector.id);
  await dialog.getByLabel('Имя кабеля').fill(cableLabel);
  let writes = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/physical-connections')) writes++;
  });
  if (verdict === 'DENY') {
    await create.click();
    await expect(dialog.getByRole('alert')).toContainText('среды кабеля и порта различаются');
    expect(writes).toBe(0);
    return;
  }
  if (verdict === 'UNKNOWN') {
    const warning = page.waitForEvent('dialog');
    const click = create.click();
    const confirmation = await warning;
    expect(confirmation.message()).toContain('разъём кабеля не указан');
    await confirmation.dismiss();
    await click;
    await expect(create).toBeEnabled();
    expect(writes).toBe(0);
    page.once('dialog', confirmation => confirmation.accept());
  }
  const creation = page.waitForResponse(response =>
    response.request().method() === 'POST' && response.url().endsWith('/physical-connections'));
  await create.click();
  const response = await creation;
  expect(response.status(), await response.text()).toBe(201);
  const { cable_ref, connection_ref } = await response.json();
  await expect(dialog).toBeHidden();
  const route = page.locator(`path[data-cable-ids*="${cable_ref.entity_id}"]`).first();
  await expect(route).toBeAttached();
  await page.reload();
  await expect(route).toBeAttached();
  const packageResponse = await request.get('/api/v1/workspace/package');
  expect(packageResponse.ok()).toBe(true);
  const workspace = await packageResponse.json();
  expect(workspace.canonical.Cable.find((cable: { id: string }) => cable.id === cable_ref.entity_id)).toEqual({
    id: cable_ref.entity_id, connection_id: connection_ref.entity_id, cable_type_id: cableType.id,
    connector_a_type_id: connector.id, connector_b_type_id: verdict === 'ALLOW' ? connector.id : null, label: cableLabel,
  });
  await port(pointIds[0]).click({ button: 'right' });
  const deletion = page.waitForResponse(result =>
    result.request().method() === 'DELETE' && result.url().endsWith(`/physical-connections/${connection_ref.entity_id}`));
  page.once('dialog', confirmation => confirmation.accept());
  await page.getByRole('menuitem', { name: 'Разъединить' }).click();
  expect((await deletion).status()).toBe(204);
  await expect(route).not.toBeAttached();
});
}
