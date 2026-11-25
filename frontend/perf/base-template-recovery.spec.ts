import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { BaseTemplateDraftDocument, CreateBaseTemplateRequest } from '../src/topology/baseTemplateTypes';

test('restores a rejected draft from its source and confirms wired deletion in a copy', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const name = `Restore ${randomUUID().slice(0, 8)}`;
  const type = { name, color: '#336699', medium: 'FIBER', members: ['1', '2'], compatibility_mode: 'SAME_TYPE' };
  const ports = await request.post('/api/v1/port-types', { data: type });
  expect(ports.ok(), await ports.text()).toBe(true);
  const { id: portType } = await ports.json();
  const definitions = '/api/v1/library/base-templates';
  const definition: CreateBaseTemplateRequest = {
    name, body: { kind: 'RECTANGLE', width: 160, height: 60, fill_color: '#28565a' },
    panels: [{ panel_key: 'panel', panel_number: 1, display_name: 'Front', x: 0, y: 0, width: 160, height: 60 }],
    slots: ['a', 'b'].map((key, index) => ({
      key, display_name: key.toUpperCase(), kind: 'CONNECTION_POINT', port_type_id: portType, cardinality: 2,
      panel_key: 'panel', rendered_position: { x: .3 + .4 * index, y: .5 },
    })),
    internal_links: [{ from_slot_key: 'a', to_slot_key: 'b', member_mappings: [
      { from_member_index: 1, to_member_index: 2 }, { from_member_index: 2, to_member_index: 1 },
    ] }],
  };
  const created = await request.post(definitions, { data: definition });
  expect(created.ok(), await created.text()).toBe(true);
  const { blueprint_ref, version_ref } = await created.json();
  const url = `${definitions}/${blueprint_ref.entity_id}/draft`;
  const get = async (): Promise<BaseTemplateDraftDocument> => (await request.get(url)).json();
  const source = await get();
  const incompatible = await request.put(`${url}?expected_generation=${source.generation}`, {
    data: { ...definition, name: 'Incompatible saved draft', slots: definition.slots.slice(1), internal_links: [] },
  });
  expect(incompatible.ok(), await incompatible.text()).toBe(true);
  const saved = await get();
  const archive = await request.put(`/api/v1/port-types/${portType}`, { data: { ...type, is_active: false } });
  expect(archive.ok(), await archive.text()).toBe(true);
  const conflict = await request.post(`${url}/restore-source?expected_generation=${source.generation}`);
  expect((await conflict.json()).error.details.reason).toBe('DRAFT_CONFLICT');

  await page.goto(`/library/base-templates/${blueprint_ref.entity_id}/edit`);
  await page.getByRole('button', { name: 'Проверить изменения' }).click();
  const restore = page.getByRole('button', { name: 'Восстановить опубликованное определение' });
  await restore.click();
  const confirmation = page.getByRole('dialog', { name: 'Восстановить опубликованное определение' });
  await expect(confirmation.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(restore).toBeFocused();
  expect((await get()).generation).toBe(saved.generation);
  const nameField = page.getByLabel('Название шаблона');
  await nameField.fill('Unsaved local work');
  await expect(page.getByText('Сохранено локально', { exact: true })).toBeVisible();
  await restore.click();
  await page.screenshot({ path: testInfo.outputPath('restore-confirmation.png') });
  let releaseRestore!: () => void;
  const holdRestore = new Promise<void>(resolve => { releaseRestore = resolve; });
  let restoreRequests = 0;
  const restorePath = '**/draft/restore-source?*';
  await page.route(restorePath, async route => {
    restoreRequests++;
    await holdRestore;
    await route.continue();
  });
  try {
    const confirm = confirmation.getByRole('button', { name: 'Восстановить', exact: true });
    await confirm.click();
    const pending = confirmation.getByRole('status');
    await expect(pending).toHaveText('Восстанавливаем черновик…');
    await expect(pending).toBeFocused();
    await expect(confirm).toBeDisabled();
    await expect(confirmation.getByRole('button', { name: 'Отмена' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await nameField.evaluate((field: HTMLInputElement) => field.focus());
    await expect(pending).toBeFocused();
    await page.keyboard.type('Ignored');
    await page.keyboard.press('Enter');
    await expect(nameField).toHaveValue('Unsaved local work');
    await expect(confirmation).toBeVisible();
    await expect.poll(() => restoreRequests).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('restore-pending.png') });
  } finally {
    releaseRestore();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await expect(page.getByText('Черновик восстановлен из опубликованной ревизии.')).toBeFocused();
  expect(restoreRequests).toBe(1);
  await expect(page.getByRole('button', { name: 'Проверить изменения' })).toBeEnabled();
  const restored = await get();
  expect(restored.definition).toEqual(source.definition);
  expect(restored.generation).toBe(saved.generation + 1);
  const ordinary = await request.post(`${url}/restore-source?expected_generation=${restored.generation}`);
  expect((await ordinary.json()).error.details.reason).toBe('DRAFT_RESTORE_NOT_REQUIRED');
  await page.reload();
  await expect(page.getByLabel('Название шаблона')).toHaveValue(name);
  await expect(page.getByRole('button', { name: 'Восстановить опубликованное определение' })).toHaveCount(0);

  await page.evaluate(() => localStorage.setItem('netmap.locale', 'en'));
  await page.goto(`/library/base-templates/new?copyTemplate=${blueprint_ref.entity_id}&copyRevision=${version_ref.entity_id}`);
  const endpoint = page.locator('[data-slot-key="a"] [data-endpoint-marker]');
  await endpoint.click();
  const remove = page.locator('.blueprint-composer__selected').getByRole('button', { name: 'Remove', exact: true });
  await remove.click();
  const deletion = page.getByRole('dialog', { name: 'Remove wired endings' });
  await expect(deletion).toHaveAccessibleDescription(/endings \(1\).*pairs \(2\)/);
  const cancel = deletion.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('delete-confirmation.png') });
  await cancel.click();
  await expect(remove).toBeFocused();
  await expect(endpoint).toBeVisible();
  await remove.click();
  await page.keyboard.press('Escape');
  await expect(endpoint).toBeVisible();
  await remove.click();
  await deletion.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(endpoint).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ports and internal links · 0' })).toBeFocused();
  expect((await get()).definition).toEqual(source.definition);
});
