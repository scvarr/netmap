import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

for (const verdict of ['ALLOW', 'DENY', 'UNKNOWN'] as const) {
test(`typed line on the physical map · ${verdict}`, async ({ page, request }) => {
  const runId = randomUUID();
  const name = `LC Simplex ${runId.slice(0, 8)}`;
  const cableLabel = `CAB-${runId}/1/24`;
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const portNames = verdict === 'ALLOW' ? [name] : [`${name} A`, `${name} B`];
  await page.goto('/catalogs/port-types');
  const portTypeIds = [];
  for (const portName of portNames) {
    await page.getByLabel('Название', { exact: true }).fill(portName);
    await page.getByLabel(/Обозначения каналов/).fill('1');
    await page.getByLabel('Среда').selectOption(portNames.length === 2 && verdict === 'DENY' && portName.endsWith(' B') ? 'COPPER' : 'FIBER');
    await page.getByLabel('Режим совместимости').selectOption(verdict === 'ALLOW' ? 'SAME_TYPE' : 'UNDEFINED');
    const saved = page.waitForResponse(response =>
      response.request().method() === 'POST' && response.url().endsWith('/port-types'));
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const response = await saved;
    expect(response.status(), await response.text()).toBe(201);
    portTypeIds.push((await response.json()).id);
  }
  await page.getByRole('row').filter({ hasText: portNames[0] }).getByRole('button', { name: 'Редактировать' }).click();
  const matrix = page.getByRole('region', { name: 'Матрица совместимости' });
  await expect(matrix.getByRole('row').filter({ hasText: portNames.at(-1)! })).toContainText(verdict);
  const template = (portTypeId: string, displayName: string) => post('/library/base-templates', {
    name: displayName, body: { kind: 'RECTANGLE', width: 160, height: 70 },
    panels: [{ panel_key: 'front', panel_number: 1, display_name: 'Front', face: 'FRONT', x: 0, y: 0, width: 160, height: 70 }],
    slots: [{ key: 'p1', display_name: 'P1', kind: 'CONNECTION_POINT', port_type_id: portTypeId,
      panel_key: 'front', rendered_position: { x: 0.5, y: 0.5 } }],
    internal_links: [],
  });
  const map = await post('/maps', { name });
  const mapId = map.map_ref.entity_id;
  const pointIds: string[] = [];
  for (const [index, label] of ['A', 'B'].entries()) {
    const definition = await template(portTypeIds[index] ?? portTypeIds[0], `${name} template ${label}`);
    await page.goto('/infrastructure/objects/new?blueprint=' + definition.blueprint_ref.entity_id);
    await page.getByLabel('Имя экземпляра').fill(`${name} ${label}`);
    const instance = page.waitForResponse(response => response.request().method() === 'POST'
      && response.url().endsWith('/topology/physical-objects'));
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    const response = await instance;
    expect(response.status(), await response.text()).toBe(201);
    const object = await response.json();
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
  await expect(create).toBeEnabled();
  await expect(dialog.getByLabel('Тип кабеля', { exact: true })).toHaveCount(0);
  await dialog.getByRole('combobox', { name: 'Тип волокна' }).selectOption('SM');
  await expect(dialog.getByLabel(/Разъём [AB]/)).toHaveCount(0);
  await dialog.getByLabel('Имя кабеля').fill(cableLabel);
  let writes = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/physical-connections')) writes++;
  });
  if (verdict === 'DENY') {
    await create.click();
    await expect(dialog.getByRole('alert')).toContainText('среды физических окончаний различаются');
    expect(writes).toBe(0);
    return;
  }
  const modal = page.getByRole('dialog', { name: 'Подтверждение физической совместимости' });
  let systemDialogs = 0;
  const rejectSystemDialog = async (systemDialog: import('@playwright/test').Dialog) => {
    systemDialogs++;
    await systemDialog.dismiss();
  };
  page.on('dialog', rejectSystemDialog);
  if (verdict === 'UNKNOWN') {
    await create.click();
    await expect(modal).toContainText('совместимость типов портов не определена');
    await expect(modal.getByRole('button', { name: 'Отмена' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Создаём…' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(create).toBeEnabled();
    expect(writes).toBe(0);
  }
  const creation = page.waitForResponse(response =>
    response.request().method() === 'POST' && response.url().endsWith('/physical-connections'));
  await create.click();
  if (verdict === 'UNKNOWN') {
    await expect(modal.getByRole('button', { name: 'Отмена' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(modal.getByRole('button', { name: 'Подтвердить и создать' })).toBeFocused();
    await page.keyboard.press('Enter');
  }
  expect(systemDialogs).toBe(0);
  page.off('dialog', rejectSystemDialog);
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
    id: cable_ref.entity_id, connection_id: connection_ref.entity_id,
    label: cableLabel, fiber_type: 'SM',
  });
  if (verdict === 'ALLOW') {
    await page.goto('/infrastructure/objects');
    await page.getByRole('tab', { name: /Кабели/ }).click();
    const fiber = page.getByRole('row').filter({ hasText: cableLabel }).getByRole('button', { name: /Редактировать тип волокна/ });
    await fiber.click();
    const edit = page.getByRole('dialog', { name: /Редактировать тип волокна/ });
    const select = edit.getByRole('combobox', { name: 'Тип волокна' });
    await expect(select).toHaveValue('SM');
    await select.selectOption('MM');
    const folder = process.env.L1_OPTICAL_EVIDENCE_DIR;
    if (folder) {
      await page.screenshot({ path: join(folder, 'cable-edit-1440x900.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(edit.getByRole('button', { name: 'Сохранить' })).toBeInViewport();
      await page.screenshot({ path: join(folder, 'cable-edit-390x844.png') });
    }
    await edit.getByRole('button', { name: 'Сохранить' }).click();
    await expect(edit).toBeHidden();
    await expect(fiber).toBeFocused();
    await page.reload();
    await page.getByRole('tab', { name: /Кабели/ }).click();
    await fiber.click();
    await expect(select).toHaveValue('MM');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/map?map=${mapId}&view=physical`);
  }
  await port(pointIds[0]).click({ button: 'right' });
  const deletion = page.waitForResponse(result =>
    result.request().method() === 'DELETE' && result.url().endsWith(`/physical-connections/${connection_ref.entity_id}`));
  page.once('dialog', confirmation => confirmation.accept());
  await page.getByRole('menuitem', { name: 'Разъединить' }).click();
  expect((await deletion).status()).toBe(204);
  await expect(route).not.toBeAttached();
});
}
