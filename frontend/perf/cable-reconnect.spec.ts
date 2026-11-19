import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('moves an existing cable on a saved physical variant and rereads after a projection failure', async ({ page, request }) => {
  const name = `Reconnect smoke ${randomUUID()}`;
  const api = async (path: string, data?: unknown) => {
    const url = `/api/v1${path}`;
    const response = data ? await request.post(url, { data }) : await request.get(url);
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const portType = await api('/port-types', { name, color: '#336699' });
  const template = await api('/library/base-templates', {
    name, body: { kind: 'RECTANGLE', width: 180, height: 80 },
    panels: [{ panel_key: 'ports', panel_number: 1, display_name: 'Patch', x: 0, y: 0, width: 180, height: 80 }],
    slots: [1, 2].map(number => ({
      key: `p${number}`, display_name: `P${number}`, port_type_id: portType.id, kind: 'CONNECTION_POINT',
      panel_key: 'ports', rendered_position: { x: number / 3, y: 0.5 },
    })),
    internal_links: [],
  });
  const [a, b] = await Promise.all(['Smoke A', 'Smoke B'].map(async label => {
    const result = await api('/topology/physical-objects', { display_name: label, base_template_id: template.blueprint_ref.entity_id });
    return {
      id: result.physical_object_ref.entity_id,
      ports: result.slots.map((slot: { connection_point_ref: { entity_id: string } }) => slot.connection_point_ref.entity_id) as string[],
    };
  }));
  const endpoint = (connection_point_id: string) => ({ kind: 'CONNECTION_POINT', connection_point_id, member_index: 1 });
  const cable = await api('/topology/physical-connections', { source: endpoint(a.ports[0]), target: endpoint(b.ports[0]), cable_label: name });
  const cableId = cable.cable_ref.entity_id;
  const reconnectUrl = `/cables/${cableId}/reconnect`;
  const before = await api(reconnectUrl);
  const map = await api('/maps', { name });
  const mapId = map.map_ref.entity_id;
  for (const [index, object] of [a, b].entries()) {
    await api(`/maps/${mapId}/placements`, { physical_object_id: object.id, x: 180 + 550 * index, y: 180 });
  }
  const variant = await api(`/maps/${mapId}/presentation-variants`, {
    name: 'Reconnect variant', source_variant_id: map.active_variant_ref.entity_id,
  });
  const mapDetailUrl = `/maps/${mapId}?variant_id=${variant.variant_ref.entity_id}`;
  const savedMapBefore = await api(mapDetailUrl);
  const url = `/map?map=${mapId}&variant=${variant.variant_ref.entity_id}&view=physical`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  const route = page.locator(`path[data-cable-ids*="${cableId}"]`);
  const geometry = () => route.evaluateAll(paths => paths.map(path => path.getAttribute('d')));
  const port = (id: string) => page.locator(`.blueprint-map-node__port[data-connection-point-id="${id}"]`);
  await expect(port(b.ports[0])).toHaveCSS('background-color', 'rgb(51, 102, 153)');
  await expect(port(b.ports[1])).toHaveCSS('background-color', 'rgb(10, 21, 24)');
  const originalRoute = await geometry();
  expect(originalRoute.length).toBeGreaterThan(0);
  const hits = page.locator('.cable-route-hit');
  await expect(hits.first()).toBeAttached();
  const mid = await hits.evaluateAll(elements => {
    for (const element of elements as SVGPathElement[]) {
      const point = element.getPointAtLength(element.getTotalLength() / 2).matrixTransform(element.getScreenCTM()!);
      if (document.elementFromPoint(point.x, point.y) === element) return { x: point.x, y: point.y };
    }
    return null;
  });
  expect(mid).not.toBeNull();
  await page.mouse.click(mid!.x, mid!.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Переподключить' }).click();
  const dialog = page.getByRole('dialog', { name: 'Переподключить' });
  await dialog.getByLabel('Переносимое окончание').selectOption('B');
  await dialog.getByLabel('Целевой физический объект').selectOption(b.id);
  await expect(dialog.getByRole('option', { name: 'P1 · Подключён' })).toHaveJSProperty('disabled', true);
  await dialog.getByLabel('Порт').selectOption(b.ports[1]);
  await dialog.getByRole('button', { name: 'Предпросмотр' }).click();
  await expect(dialog.getByRole('heading', { name })).toBeVisible();
  await expect(dialog.getByText(/Smoke B .* P1/)).toBeVisible();
  await expect(dialog.getByText(/Smoke B .* P2/)).toBeVisible();

  const viewport = () => page.locator('.react-flow__viewport').evaluate(el => (el as HTMLElement).style.transform);
  const positions = () => page.locator('.react-flow__node').evaluateAll(nodes =>
    nodes.map(el => [(el as HTMLElement).dataset.id, (el as HTMLElement).style.transform]).sort());
  const viewportBefore = await viewport();
  const positionsBefore = await positions();
  let writes = 0;
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith(reconnectUrl)) writes++; });
  await page.route('**/api/v1/topology/projection', route => route.abort(), { times: 1 });
  await dialog.getByRole('button', { name: 'Подтвердить переподключение' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Кабель переподключён');
  await dialog.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toBe(1);
  await expect(port(b.ports[0])).toHaveCSS('background-color', 'rgb(10, 21, 24)');
  await expect(port(b.ports[1])).toHaveCSS('background-color', 'rgb(51, 102, 153)');
  expect(await geometry()).not.toEqual(originalRoute);
  await expect(page).toHaveURL(new URL(url, page.url()).href);
  expect(await viewport()).toBe(viewportBefore);
  expect(await positions()).toEqual(positionsBefore);
  expect(await api(mapDetailUrl)).toEqual(savedMapBefore);
  expect(await api(reconnectUrl)).toEqual({ ...before, expected: { ...before.expected, point_b_id: b.ports[1] } });

  const details = await api(`/topology/physical-objects/${b.id}`);
  const [oldPoint, newPoint] = b.ports.map(id => details.connection_points.find(
    (point: { connection_point_ref: { entity_id: string } }) => point.connection_point_ref.entity_id === id,
  ));
  expect(oldPoint.external_connection_count).toBe(0);
  expect(newPoint.external_physical_attachments).toMatchObject([{
    cable_ref: { entity_id: cableId }, connection_ref: { entity_id: before.expected.connection_id }, cable_label: name,
  }]);
  const trace = await api('/traces/physical-objects/l1', {
    from_physical_object_id: a.id, to_physical_object_id: b.id,
    from_connection_point_id: a.ports[0], to_connection_point_id: b.ports[1],
  });
  expect(trace.verdict).toBe('REACHABLE');
  const ids = trace.evidence_refs.map((ref: { entity_id: string }) => ref.entity_id);
  expect(ids).toEqual(expect.arrayContaining([b.ports[1], before.expected.connection_id, before.expected.connection_member_id]));
  expect(ids).not.toContain(b.ports[0]);

  await page.goto(`/infrastructure/objects/${b.id}/physical`);
  await expect(page.getByRole('row', { name: /^P1 / }).getByRole('cell', { name: 'Свободен' })).toBeVisible();
  await expect(page.getByRole('row', { name: /^P2 / }).getByRole('cell', {
    name: `${name} · Smoke A / Patch / P1`,
  })).toBeVisible();
});
