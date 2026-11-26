import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('assign interfaces to published SFP sockets, reconcile an existing object, and install a transceiver', async ({ page, request }) => {
  const name = 'Retrofit ' + randomUUID().slice(0, 8);
  const post = async (path: string, data: object) => {
    const response = await request.post('/api/v1' + path, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const port = await post('/port-types', { name, color: '#336699', medium: 'COPPER', members: ['1'], compatibility_mode: 'SAME_TYPE' });
  const mounts = await (await request.get('/api/v1/module-port-types')).json();
  const sfp = mounts.find((mount: { name: string }) => mount.name === 'SFP')
    ?? await post('/module-port-types', { name: 'SFP' });

  await page.setViewportSize({ width: 840, height: 1000 });
  await page.goto('/library/base-templates/new');
  await page.getByLabel('Название шаблона').fill(name);
  const creator = page.locator('.template-element-creator');
  await creator.getByLabel('Вид точки').selectOption('MODULE_PORT');
  await creator.getByLabel('Количество').fill('3');
  await creator.getByLabel('Совместимость модульного порта').selectOption(sfp.id);
  await creator.getByRole('button', { name: 'Добавить', exact: true }).click();
  const diamonds = page.locator('polygon[data-module-port-marker]');
  await expect(diamonds).toHaveCount(3);
  const checkbox = page.getByRole('checkbox', { name: 'Назначить аппаратный интерфейс' });
  for (let i = 0; i < 3; i++) {
    await diamonds.nth(i).click();
    await expect(checkbox).toBeChecked();
    expect((await checkbox.boundingBox())?.width).toBe(16);
    if (i === 0) {
      await checkbox.focus();
      await checkbox.press('Space');
      await expect(checkbox).toBeFocused();
      await expect(checkbox).toHaveCSS('outline-style', 'solid');
    } else {
      await page.getByText('Назначить аппаратный интерфейс', { exact: true }).click();
    }
    await expect(checkbox).not.toBeChecked();
  }
  const creation = page.waitForResponse(response => response.request().method() === 'POST'
    && response.url().endsWith('/library/base-templates'));
  await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
  const createResponse = await creation;
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const { blueprint_ref } = await createResponse.json();
  const templateId = blueprint_ref.entity_id;
  await expect(page).toHaveURL(/\/library\/base-templates$/);

  await page.goto('/infrastructure/objects/new?blueprint=' + templateId);
  await page.getByLabel('Имя экземпляра').fill(name + ' device');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page).toHaveURL(/\/infrastructure\/objects\/[0-9a-f-]+$/);
  const objectUrl = new URL(page.url()).pathname;
  const objectId = objectUrl.split('/').at(-1)!;
  const config = async () => {
    const response = await request.get(`/api/v1/topology/physical-objects/${objectId}/configuration`);
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const original = await config();
  expect(original.bays).toHaveLength(3);
  expect(original.bays.every((bay: { network_interface_id?: string }) => !bay.network_interface_id)).toBe(true);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/library/base-templates/${templateId}/edit`);
  await expect(diamonds).toHaveCount(3);
  await diamonds.nth(0).click();
  await diamonds.nth(1).click({ modifiers: ['Control'] });
  const selected = page.getByRole('button', { name: 'Назначить интерфейсы выделенным гнёздам' });
  await selected.click();
  await expect(selected).toBeDisabled();
  const all = page.getByRole('button', { name: 'Назначить интерфейсы всем гнёздам' });
  await all.click();
  await expect(all).toBeDisabled();
  const draftUrl = `/api/v1/library/base-templates/${templateId}/draft`;
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === draftUrl);
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  const savedResponse = await saved;
  expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
  const { generation } = await savedResponse.json();
  const restore = await request.post(`${draftUrl}/restore-source?expected_generation=${generation}`);
  expect(restore.status()).toBe(409);
  expect((await restore.json()).error.details.reason).toBe('DRAFT_RESTORE_NOT_REQUIRED');
  await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText(/Публикация завершена/)).toBeVisible();
  expect(await config()).toEqual(original);
  await page.getByRole('button', { name: 'Обновить все совместимые объекты' }).click();
  await expect(page.getByText(/Результаты обновления объектов/)).toBeVisible();
  const updated = await config();
  expect(updated.configuration_id).toBe(original.configuration_id);
  expect(updated.base_revision_id).not.toBe(original.base_revision_id);
  const interfaceIds: string[] = updated.bays.map((bay: { network_interface_id: string }) => bay.network_interface_id);
  expect(interfaceIds.every(Boolean)).toBe(true);
  expect(new Set(interfaceIds).size).toBe(3);

  await page.goto('/library/transceiver-templates/new');
  await page.getByLabel('Модель', { exact: true }).fill(name + ' optic');
  await page.getByLabel('Тип гнезда трансивера').selectOption(sfp.id);
  await page.getByRole('combobox', { name: 'Тип порта', exact: true }).selectOption(port.id);
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  await expect(page).toHaveURL(/tab=transceivers/);

  await page.goto(objectUrl + '/physical');
  const row = page.locator(`tr[data-bay-key="${updated.bays[0].bay_key}"]`);
  await row.getByLabel('Выберите совместимый трансивер').selectOption({ label: name + ' optic' });
  await row.getByRole('button', { name: 'Установить', exact: true }).click();
  await expect(page.locator('rect[data-endpoint-id]')).toHaveCount(1);
  await expect(diamonds).toHaveCount(2);
  expect((await config()).bays[0].network_interface_id).toBe(interfaceIds[0]);
});
