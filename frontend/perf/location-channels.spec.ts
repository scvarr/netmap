import { test, expect, type Locator, type Page } from '@playwright/test';

function center(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function expectScreenTerminal(path: Locator, marker: Locator, owner: Locator) {
  const point = center((await marker.boundingBox())!);
  const box = (await owner.boundingBox())!;
  expect(Math.min(Math.abs(point.x - box.x), Math.abs(point.x - box.x - box.width),
    Math.abs(point.y - box.y), Math.abs(point.y - box.y - box.height))).toBeLessThan(0.1);
  const starts = await path.evaluate((el: SVGPathElement) => [...el.getAttribute('d')!.matchAll(/M ([^ ]+) ([^ ]+) L/g)]
    .map(([, x, y]) => new DOMPoint(Number(x), Number(y)).matrixTransform(el.getScreenCTM()!))
    .map(({ x, y }) => ({ x, y })));
  expect(starts.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 0.1)).toBe(true);
}

async function verticalRuns(path: Locator) {
  return path.evaluate((el: SVGPathElement) => {
    const toScreen = el.getScreenCTM()!;
    return [...el.getAttribute('d')!.matchAll(/M (\S+) (\S+) L (\S+) (\S+)/g)]
      .filter(([, ax, , bx]) => ax === bx)
      .map(([, ax, ay, bx, by]) => {
        const a = new DOMPoint(Number(ax), Number(ay)).matrixTransform(toScreen);
        const b = new DOMPoint(Number(bx), Number(by)).matrixTransform(toScreen);
        return { x: a.x, length: Math.abs(b.y - a.y) };
      });
  });
}

async function expectTerminalPaint(page: Page, marker: Locator) {
  const point = center((await marker.boundingBox())!);
  // Sample the centre of the opaque fill where a channel would otherwise paint.
  const png = await page.screenshot({ clip: { x: Math.floor(point.x) - 2, y: Math.floor(point.y) - 2, width: 5, height: 5 }, scale: 'css' });
  const pixel = await page.evaluate(async base64 => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(5, 5).getContext('2d')!;
    canvas.drawImage(image, 0, 0);
    return [...canvas.getImageData(2, 2, 1, 1).data];
  }, png.toString('base64'));
  expect(pixel).toEqual([25, 121, 137, 255]);
}

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
  const emptyMarker = frame('empty').locator('[data-boundary-point-id="point-empty"]');
  await expect(emptyMarker).toBeVisible();
  await expectScreenTerminal(parent, emptyMarker, frame('empty'));
  await expect(page.locator('.cable-route-foreground--normal')).toHaveCount(0);
  await expect(page.locator('.location-channel-layer desc')).toHaveCount(0);
  const rackMarker = page.locator('[data-boundary-point-id="point-rack"]');
  await expect(rackMarker).toHaveCount(1);
  await expect(rackMarker).toHaveCSS('border-radius', '50%');
  await expectScreenTerminal(rack, rackMarker, frame('rack'));
  await expectScreenTerminal(parent, rackMarker, frame('rack'));
  await expectTerminalPaint(page, rackMarker);
  const outlets = page.locator('.location-channel-outlet');
  await expect(outlets).toHaveCount(4);
  const server = page.locator('.react-flow__node[data-id="server"] .blueprint-map-node');
  const serverOutlet = page.locator('.location-channel-layer--outlets circle');
  const serverBounds = (await server.boundingBox())!;
  const outletPoint = center((await serverOutlet.boundingBox())!);
  expect(outletPoint.x).toBeCloseTo(serverBounds.x + serverBounds.width, 1);
  expect(outletPoint.y).toBeCloseTo(serverBounds.y + serverBounds.height / 2, 1);
  await expectScreenTerminal(rack, serverOutlet, server);
  await expectTerminalPaint(page, serverOutlet);

  const original = await rack.getAttribute('d');
  for (const zoom of [0.35, 2, 1]) {
    await page.getByRole('button', { name: `zoom ${zoom}`, exact: true }).click();
    await expect(rack).toBeVisible();
    await expect(rack).toHaveAttribute('d', original!);
    expect(await rack.evaluate((path: SVGPathElement) =>
      parseFloat(getComputedStyle(path).strokeWidth) * path.getScreenCTM()!.a)).toBeCloseTo(1, 2);
    await expectScreenTerminal(rack, rackMarker, frame('rack'));
  }
  async function dragBoundary() {
    const marker = center((await rackMarker.boundingBox())!);
    const bounds = (await frame('rack').boundingBox())!;
    await page.mouse.move(marker.x, marker.y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height, { steps: 6 });
    await page.mouse.up();
  }
  const parentBefore = await parent.getAttribute('d');
  await dragBoundary();
  await expect(rack).not.toHaveAttribute('d', original!);
  await expect(parent).not.toHaveAttribute('d', parentBefore!);
  await expectScreenTerminal(rack, rackMarker, frame('rack'));
  await frame('rack').getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(rack).toHaveAttribute('d', original!);
  await expectScreenTerminal(rack, rackMarker, frame('rack'));

  await page.getByRole('button', { name: 'Reject save' }).click();
  await dragBoundary();
  await frame('rack').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(frame('rack').getByRole('alert')).toContainText('Boundary update rejected');
  await expect(rack).toHaveAttribute('d', original!);
  await expect(rackMarker).toHaveCount(1);
  await page.getByRole('button', { name: 'Reject save' }).click();
  await dragBoundary();
  const draft = await rack.getAttribute('d');
  await frame('rack').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(rack).toHaveAttribute('d', draft!);
  await expect(frame('rack').locator('.location-boundary-point')).toHaveAttribute('data-boundary-point-id', 'point-rack');

  await page.getByRole('button', { name: 'Reflow' }).click();
  await expect(rack).not.toHaveAttribute('d', draft!);
  await expectScreenTerminal(parent, rackMarker, frame('rack'));
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
  const proxy = page.locator('.location-proxy[data-location-id="rack"]');
  await expect(rackMarker).toHaveCount(1);
  await expect(proxy.locator('.location-boundary-point')).toHaveCSS('border-radius', '50%');
  await expectScreenTerminal(parent, rackMarker, proxy);
  await expectTerminalPaint(page, rackMarker);
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
  await expect(outlets.first()).toBeHidden();
  await expect(rackMarker).toBeVisible();
});

