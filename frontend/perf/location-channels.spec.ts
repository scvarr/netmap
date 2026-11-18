import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.goto('/perf/location-channels.html');
  await expect(page.locator('.location-frame[data-location-id="rack"]')).toBeVisible();
  await page.getByRole('button', { name: 'zoom 1', exact: true }).click();
});

test('shows free channels on a cable-free L1 map and composes the active variant', async ({ page }) => {
  const network = (id: string) => page.locator(`[data-channel-location="${id}"] path`);
  const frame = (id: string) => page.locator(`.location-frame[data-location-id="${id}"]`);
  const rack = network('rack'), parent = network('building');
  const toggle = page.getByRole('button', { name: 'Показать все кабельные каналы' });
  await expect(rack).toBeHidden();
  await toggle.click();
  for (const id of ['rack', 'building', '']) await expect(network(id)).toBeVisible();
  await expect(network('empty')).toHaveCount(0);
  await expect(frame('empty').locator('[data-boundary-point-id="point-empty"]')).toBeVisible();
  await expect(page.locator('.cable-route-foreground--normal')).toHaveCount(0);
  await expect(page.locator('.location-channel-layer desc')).toHaveCount(0);

  async function expectBoundary(path: typeof rack, id: string) {
    const left = await frame(id).evaluate(el => parseFloat(el.style.left));
    const top = await frame(id).evaluate(el => parseFloat(el.style.top));
    const point = await frame(id).locator('.location-boundary-point').evaluate(el => ({
      x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top),
    }));
    const starts = [...(await path.getAttribute('d') ?? '').matchAll(/M ([^ ]+) ([^ ]+) L/g)];
    expect(starts.some(([, x, y]) => Math.abs(Number(x) - left - point.x) < 0.01
      && Math.abs(Number(y) - top - point.y) < 0.01)).toBe(true);
  }
  await expectBoundary(parent, 'empty');
  await expectBoundary(parent, 'rack');
  await expectBoundary(rack, 'rack');

  const original = await rack.getAttribute('d');
  for (const zoom of [0.35, 2, 1]) {
    await page.getByRole('button', { name: `zoom ${zoom}`, exact: true }).click();
    await expect(rack).toBeVisible();
    await expect(rack).toHaveAttribute('d', original!);
  }
  const marker = await frame('rack').locator('.location-boundary-point').boundingBox();
  const bounds = await frame('rack').boundingBox();
  const parentBefore = await parent.getAttribute('d');
  await page.mouse.move(marker!.x + marker!.width / 2, marker!.y + marker!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.6, bounds!.y + bounds!.height, { steps: 6 });
  await page.mouse.up();
  await expect(rack).not.toHaveAttribute('d', original!);
  await expect(parent).not.toHaveAttribute('d', parentBefore!);
  const draft = await rack.getAttribute('d');
  await frame('rack').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(rack).toHaveAttribute('d', draft!);
  await expect(frame('rack').locator('.location-boundary-point')).toHaveAttribute('data-boundary-point-id', 'point-rack');

  await page.getByRole('button', { name: 'Reflow' }).click();
  await expect(rack).not.toHaveAttribute('d', draft!);
  await expectBoundary(parent, 'rack');
  const reflowed = await rack.getAttribute('d');
  await page.getByRole('button', { name: 'Switch variant' }).click();
  await expect(rack).not.toHaveAttribute('d', reflowed!);
  await page.getByRole('button', { name: 'Switch variant' }).click();
  await expect(rack).toHaveAttribute('d', reflowed!);

  await page.getByRole('button', { name: 'Partial collapse' }).click();
  await expect(page.locator('.react-flow__node[data-id="switch"]')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="server"]')).toHaveCount(0);
  await expect(rack).toBeVisible();
  await expect(rack).not.toHaveAttribute('d', reflowed!);
  await frame('rack').locator('button[title^="Развернуть"]').click();
  await expect(rack).toHaveAttribute('d', reflowed!);
  await frame('rack').locator('button[title^="Свернуть"]').click();
  await expect(rack).toHaveCount(0);
  await expect(parent).toBeVisible();
  await expect(page.locator('.location-proxy [data-boundary-point-id="point-rack"]')).toBeVisible();
  await page.locator('.location-proxy button').click();
  await expect(rack).toHaveAttribute('d', reflowed!);
  await page.getByRole('button', { name: 'Hide empty' }).click();
  await expect(frame('empty')).toHaveCount(0);
  await expect(parent).toBeVisible();
  await page.getByRole('button', { name: 'Hide empty' }).click();
  await expect(frame('empty')).toBeVisible();
  await page.getByRole('button', { name: 'Reassign equipment' }).click();
  await expect(rack).not.toHaveAttribute('d', reflowed!);
  await expect(parent).toBeVisible();
  await page.getByRole('button', { name: 'Reassign equipment' }).click();
  await expect(rack).toHaveAttribute('d', reflowed!);
  await toggle.click();
  await expect(rack).toBeHidden();
});

test('rebuilds from manual object movement and Location resize drafts', async ({ page }) => {
  await page.getByRole('button', { name: 'Manual layout' }).click();
  await page.getByRole('button', { name: 'Показать все кабельные каналы' }).click();
  const rack = page.locator('[data-channel-location="rack"] path');
  await expect(rack).toBeVisible();
  const initial = await rack.getAttribute('d');
  const device = (await page.locator('.react-flow__node[data-id="switch"]').boundingBox())!;
  await page.mouse.move(device.x + 40, device.y + 28);
  await page.mouse.down();
  await page.mouse.move(device.x + 65, device.y + 38, { steps: 8 });
  await page.mouse.up();
  await expect(rack).not.toHaveAttribute('d', initial!);

  const moved = await rack.getAttribute('d');
  await page.getByRole('button', { name: 'Resize equipment' }).click();
  await expect(rack).not.toHaveAttribute('d', moved!);
  const wider = await rack.getAttribute('d');
  const frame = page.locator('.location-frame[data-location-id="rack"]');
  await frame.locator('.location-boundary-point').click();
  const resize = (await frame.locator('.location-frame__resize').boundingBox())!;
  await page.mouse.move(resize.x + 9, resize.y + 9);
  await page.mouse.down();
  await page.mouse.move(resize.x + 36, resize.y + 25, { steps: 8 });
  await page.mouse.up();
  await expect(rack).not.toHaveAttribute('d', wider!);
  await frame.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(rack).toHaveAttribute('d', wider!);
});
