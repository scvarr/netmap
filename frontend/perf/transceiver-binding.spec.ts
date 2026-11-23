import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('install a vertical board and fixed SFP transceivers, then keep their cable after reload', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const name = 'SFP ' + randomUUID().slice(0, 8);
  const post = async (path: string, data: object) => {
    const response = await request.post('/api/v1' + path, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const port = await post('/port-types', { name, color: '#336699', medium: 'COPPER', members: ['1'], compatibility_mode: 'SAME_TYPE' });
  const cable = await post('/cable-types', { name, color: '#336699', medium: 'COPPER', construction: 'TWISTED_PAIR' });
  const mounts = await (await request.get('/api/v1/module-port-types')).json();
  const sfp = mounts.find((mount: { name: string }) => mount.name === 'SFP')
    ?? await post('/module-port-types', { name: 'SFP' });
  const bayType = await post('/module-bay-types', { name });
  const board = await post('/library/module-templates', {
    name: name + ' board', mount_kind: 'MODULE_BAY', module_bay_type_id: bayType.id,
    geometry: { width: 80, height: 30, fill_color: '#64748b', endpoints: {} }, endpoints: [],
    module_places: [{ key: 'sfp-board', display_name: 'SFP Board', mount_kind: 'MODULE_PORT',
      module_port_type_id: sfp.id, hardware_interface_key: randomUUID(), x: .5, y: .5 }],
  });

  await page.goto('/library/base-templates/new');
  await page.getByLabel('Название шаблона').fill(name + ' base');
  const creator = page.locator('.template-element-creator');
  await creator.getByLabel('Вид точки').selectOption('MODULE_PORT');
  await creator.getByLabel('Совместимость модульного порта').selectOption(sfp.id);
  await creator.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.locator('polygon[data-module-port-marker]').click();
  await page.getByRole('checkbox', { name: 'Назначить аппаратный интерфейс' }).check();
  await page.locator('summary').filter({ hasText: 'Логические отсеки' }).click();
  const boardGroup = page.getByRole('group', { name: 'Создать группу' });
  await boardGroup.getByLabel('Тип модульного отсека').selectOption(bayType.id);
  await boardGroup.getByRole('button', { name: 'Создать группу' }).click();
  await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click();
  await expect(page).toHaveURL(/\/library\/base-templates$/);

  await page.goto('/library/transceiver-templates/new');
  await page.getByLabel('Модель', { exact: true }).fill(name + ' optic');
  await page.getByLabel('Тип гнезда трансивера').selectOption(sfp.id);
  await page.getByRole('combobox', { name: 'Тип порта', exact: true }).selectOption(port.id);
  await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click();
  await expect(page).toHaveURL(/tab=transceivers/);

  const installOptic = async (suffix: string, onBoard = false) => {
    await page.goto('/infrastructure/objects/new');
    await page.getByRole('row', { name: new RegExp(name + ' base') }).getByRole('button').click();
    await page.getByLabel('Имя экземпляра').fill(name + suffix);
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(page).toHaveURL(/\/infrastructure\/objects\/[0-9a-f-]+$/);
    const objectUrl = new URL(page.url()).pathname;
    const objectId = objectUrl.split('/').at(-1)!;
    const physicalUrl = objectUrl + '/physical';
    await page.goto(physicalUrl);
    const boards = page.getByRole('region', { name: 'Платы' });
    let equipment = page.getByRole('region', { name: 'Трансиверы' });
    await expect(page.locator('polygon[data-module-port-marker]')).toHaveCount(1);
    const editLayout = page.getByRole('button', { name: 'Корректировать расположение плат' });
    await expect(editLayout).toHaveCount(0);
    if (onBoard) {
      await boards.getByLabel('Выберите совместимую плату').selectOption(board.template_id);
      await boards.getByLabel('Ориентация').selectOption('VERTICAL');
      await boards.getByRole('button', { name: 'Установить', exact: true }).click();
      await expect(boards.getByRole('cell', { name: 'Вертикальная' })).toBeVisible();
      await editLayout.click();
      await page.locator('rect[data-installation-id]').click({ position: { x: 5, y: 5 } });
      await expect(page.getByLabel('Изменить размер')).toBeVisible();
      await page.getByRole('button', { name: 'Завершить корректировку' }).click();
      await boards.getByText('Гнёзда трансиверов', { exact: true }).click();
      equipment = boards.getByRole('table', { name: 'Трансиверы' });
    }
    await expect(equipment.getByRole('columnheader', { name: 'Гнездо' })).toBeVisible();
    await expect(equipment.getByRole('columnheader', { name: 'Ориентация' })).toHaveCount(0);
    await expect(equipment.getByLabel('Ориентация')).toHaveCount(0);
    await expect(equipment.getByText(/Аппаратный интерфейс/)).toBeVisible();
    await equipment.getByLabel('Выберите совместимый трансивер').selectOption({ label: name + ' optic' });
    const installation = page.waitForRequest(candidate =>
      candidate.method() === 'POST' && candidate.url().endsWith('/module-installations'));
    await equipment.getByRole('button', { name: 'Установить', exact: true }).click();
    expect((await installation).postDataJSON().orientation).toBe('HORIZONTAL');
    const marker = page.locator('rect[data-endpoint-id]');
    await expect(marker).toHaveCount(1);
    const outline = page.locator('rect[data-transceiver-outline]');
    await expect(outline).toHaveCount(1);
    await expect(outline).toHaveAttribute('fill', 'none');
    await expect(page.locator('[data-installation-id]')).toHaveCount(onBoard ? 1 : 0);
    await expect(page.locator('polygon[data-module-port-marker]')).toHaveCount(onBoard ? 1 : 0);
    await expect(equipment.getByText(/Извлечение и замена физического трансивера/)).toBeVisible();
    await page.getByRole('img', { name: 'Предпросмотр схемы' }).screenshot({
      path: testInfo.outputPath(onBoard ? 'transceiver-on-board.png' : 'transceiver-in-base.png'),
    });
    const pointId = (await marker.getAttribute('data-endpoint-id'))!;
    return { objectId, physicalUrl, pointId };
  };
  const peer = await installOptic(' B');
  const source = await installOptic(' A', true);
  await page.getByRole('button', { name: 'Подключить порт', exact: true }).click();
  await page.getByLabel('Целевой физический объект').selectOption(peer.objectId);
  await page.getByLabel('Свободный физический порт').selectOption(peer.pointId);
  await page.getByLabel('Тип кабеля').selectOption(cable.id);
  await page.getByLabel('Имя кабеля').fill(name + ' cable');
  await page.getByRole('button', { name: 'Подключить', exact: true }).click();
  await expect(page.getByText(name + ' cable', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.locator(`rect[data-endpoint-id="${source.pointId}"]`)).toHaveCount(1);
  await expect(page.locator('[data-transceiver-outline]')).toHaveCount(1);
  await expect(page.getByText(name + ' cable', { exact: false })).toBeVisible();
});
