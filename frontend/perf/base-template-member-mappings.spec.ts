import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { CreateBaseTemplateRequest } from '../src/topology/baseTemplateTypes';

const library = '/api/v1/library/base-templates';

function namedPairs(definition: CreateBaseTemplateRequest) {
  const names = new Map(definition.slots.map(slot => [slot.key, slot.display_name]));
  return definition.internal_links.flatMap(link => link.member_mappings!.map(mapping => [
    `${names.get(link.from_slot_key)}:${mapping.from_member_index}`,
    `${names.get(link.to_slot_key)}:${mapping.to_member_index}`,
  ].sort().join(' ↔ '))).sort();
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }]) {
  test(`authors, reloads, publishes and copies exact BaseTemplate member pairs at ${viewport.width}×${viewport.height}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize(viewport);
    page.setDefaultTimeout(10000);
    const capture = async (name: string) => {
      const path = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path });
      return path;
    };
    const name = `Member mapping ${randomUUID().slice(0, 8)}`;
    const createType = async (members: string[]) => {
      const response = await request.post('/api/v1/port-types', {
        data: { name: `${name} / ${members.length}`, color: '#336699', medium: 'FIBER', members, compatibility_mode: 'SAME_TYPE' },
      });
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()).id as string;
    };
    const trunkType = await createType(Array.from({ length: 24 }, (_, index) => `F${index + 1}`));
    const singleType = await createType(['1']);

    await page.goto('/library/base-templates/new');
    await page.getByLabel('Название шаблона').fill(name);
    await page.getByLabel('Название панели').fill('Rear');
    const creator = page.locator('.template-element-creator');
    const addPoints = async (type: string, count: number) => {
      await creator.getByLabel('Вид точки').selectOption('CONNECTION_POINT');
      await creator.getByLabel('Тип порта').selectOption(type);
      await creator.getByLabel('Количество').fill(String(count));
      await creator.getByRole('button', { name: 'Добавить', exact: true }).click();
    };
    await addPoints(trunkType, 1);
    await page.getByRole('button', { name: 'Добавить справа' }).click();
    await page.getByLabel('Название панели').fill('Front');
    await addPoints(singleType, 24);

    const entry = page.getByRole('button', { name: /Порты и внутренние связи ·/ });
    const dialog = page.getByRole('dialog', { name: 'Порты и внутренние связи' });
    const a = dialog.getByRole('region', { name: 'A', exact: true });
    const b = dialog.getByRole('region', { name: 'B', exact: true });
    const existing = dialog.getByRole('tab', { name: /Существующие связи/ });
    const apply = dialog.getByRole('button', { name: 'Создать связи', exact: true });
    const preview = dialog.getByRole('table', { name: 'Предпросмотр пар' });
    const existingTable = dialog.getByRole('table', { name: 'Внутренние связи' });
    const pairRows = () => existingTable.locator('tbody tr');
    const count = (n: number) => dialog.getByText(`Пар к применению: ${n}`, { exact: true });
    const loadDraft = async (id: string) => {
      const response = await request.get(`${library}/${id}/draft`);
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    const createTemplate = async () => {
      const pending = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(library));
      await page.getByRole('button', { name: 'Сохранить шаблон' }).click();
      const response = await pending;
      expect(response.status(), await response.text()).toBe(201);
      const template = await response.json();
      return template.blueprint_ref.entity_id as string;
    };

    await entry.press('Enter');
    const close = dialog.getByRole('button', { name: 'Закрыть', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('tab', { name: 'Порты и операции' })).toBeFocused();
    await a.getByRole('combobox', { name: 'A', exact: true }).selectOption({ label: 'Rear' });
    await b.getByRole('combobox', { name: 'B', exact: true }).selectOption({ label: 'Front' });
    const disclosure = a.getByText('1-1 · каналы (24)', { exact: true });
    await disclosure.press('Enter');
    const member = (index: number) => a.getByRole('checkbox', { name: `1-1 · Канал ${index} · F${index} · Rear`, exact: true });
    await a.getByRole('button', { name: 'Выбрать свободные каналы' }).click();
    await b.getByRole('button', { name: 'Выбрать все', exact: true }).click();
    await expect(count(24)).toBeVisible();
    await disclosure.scrollIntoViewIfNeeded();
    await testInfo.attach('member-selection', { path: await capture('member-selection'), contentType: 'image/png' });
    const secondB = preview.getByRole('combobox', { name: 'Пара 2 · заменить или переставить окончание B' });
    const firstB = preview.getByRole('combobox', { name: 'Пара 1 · заменить или переставить окончание B' });
    await firstB.focus();
    await firstB.selectOption({ label: '2-2 · Front' });
    await expect(secondB.locator('option:checked')).toHaveText('2-1 · Front');
    await member(24).uncheck();
    await expect(apply).toBeDisabled();
    await member(24).check();
    await expect(firstB.locator('option:checked')).toHaveText('2-1 · Front');
    await firstB.focus();
    await firstB.selectOption({ label: '2-2 · Front' });
    await preview.getByRole('button', { name: 'Исключить', exact: true }).last().click();
    await expect(count(23)).toBeVisible();
    const lastA = preview.getByRole('combobox', { name: 'Пара 23 · заменить или переставить окончание A' });
    await lastA.focus();
    await lastA.selectOption({ label: '1-1 · Канал 24 · F24 · Rear' });
    await expect(preview.getByRole('combobox', { name: 'Пара 23 · заменить или переставить окончание A' }).locator('option:checked')).toHaveText(/Канал 24/);
    const previewRegion = dialog.getByRole('region', { name: 'Предпросмотр пар' });
    expect(await previewRegion.evaluate(node => node.scrollHeight > node.clientHeight && node.scrollWidth <= node.clientWidth)).toBe(true);
    await testInfo.attach('pair-preview', { path: await capture('pair-preview'), contentType: 'image/png' });
    await apply.click();
    await existing.click();
    await expect(pairRows()).toHaveCount(23);
    await existing.press('ArrowLeft');
    await expect(dialog.getByRole('tab', { name: 'Порты и операции' })).toBeFocused();
    await b.getByRole('button', { name: 'Снять выбор', exact: true }).click();
    await a.getByText('1-1 · каналы (24)', { exact: true }).click();
    await expect(member(24)).toBeDisabled();
    await member(23).check();
    await b.getByRole('checkbox', { name: '2-24', exact: true }).check();
    await dialog.getByRole('button', { name: 'Добавить связь' }).click();
    await existing.click();
    await expect(pairRows()).toHaveCount(24);
    await page.keyboard.press('Escape');
    await expect(entry).toBeFocused();

    await expect(page.getByText('Сохранено локально', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Продолжить редактирование' }).click();
    await expect(entry).toHaveText(/· 24$/);
    const templateId = await createTemplate();
    const expected = Array.from({ length: 24 }, (_, index) => {
      const member = index + 1;
      const output = ({ 1: 2, 2: 1, 23: 24, 24: 23 } as Record<number, number>)[member] ?? member;
      return `1-1:${member} ↔ 2-${output}:1`;
    }).sort();
    expect(namedPairs((await loadDraft(templateId)).definition)).toEqual(expected);

    await page.goto(`/library/base-templates/${templateId}/edit`);
    await entry.click();
    await expect(pairRows()).toHaveCount(24);
    await expect(dialog.getByRole('button', { name: 'Удалить', exact: true })).toHaveCount(0);
    await expect(pairRows().filter({ hasText: 'Канал 24 · F24' })).toContainText('2-23');
    const existingRegion = dialog.getByRole('region', { name: 'Существующие связи' });
    await existingRegion.focus();
    await page.keyboard.press('End');
    await expect(pairRows().last()).toBeInViewport();
    await testInfo.attach('published-pairs', { path: await capture('published-pairs'), contentType: 'image/png' });
    await close.click();
    await expect(page.locator('.template-element-creator')).toHaveCount(0);

    await page.getByLabel('Название шаблона').fill(`${name} renamed`);
    await page.getByRole('button', { name: 'Сохранить черновик' }).click();
    const check = page.getByRole('button', { name: 'Проверить изменения' });
    const reviewRequest = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/draft/check'));
    await check.click();
    const reviewResponse = await reviewRequest;
    expect(reviewResponse.ok(), await reviewResponse.text()).toBe(true);
    const reviewed = await reviewResponse.json();
    expect(namedPairs(reviewed.review.definition)).toEqual(expected);
    const published = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/publish'));
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    const response = await published;
    expect(response.ok(), await response.text()).toBe(true);
    const { revision_id: revisionId } = await response.json();
    const version = await request.get(`${library}/${templateId}/versions/${revisionId}`);
    expect(version.ok()).toBe(true);
    expect(namedPairs(await version.json())).toEqual(expected);

    await page.goto(`/library/base-templates/new?copyTemplate=${templateId}&copyRevision=${revisionId}`);
    await entry.click();
    await existing.click();
    await dialog.getByRole('checkbox', { name: 'Все связи' }).check();
    await expect(pairRows()).toHaveCount(24);
    await pairRows().filter({ hasText: 'Канал 24 · F24' }).getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(pairRows()).toHaveCount(23);
    await close.click();
    await page.getByRole('group', { name: 'Панели', exact: true }).getByRole('button', { name: 'Rear' }).click();
    const trunk = page.locator('[data-slot-key]').filter({ hasText: '1-1' }).locator('[data-endpoint-hit-target]');
    const hitArea = (await trunk.boundingBox())!;
    // Click inside the marker on the side away from the panel's corner handle.
    await trunk.click({ position: { x: hitArea.width * .8, y: hitArea.height * .8 } });
    await expect(page.getByText(/сначала удалите связанные пары/)).toBeVisible();
    await expect(page.locator('.blueprint-composer__selected').getByRole('combobox', { name: 'Тип порта' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Создать связи 1:1' })).toBeDisabled();
    const copyId = await createTemplate();
    expect(copyId).not.toEqual(templateId);
    expect(namedPairs((await loadDraft(copyId)).definition)).toEqual(expected.filter(pair => !pair.startsWith('1-1:24 ')));
    expect(namedPairs((await loadDraft(templateId)).definition)).toEqual(expected);
  });
}
