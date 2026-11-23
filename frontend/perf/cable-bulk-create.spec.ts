import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

test('reviews, creates, deletes and recreates 48 lines with the same labels', async ({ page, request }) => {
  const stamp = randomUUID().slice(0, 8);
  const name = `Bulk create smoke ${stamp}`;
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const portType = await post('/port-types', { name, color: '#336699', medium: 'COPPER', members: ['1'], compatibility_mode: 'SAME_TYPE' });
  const cableType = await post('/cable-types', { name: `Витая пара · ${stamp}`, color: '#336699', medium: 'COPPER', construction: 'TWISTED_PAIR' });
  const incompatibleType = await post('/cable-types', { name: `Оптическое волокно · ${stamp}`, color: '#336699', medium: 'FIBER', construction: 'Glass', fiber_mode: 'SM' });
  const labelTemplate = await post('/cable-label-templates', { name: `C01/##/48 · ${stamp}`, pattern: 'C01/##/48', start_at: 1 });
  const numbers = Array.from({ length: 48 }, (_, index) => index + 1);
  const labels = numbers.map(number => `C01/${String(number).padStart(2, '0')}/48`);
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
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(mapUrl);
  const sourceNode = page.locator('.react-flow__node').filter({ hasText: 'Bulk smoke A' });
  const marker = (number: number) => sourceNode.locator(`[data-connection-point-id="${point(source, number)}"]`);
  await expect(marker(1)).toHaveCSS('background-color', 'rgb(10, 21, 24)');

  const dialog = page.getByRole('dialog', { name: 'Массовое подключение' });
  const button = (name: string) => dialog.getByRole('button', { name, exact: true });
  const left = dialog.getByRole('region', { name: 'Источник', exact: true });
  const right = dialog.getByRole('region', { name: 'Назначение', exact: true });
  const pairs = dialog.getByRole('region', { name: 'Сопоставленные пары (48)', exact: true });
  const surface = dialog.locator('.map-dialog__surface');
  const capture = async (name: string) => {
    const folder = process.env.CAT_D_03_EVIDENCE_DIR;
    if (!folder) return;
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: join(folder, name), animations: 'disabled' });
  };
  const open = async () => {
    await sourceNode.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Массовое подключение' }).click();
    await dialog.getByLabel('Целевой физический объект').selectOption(targetId);
    await left.getByRole('button', { name: 'Выбрать все свободные' }).click();
    await right.getByRole('button', { name: 'Выбрать все свободные' }).click();
  };
  const checkLayout = async (minTableHeight: number, action: string) => {
    await expect(pairs).toBeInViewport();
    await expect(button('Отмена')).toBeInViewport();
    await expect(button(action)).toBeInViewport();
    expect(await surface.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    const bounds = (await pairs.boundingBox())!;
    const footer = (await button(action).boundingBox())!;
    expect(bounds.height).toBeGreaterThan(minTableHeight);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(footer.y);
  };
  await open();
  await button('Сопоставить').click();
  await expect(dialog.getByRole('heading', { name: 'Сопоставленные пары (48)' })).toBeVisible();
  await expect(dialog.getByRole('table')).toHaveCount(1);
  await expect(pairs.getByRole('row')).toHaveCount(49);
  const header = pairs.getByRole('columnheader', { name: 'Источник' });
  const initialHeader = (await header.boundingBox())!.y;
  await pairs.evaluate(element => { element.scrollTop = 600; });
  expect(await pairs.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect((await header.boundingBox())!.y).toBeCloseTo(initialHeader, 0);
  await pairs.evaluate(element => { element.scrollTop = 0; });
  await checkLayout(450, 'Предпросмотр');
  await capture('01-pairs-1280x800.png');
  await page.setViewportSize({ width: 1440, height: 900 });
  await checkLayout(500, 'Предпросмотр');
  await capture('02-pairs-1440x900.png');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await checkLayout(500, 'Предпросмотр');

  await button('К выбору портов').click();
  await expect(left.getByRole('checkbox', { name: 'P1', exact: true })).toBeChecked();
  await right.getByLabel('Сортировка').selectOption('descending');
  await button('Сопоставить').click();
  await pairs.getByRole('combobox', { name: /Назначение для Bulk smoke A .* P1$/ }).selectOption(point(target, 47));
  await expect(pairs.getByRole('combobox', { name: /Назначение для Bulk smoke A .* P2$/ })).toHaveValue(point(target, 48));
  await button('Предпросмотр').click();
  const previewLabels = async () => {
    await dialog.getByLabel('Имена кабелей').selectOption(labelTemplate.id);
    await expect(pairs.getByRole('cell', { name: /^C01\// })).toHaveText(labels);
  };
  await previewLabels();
  await page.setViewportSize({ width: 1440, height: 900 });
  await dialog.getByLabel('Тип кабеля').selectOption(incompatibleType.id);
  await button('Проверить совместимость').click();
  await expect(dialog.getByRole('alert')).toHaveText('Совместимость · DENY');
  await expect(button('Подтвердить создание')).toBeDisabled();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByText('Подробности по парам', { exact: true }).click();
  const detail = dialog.getByRole('region', { name: 'Подробности по парам' });
  expect(await detail.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await dialog.getByLabel('Номер пары').selectOption('48');
  await expect(detail.getByRole('listitem')).toHaveCount(1);
  await expect(detail.getByText(/Пара 48.*DENY.*среды кабеля и порта различаются/)).toBeVisible();
  await checkLayout(300, 'Подтвердить создание');
  await capture('04-deny-detail-1440x900.png');

  await dialog.getByLabel('Тип кабеля').selectOption(cableType.id);
  await button('Проверить совместимость').click();
  await expect(dialog.getByText('Совместимость · ALLOW')).toBeVisible();
  await expect(button('Подтвердить создание')).toBeEnabled();
  const { id: portTypeId, cardinality: _cardinality, ...portFields } = portType;
  const changed = await request.put(`/api/v1/port-types/${portTypeId}`, {
    data: { ...portFields, compatibility_mode: 'UNDEFINED' },
  });
  expect(changed.ok(), await changed.text()).toBe(true);
  await dialog.getByLabel('Тип кабеля').selectOption(incompatibleType.id);
  await dialog.getByLabel('Тип кабеля').selectOption(cableType.id);
  const checkUnknown = async () => {
    await button('Проверить совместимость').click();
    await expect(dialog.getByText('Совместимость · UNKNOWN')).toBeVisible();
    await expect(dialog.getByText('совместимость типов портов не определена · пар: 48')).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(1);
    await expect(button('Подтвердить создание')).toBeDisabled();
  };
  await page.setViewportSize({ width: 1280, height: 800 });
  await checkUnknown();
  await checkLayout(350, 'Подтвердить создание');
  await expect(detail).toBeHidden();
  await capture('03-unknown-1280x800.png');
  await button('Отмена').click();
  await expect(dialog).toBeHidden();
  await expect(marker(1)).toHaveCSS('background-color', 'rgb(10, 21, 24)');

  const runBatch = async (reverse: boolean) => {
    await open();
    if (reverse) await right.getByLabel('Сортировка').selectOption('descending');
    await button('Сопоставить').click();
    await button('Предпросмотр').click();
    await previewLabels();
    await dialog.getByLabel('Тип кабеля').selectOption(cableType.id);
    await checkUnknown();
    await dialog.getByRole('checkbox').check();
    const mutation = page.waitForResponse(response => response.url().endsWith('/physical-connections/bulk'));
    await button('Подтвердить создание').click();
    const response = await mutation;
    expect(response.status(), await response.text()).toBe(201);
    const { created } = await response.json();
    expect(created.map((row: { target_connection_point_id: string }) => row.target_connection_point_id)).toEqual(
      numbers.map(number => point(target, reverse ? 49 - number : number)),
    );
    await expect(dialog).toBeHidden();
    return created as { cable_id: string; connection_id: string }[];
  };
  const deleteBatch = async () => {
    const owners = { source_object_id: sourceId, target_object_id: targetId };
    const preview = await request.get('/api/v1/cables/bulk-delete-preview', { params: owners });
    expect(preview.ok(), await preview.text()).toBe(true);
    const { cables } = await preview.json();
    expect(cables).toHaveLength(48);
    const result = await request.post('/api/v1/cables/bulk-delete', {
      data: { ...owners, cables: cables.map((item: { expected: unknown }) => item.expected) },
    });
    expect(result.status(), await result.text()).toBe(204);
  };
  const first = await runBatch(true);
  await deleteBatch();
  await page.reload();
  await expect(marker(1)).toHaveCSS('background-color', 'rgb(10, 21, 24)');
  const second = await runBatch(false);
  expect(second.every(row => !first.some(old => old.cable_id === row.cable_id || old.connection_id === row.connection_id))).toBe(true);
  const route = page.locator(`path[data-cable-ids*="${second[0].cable_id}"]`).first();
  await page.reload();
  await expect(route).toBeAttached();
  await expect(marker(48)).toHaveCSS('background-color', 'rgb(51, 102, 153)');

  const packageResponse = await request.get('/api/v1/workspace/package');
  expect(packageResponse.ok()).toBe(true);
  const workspace = await packageResponse.json();
  const history: { cable_id: string; label: string; released_at: string | null }[] = workspace.settings.CableLabelHistory;
  for (const [rows, released] of [[first, true], [second, false]] as const) {
    expect(rows.map(row => history.find(item => item.cable_id === row.cable_id)?.label)).toEqual(labels);
    expect(rows.every(row => history.some(item => item.cable_id === row.cable_id && Boolean(item.released_at) === released))).toBe(true);
  }
  expect(workspace.canonical.Cable.some((row: { id: string }) => first.some(old => old.cable_id === row.id))).toBe(false);
  await deleteBatch();
});
