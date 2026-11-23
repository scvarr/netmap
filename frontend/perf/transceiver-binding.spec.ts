import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('author SFP equipment, install a single-member transceiver, and keep its cable after reload', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const name = 'SFP ' + randomUUID().slice(0, 8);
  const post = async (path: string, data: object) => {
    const response = await request.post('/api/v1' + path, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const socket = await post('/connector-types', { name: name + ' socket', color: '#336699', mating_profile: 'RJ45', termination: 'SOCKET' });
  const plug = await post('/connector-types', { name: name + ' plug', color: '#336699', mating_profile: 'RJ45', termination: 'PLUG' });
  const port = await post('/port-types', { name, color: '#336699', medium: 'COPPER', members: ['1'], connector_type_id: socket.id });
  const cable = await post('/cable-types', { name, color: '#336699', medium: 'COPPER', construction: 'TWISTED_PAIR' });
  const mounts = await (await request.get('/api/v1/module-port-types')).json();
  const sfp = mounts.find((mount: { name: string }) => mount.name === 'SFP')
    ?? await post('/module-port-types', { name: 'SFP' });

  await page.goto('/library/base-templates/new');
  await page.getByLabel('Название шаблона').fill(name + ' base');
  const creator = page.locator('.template-element-creator');
  await creator.getByLabel('Вид точки').selectOption('MODULE_PORT');
  await creator.getByLabel('Совместимость модульного порта').selectOption(sfp.id);
  await creator.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.locator('polygon[data-module-port-marker]').click();
  await page.getByRole('checkbox', { name: 'Назначить аппаратный интерфейс' }).check();
  await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
  await expect(page).toHaveURL(/\/library\/base-templates$/);

  await page.goto('/library/transceiver-templates/new');
  await page.getByLabel('Модель', { exact: true }).fill(name + ' optic');
  await page.getByLabel('Тип гнезда трансивера').selectOption(sfp.id);
  await page.getByRole('combobox', { name: 'Тип порта', exact: true }).selectOption(port.id);
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  await expect(page).toHaveURL(/tab=transceivers/);

  const installOptic = async (suffix: string) => {
    await page.goto('/infrastructure/objects/new');
    await page.getByRole('row', { name: new RegExp(name + ' base') }).getByRole('button').click();
    await page.getByLabel('Имя экземпляра').fill(name + suffix);
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(page).toHaveURL(/\/infrastructure\/objects\/[0-9a-f-]+$/);
    const objectUrl = new URL(page.url()).pathname;
    const objectId = objectUrl.split('/').at(-1)!;
    const physicalUrl = objectUrl + '/physical';
    await page.goto(physicalUrl);
    const equipment = page.getByRole('region', { name: 'Отсеки модулей' });
    await expect(page.locator('polygon[data-module-port-marker]')).toHaveCount(1);
    await expect(equipment.getByText(/Аппаратный интерфейс/)).toBeVisible();
    await equipment.getByLabel('Выберите совместимый модуль').selectOption({ label: name + ' optic' });
    await equipment.getByRole('button', { name: 'Установить', exact: true }).click();
    const marker = page.locator('rect[data-endpoint-id]');
    await expect(marker).toHaveCount(1);
    await expect(page.locator('polygon[data-module-port-marker]')).toHaveCount(0);
    await expect(equipment.getByText(/Извлечение и замена физического трансивера/)).toBeVisible();
    const pointId = (await marker.getAttribute('data-endpoint-id'))!;
    return { objectId, physicalUrl, pointId };
  };
  const peer = await installOptic(' B');
  const source = await installOptic(' A');
  await page.getByRole('button', { name: 'Подключить порт', exact: true }).click();
  await page.getByLabel('Целевой физический объект').selectOption(peer.objectId);
  await page.getByLabel('Свободный физический порт').selectOption(peer.pointId);
  await page.getByLabel('Тип кабеля').selectOption(cable.id);
  await page.getByLabel('Разъём A').selectOption(plug.id);
  await page.getByLabel('Разъём B').selectOption(plug.id);
  await page.getByLabel('Имя кабеля').fill(name + ' cable');
  await page.getByRole('button', { name: 'Подключить', exact: true }).click();
  await expect(page.getByText(name + ' cable', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.locator(`rect[data-endpoint-id="${source.pointId}"]`)).toHaveCount(1);
  await expect(page.getByText(name + ' cable', { exact: false })).toBeVisible();
});
