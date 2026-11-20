import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('matches 48 physical ports in both directions and creates the exact reviewed pairs', async ({ page, request }) => {
  const name = `Bulk create smoke ${randomUUID()}`;
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const portType = await post('/port-types', { name, color: '#336699', medium: 'COPPER', members: ['1'] });
  const cableType = await post('/cable-types', { name, color: '#336699', medium: 'COPPER', construction: 'TWISTED_PAIR' });
  const numbers = Array.from({ length: 48 }, (_, index) => index + 1);
  const blueprint = await post('/library/base-templates', {
    name,
    body: { kind: 'RECTANGLE', width: 460, height: 80 },
    panels: [{ panel_key: 'ports', panel_number: 1, display_name: 'Патчи', x: 0, y: 0, width: 460, height: 80 }],
    slots: numbers.map((number, index) => ({
      key: `p${number}`, display_name: `P${number}`, port_type_id: portType.id, kind: 'CONNECTION_POINT',
      panel_key: 'ports', rendered_position: { x: (index % 24 + 1) / 25, y: index < 24 ? .3 : .7 },
    })),
    internal_links: [],
  });
  const object = (display_name: string) => post('/topology/physical-objects', {
    display_name, base_template_id: blueprint.blueprint_ref.entity_id,
  });
  const source = await object('Bulk smoke A');
  const target = await object('Bulk smoke B');
  const sourceId = source.physical_object_ref.entity_id;
  const targetId = target.physical_object_ref.entity_id;
  const point = (owner: typeof source, number: number): string => owner.slots
    .find((slot: { slot_key: string }) => slot.slot_key === `p${number}`).connection_point_ref.entity_id;
  const map = await post('/maps', { name });
  const mapId = map.map_ref.entity_id;
  for (const [index, id] of [sourceId, targetId].entries()) {
    await post(`/maps/${mapId}/placements`, { physical_object_id: id, x: 100 + 600 * index, y: 160 });
  }
  const variant = await post(`/maps/${mapId}/presentation-variants`, {
    name: 'Smoke variant', source_variant_id: map.active_variant_ref.entity_id,
  });
  const mapUrl = `/map?map=${mapId}&variant=${variant.variant_ref.entity_id}&view=physical`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(mapUrl);
  const sourceNode = page.locator('.react-flow__node').filter({ hasText: 'Bulk smoke A' });
  const marker = (number: number) => sourceNode.locator(`[data-connection-point-id="${point(source, number)}"]`);
  await expect(marker(1)).toHaveCSS('background-color', 'rgb(10, 21, 24)');
  const transform = (node: Element) => (node as HTMLElement).style.transform;
  const viewport = page.locator('.react-flow__viewport');
  const positions = () => page.locator('.react-flow__node').evaluateAll(nodes =>
    nodes.map(node => [(node as HTMLElement).dataset.id, (node as HTMLElement).style.transform]).sort());

  const dialog = page.getByRole('dialog', { name: 'Массовое подключение' });
  const open = async () => {
    await sourceNode.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Массовое подключение' }).click();
    await dialog.getByLabel('Целевой физический объект').selectOption(targetId);
  };
  await open();
  const viewportBefore = await viewport.evaluate(transform);
  const positionsBefore = await positions();
  const left = dialog.getByRole('region', { name: 'Источник' });
  const right = dialog.getByRole('region', { name: 'Назначение' });
  await left.getByRole('button', { name: 'Выбрать все свободные' }).click();
  await right.getByRole('button', { name: 'Выбрать все свободные' }).click();
  const matchAndReview = async () => {
    await dialog.getByRole('button', { name: 'Сопоставить' }).click();
    await dialog.getByRole('button', { name: 'Предпросмотр' }).click();
    await expect(dialog.getByRole('heading', { name: 'Кабели к созданию (48)' })).toBeVisible();
  };
  const checkPreview = async (reverse: boolean) => {
    await expect(dialog.getByRole('cell', { name: /^Bulk smoke A/ })).toHaveText(numbers.map(n => `Bulk smoke A / Патчи / P${n}`));
    await expect(dialog.getByRole('cell', { name: /^Bulk smoke B/ })).toHaveText(numbers.map(n => `Bulk smoke B / Патчи / P${reverse ? 49 - n : n}`));
  };
  await matchAndReview();
  await checkPreview(false);
  await dialog.getByRole('button', { name: 'Назад' }).click();
  await right.getByLabel('Сортировка').selectOption('descending');
  await expect(left.getByRole('checkbox').first()).toHaveAccessibleName('P1');
  await expect(right.getByRole('checkbox').first()).toHaveAccessibleName('P48');
  await matchAndReview();
  await checkPreview(true);

  let creates = 0;
  page.on('request', req => {
    if (req.method() === 'POST' && req.url().endsWith('/physical-connections/bulk')) creates++;
  });
  await page.route('**/api/v1/topology/projection', route => route.abort(), { times: 1 });
  await expect(dialog.getByRole('button', { name: 'Подтвердить создание' })).toBeDisabled();
  await dialog.getByLabel('Тип кабеля').selectOption(cableType.id);
  const mutation = page.waitForResponse(response => response.url().endsWith('/physical-connections/bulk'));
  await dialog.getByRole('button', { name: 'Подтвердить создание' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Пара 48');
  expect(creates).toBe(0);
  await dialog.getByRole('checkbox', { name: 'Продолжить с неподтверждённой совместимостью' }).check();
  await dialog.getByRole('button', { name: 'Подтвердить создание' }).click();
  const response = await mutation;
  expect(response.status()).toBe(201);
  const endpoint = (connection_point_id: string) => ({ kind: 'CONNECTION_POINT', connection_point_id, member_index: 1 });
  expect(response.request().postDataJSON().cable_type_id).toBe(cableType.id);
  expect(response.request().postDataJSON().pairs).toEqual(numbers.map(number => ({
    source: endpoint(point(source, number)), target: endpoint(point(target, 49 - number)),
  })));
  const { created } = await response.json();
  expect(created).toHaveLength(48);
  await expect(dialog.getByRole('alert')).toContainText('Соединения созданы');
  await dialog.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(dialog).toBeHidden();
  expect(creates).toBe(1);

  await expect(marker(1)).toHaveCSS('background-color', 'rgb(51, 102, 153)');
  await expect(marker(48)).toHaveCSS('background-color', 'rgb(51, 102, 153)');
  const route = page.locator(`path[data-cable-ids*="${created[0].cable_id}"]`).first();
  await expect(route).toHaveCSS('stroke', 'rgb(73, 229, 167)');
  expect(await route.evaluate(segment => (segment as SVGPathElement).getTotalLength())).toBeGreaterThan(0);
  await expect(page).toHaveURL(new URL(mapUrl, page.url()).href);
  expect(await viewport.evaluate(transform)).toBe(viewportBefore);
  expect(await positions()).toEqual(positionsBefore);

  await open();
  await expect(left.getByRole('checkbox', { name: 'P1', exact: true })).toBeDisabled();
  await expect(right.getByRole('checkbox', { name: 'P48', exact: true })).toBeDisabled();
  await expect(left.getByText(/ · Bulk smoke B \/ Патчи \/ P48$/)).toBeVisible();
  await page.setViewportSize({ width: 600, height: 900 });
  const leftBounds = (await left.boundingBox())!;
  const rightBounds = (await right.boundingBox())!;
  expect(rightBounds.y).toBeGreaterThanOrEqual(leftBounds.y + leftBounds.height);
});