test('keeps generic and blueprint ports clickable with the free layer visible', async ({ page }) => {
  await page.getByRole('button', { name: 'Показать все кабельные каналы' }).click();
  await page.getByRole('button', { name: 'Wiring mode' }).click();
  await expect(page.locator('.location-channel-outlet').first()).toHaveCSS('pointer-events', 'none');
  for (const [name, id] of [['Порт Switch port', 'switch-port'], ['Порт P1', 'server-port']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByTestId('picked-port')).toHaveText(id);
  }
});

test('centers the parent trunk between adjacent uniform-grid tiles', async ({ page }) => {
  await page.goto('/perf/location-channels.html?corridor');
  const left = page.locator('.location-frame[data-location-id="rack"]');
  const right = page.locator('.location-frame[data-location-id="empty"]');
  await expect(left).toBeVisible();
  await page.getByRole('button', { name: 'zoom 1', exact: true }).click();
  await page.getByRole('button', { name: 'Показать все кабельные каналы' }).click();
  const parent = page.locator('[data-channel-location="building"] path');
  await expectScreenTerminal(parent, left.locator('.location-boundary-point'), left);
  await expectScreenTerminal(parent, right.locator('.location-boundary-point'), right);
  const a = (await left.boundingBox())!, b = (await right.boundingBox())!;
  const mid = (a.x + a.width + b.x) / 2;
  const inGap = (await verticalRuns(parent)).filter(run => run.x > a.x + a.width && run.x < b.x);
  expect(inGap.reduce((sum, run) => sum + run.length, 0)).toBeGreaterThan(a.height / 2);
  for (const run of inGap) expect(run.x).toBeCloseTo(mid, 1);
  await page.screenshot({ path: test.info().outputPath('centered-tiles.png') });
});

test('renders one terminal per exit in a dense nested rack', async ({ page }) => {
  await page.goto('/perf/location-channels.html?dense');
  await expect(page.locator('.location-frame[data-location-id="rack"]')).toBeVisible();
  await page.getByRole('button', { name: 'zoom 0.35', exact: true }).click();
  await page.getByRole('button', { name: 'Показать все кабельные каналы' }).click();
  await expect(page.locator('.location-channel-outlet')).toHaveCount(43);
  await expect(page.locator('.location-channel-layer desc')).toHaveCount(0);
  const marker = page.locator('[data-boundary-point-id="point-rack"]');
  const frame = page.locator('.location-frame[data-location-id="rack"]');
  await expect(marker).toHaveCount(1);
  await expectScreenTerminal(page.locator('[data-channel-location="building"] path'), marker, frame);
  const rack = page.locator('[data-channel-location="rack"] path');
  await expectScreenTerminal(rack, marker, frame);
  const device = (await page.locator('[data-id="unit-1"] .blueprint-map-node').boundingBox())!;
  const bounds = (await frame.boundingBox())!;
  const mid = (device.x + device.width + bounds.x + bounds.width) / 2;
  const runs = await verticalRuns(rack);
  expect(runs.reduce((sum, run) => sum + run.length, 0)).toBeGreaterThan(bounds.height * 0.9);
  for (const run of runs) expect(run.x).toBeCloseTo(mid, 1);
  await page.screenshot({ path: test.info().outputPath('centered-rack.png') });
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
