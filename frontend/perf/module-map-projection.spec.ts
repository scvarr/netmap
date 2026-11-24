import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('renders direct and board SFP sockets and reveals the real rear Cable endpoint', async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const name = 'FN-010 ' + randomUUID().slice(0, 8);
  const post = async (path: string, data: object) => {
    const response = await request.post('/api/v1' + path, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const port = await post('/port-types', {
    name, color: '#336699', medium: 'FIBER', members: ['1'], compatibility_mode: 'SAME_TYPE',
  });
  const sfp = await post('/module-port-types', { name });
  const bay = await post('/module-bay-types', { name });
  const sfpMount = { mount_kind: 'MODULE_PORT', module_port_type_id: sfp.id };
  const boardMount = { mount_kind: 'MODULE_BAY', module_bay_type_id: bay.id };
  const board = await post('/library/module-templates', {
    name: name + ' board', ...boardMount,
    geometry: { width: 180, height: 45, fill_color: '#64748b', endpoints: {
      mgmt: { x: .2, y: .25 }, monitor: { x: .8, y: .25 },
    } },
    endpoints: [
      { key: 'mgmt', display_name: 'Board MGMT', kind: 'NETWORK_PORT', port_type_id: port.id },
      { key: 'monitor', display_name: 'Board monitor', kind: 'CONNECTION_POINT', port_type_id: port.id },
    ],
    module_places: [.3, .7].map((x, index) => ({
      key: 'sfp-' + index, display_name: 'Board SFP ' + index, ...sfpMount,
      hardware_interface_key: randomUUID(), x, y: .75,
    })),
  });
  const optic = await post('/library/module-templates', {
    name: name + ' optic', ...sfpMount, transceiver: { fiber_type: 'SM' },
    geometry: { width: 40, height: 20, fill_color: '#64748b', endpoints: { optical: { x: .5, y: .5 } } },
    endpoints: [{ key: 'optical', display_name: 'Optical', kind: 'CONNECTION_POINT', port_type_id: port.id }],
  });
  const panel = (panel_key: string, panel_number: number, face: string, y: number) =>
    ({ panel_key, panel_number, face, display_name: panel_key, x: 0, y, width: 480, height: 90 });
  const slot = {
    key: 'mgmt', panel_key: 'front', display_name: 'Chassis MGMT', kind: 'NETWORK_PORT',
    port_type_id: port.id, rendered_position: { x: .98, y: .5 },
  };
  const socket = (index: number, x: number) => ({
    bay_key: 'direct-' + index, panel_key: 'front', display_name: 'Direct SFP ' + index,
    kind: 'PLACED', ...sfpMount, x, y: .5, hardware_interface_key: randomUUID(),
  });
  const chassis = await post('/library/base-templates', {
    name: name + ' chassis', body: { kind: 'RECTANGLE', width: 480, height: 180 },
    panels: [panel('front', 1, 'FRONT', 0), panel('rear', 2, 'REAR', 90)], slots: [slot],
    bays: [socket(0, .3), socket(1, .6), { bay_key: 'board', display_name: 'Board',
      panel_key: 'rear', kind: 'LOGICAL', ...boardMount }],
  });
  const dense = await post('/library/base-templates', {
    name: name + ' dense', body: { kind: 'RECTANGLE', width: 480, height: 90 },
    panels: [panel('front', 1, 'FRONT', 0)], slots: [slot],
    bays: Array.from({ length: 48 }, (_, index) => socket(index, (index + 1) / 50)),
  });
  const object = (display_name: string, template = chassis) => post('/topology/physical-objects', {
    base_template_id: template.blueprint_ref.entity_id, display_name,
  });
  const ids: string[] = [];
  for (const [label, template] of [['Horizontal', chassis], ['Vertical', chassis], ['Dense', dense]] as const) {
    ids.push((await object(name + ' ' + label, template)).physical_object_ref.entity_id);
  }
  const [horizontal, vertical, packed] = ids;
  const install = (id: string, template: typeof board, bay_key: string, orientation = 'HORIZONTAL', parent_installation_id?: string) =>
    post(`/topology/physical-objects/${id}/module-installations`, {
      module_template_id: template.template_id, bay_key, orientation, parent_installation_id,
    });
  const [horizontalBoard, verticalBoard] = await Promise.all([
    install(horizontal, board, 'board'), install(vertical, board, 'board', 'VERTICAL'),
  ]).then(trees => trees.map(tree => tree.bays.find((item: { bay_key: string }) => item.bay_key === 'board').installation));
  const map = await post('/maps', { name });
  const mapID = map.map_ref.entity_id;
  const variantID = map.active_variant_ref.entity_id;
  const faceURL = `/api/v1/maps/${mapID}/presentation-variants/${variantID}/face`;
  for (const [index, id] of ids.entries()) {
    await post(`/maps/${mapID}/placements`, { physical_object_id: id, x: 100 + index * 430, y: 180 });
  }
  const url = `/map?map=${mapID}&variant=${variantID}&view=physical`;
  await page.goto(url);
  const node = (label: string) => page.getByTestId('blueprint-map-node').filter({ hasText: name + ' ' + label });
  const h = node('Horizontal'), v = node('Vertical'), d = node('Dense');
  const sockets = '[data-module-socket-key]';
  const transceivers = '.blueprint-map-node__port--transceiver';
  await expect(h.locator(sockets)).toHaveCount(2);
  await expect(h.locator(sockets).first()).not.toHaveAttribute('tabindex');
  await expect(h.locator(sockets).first()).not.toHaveAttribute('data-connection-point-id');
  await expect(d.locator(sockets)).toHaveCount(48);
  const positions = await d.locator(`${sockets}, .blueprint-map-node__port`).evaluateAll(markers =>
    markers.map(marker => {
      const rect = marker.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }).sort((a, b) => a.left - b.left));
  expect(positions.every((marker, index) => index === 0 || marker.left > positions[index - 1].right)).toBe(true);
  await expect(d.getByRole('button', { name: 'Порт Chassis MGMT' })).toHaveCSS('border-radius', '0px');
  await expect(d.getByRole('button', { name: 'Порт Chassis MGMT' })).toHaveAttribute('tabindex', '0');

  const directTree = await install(horizontal, optic, 'direct-0');
  const directPoint = directTree.bays.find((item: { bay_key: string }) => item.bay_key === 'direct-0')
    .installation.endpoints[0].connection_point_id;
  await page.reload();
  await expect(h.locator(sockets)).toHaveCount(1);
  const directMarker = h.locator(`${transceivers}[data-connection-point-id="${directPoint}"]`);
  await expect(directMarker).toHaveCSS('border-radius', '0px');
  await expect(directMarker).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await directMarker.evaluate(el => getComputedStyle(el, '::after').borderTopColor)).toBe('rgb(148, 163, 184)');

  const setFace = async (face: 'FRONT' | 'REAR') => {
    const response = await request.put(faceURL, { data: { face } });
    expect(response.ok(), await response.text()).toBe(true);
    await page.reload();
  };
  await setFace('REAR');
  for (const [equipment, installed] of [[h, horizontalBoard], [v, verticalBoard]] as const) {
    const body = equipment.locator(`[data-installation-id="${installed.id}"]`);
    await expect(body).toBeVisible();
    await expect(equipment.locator(sockets)).toHaveCount(2);
    for (const axis of ['width', 'height'] as const) {
      expect(await body.evaluate((el, axis) => parseFloat(el.style[axis]), axis)).toBeCloseTo(installed.layout[axis] * 100);
    }
    await expect(equipment.locator('.blueprint-map-node__port--network_port')).toHaveCSS('border-radius', '0px');
    await expect(equipment.locator('.blueprint-map-node__port--connection_point')).toHaveCSS('border-radius', '50%');
  }
  const tree = await install(vertical, optic, 'sfp-0', 'HORIZONTAL', verticalBoard.id);
  const nestedPoint = tree.nested_installations[0].endpoints[0].connection_point_id;
  await page.reload();
  await expect(v.locator(sockets)).toHaveCount(1);
  await expect(v.locator(transceivers)).toHaveAttribute('data-connection-point-id', nestedPoint);
  await h.getByRole('combobox', { name: /Физический вид/ }).selectOption('FRONT');
  await directMarker.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Соединить от этого порта' }).click();
  await v.locator(transceivers).focus();
  await page.keyboard.press('Enter');
  const wiring = page.getByRole('dialog', { name: 'Соединить порты' });
  await wiring.getByLabel('Имя кабеля').fill(name + ' cable');
  const creation = page.waitForResponse(response =>
    response.request().method() === 'POST' && response.url().endsWith('/physical-connections'));
  await wiring.getByRole('button', { name: 'Создать кабель' }).click();
  const result = await creation;
  expect(result.status(), await result.text()).toBe(201);
  const cable = await result.json();
  const cableId = cable.cable_ref.entity_id;
  await setFace('FRONT');
  for (let reload = 0; reload < 2; reload++) {
    await expect(v.locator(transceivers)).toHaveCount(0);
    await expect(page.locator(`path[data-cable-ids*="${cableId}"]`).first()).toBeAttached();
    const hit = page.getByRole('button', { name: name + ' cable ·', exact: false })
      .and(page.locator('.cable-route-hit')).first();
    await expect(hit).toBeAttached();
    await hit.focus();
    await page.keyboard.press('Enter');
    await expect(v.locator(transceivers)).toHaveAttribute('data-connection-point-id', nestedPoint);
    await expect(page.locator(`.cable-endpoint-halo[data-emphasis="selected"][data-cable-endpoint="${nestedPoint}"]`)).toBeVisible();
    await expect(v.locator(transceivers)).toHaveAttribute('tabindex', '0');
    await expect(v.locator(transceivers)).toHaveCSS('background-color', 'rgb(51, 102, 153)');
    await page.reload();
  }
  await v.getByRole('combobox', { name: /Физический вид/ }).selectOption('REAR');
  await v.locator(transceivers).click({ button: 'right' });
  const deletion = page.waitForResponse(response => response.request().method() === 'DELETE' &&
    response.url().endsWith(`/physical-connections/${cable.connection_ref.entity_id}`));
  page.once('dialog', confirmation => confirmation.accept());
  await page.getByRole('menuitem', { name: 'Разъединить' }).click();
  expect((await deletion).status()).toBe(204);
  await expect(page.locator(`path[data-cable-ids*="${cableId}"]`)).toHaveCount(0);
  await expect(v.locator(transceivers)).toHaveAttribute('data-connection-point-id', nestedPoint);

});
