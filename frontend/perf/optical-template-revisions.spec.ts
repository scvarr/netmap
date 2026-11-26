import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

for (const kind of ['base', 'module'] as const) {
  test(kind + ' template edits fiber types and reconciles a selected instance', async ({ page, request }) => {
    const name = kind + ' optical ' + randomUUID().slice(0, 8);
    const post = async (path: string, data: unknown) => {
      const response = await request.post('/api/v1' + path, { data });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    const port = await post('/port-types', { name, color: '#336699', medium: 'FIBER',
      members: ['1', '2'], compatibility_mode: 'SAME_TYPE' });
    const endpoints = ['rear', 'front'].map(key => ({ key, display_name: key, port_type_id: port.id, kind: 'CONNECTION_POINT' }));
    const mappings = [{ from_member_index: 1, to_member_index: 2, fiber_type: 'MM' },
      { from_member_index: 2, to_member_index: 1, fiber_type: 'NO_FIBER' }];
    const base = {
      name, body: { kind: 'RECTANGLE', width: 160, height: 70 },
      panels: [{ panel_key: 'p', panel_number: 1, display_name: 'Front', x: 0, y: 0, width: 160, height: 70 }],
      slots: endpoints.map((endpoint, index) => ({ ...endpoint, panel_key: 'p', cardinality: 2,
        rendered_position: { x: .2 + index * .6, y: .5 } })),
      internal_links: [{ from_slot_key: 'rear', to_slot_key: 'front', member_mappings: mappings }],
    };
    let moduleId: string | undefined;
    let bayType: string | undefined;
    if (kind === 'module') {
      bayType = (await post('/module-bay-types', { name })).id;
      const model = await post('/library/module-templates', {
        name, mount_kind: 'MODULE_BAY', module_bay_type_id: bayType, endpoints,
        geometry: { width: 160, height: 50, fill_color: "#336699",
          endpoints: { rear: { x: .2, y: .5 }, front: { x: .8, y: .5 } } },
        internal_links: [{ from_endpoint_key: 'rear', to_endpoint_key: 'front', member_mappings: mappings }],
      });
      moduleId = model.template_id;
    }
    const host = await post('/library/base-templates', moduleId ? { ...base, internal_links: [],
      bays: [{ bay_key: 'board', display_name: 'Board', mount_kind: 'MODULE_BAY', module_bay_type_id: bayType, panel_key: 'p', kind: 'LOGICAL' }],
    } : base);
    const baseId = host.blueprint_ref.entity_id;
    for (const letter of ['A', 'B']) {
      const object = await post('/topology/physical-objects', { base_template_id: baseId, display_name: name + ' ' + letter });
      if (moduleId) await post('/topology/physical-objects/' + object.physical_object_ref.entity_id + '/module-installations',
        { module_template_id: moduleId, bay_key: 'board', orientation: 'HORIZONTAL' });
    }
    const path = '/library/' + kind + '-templates/' + (moduleId ?? baseId);
    const viewport = kind === 'base' ? { width: 1440, height: 900 } : { width: 1024, height: 768 };
    await page.setViewportSize(viewport);
    await page.goto(path + '/edit');
    const openWiring = async () => {
      await page.getByRole('button', { name: kind === 'base' ? /Порты и внутренние связи/ : 'Внутренние связи' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('tab', { name: /Существующие связи/ }).click();
      return dialog;
    };
    const wiring = await openWiring();
    const individual = wiring.getByRole('combobox', { name: /^Тип волокна · / });
    await expect(individual).toHaveCount(2);
    const values = () => individual.evaluateAll(elements => elements.map(element => (element as HTMLSelectElement).value));
    expect((await values()).sort()).toEqual(['MM', 'NO_FIBER']);
    await wiring.getByRole('combobox', { name: 'Назначить всем показанным парам' }).selectOption('SM');
    expect(await values()).toEqual(['SM', 'SM']);
    await individual.last().selectOption('NO_FIBER');
    const evidence = process.env.L1_OPTICAL_EVIDENCE_DIR;
    if (evidence) await page.screenshot({ path: join(evidence, kind + '-fiber-wiring.png') });
    await wiring.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
    await expect(page.getByText('Черновик сохранён', { exact: true })).toBeVisible();
    await page.reload();
    await openWiring();
    expect((await values()).sort()).toEqual(['NO_FIBER', 'SM']);
    await wiring.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(page.getByText(/Публикация завершена/)).toBeVisible();
    await page.getByText('Выбор экземпляров', { exact: true }).click();
    const selection = page.getByRole('group', { name: 'Выбор экземпляров' });
    await selection.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: 'Обновить выбранные' }).click();
    await expect(selection.getByRole('checkbox')).toHaveCount(1);
  });
}
