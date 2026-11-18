import { expect, test, type Locator } from '@playwright/test';

const pointOn = (segment: Locator, fraction = .5) => segment.evaluate((path: SVGPathElement, ratio) => {
  const local = path.getPointAtLength(path.getTotalLength() * ratio);
  const screen = local.matrixTransform(path.getScreenCTM()!);
  return { x: screen.x, y: screen.y };
}, fraction);

test('selects Cable leads and shared routes on a dense L1 panel', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 750 });
  await page.goto('/perf/cable-selection.html');
  const hits = page.locator('.cable-route-hit');
  const lead = (port: number) => hits.and(page.locator(`[aria-label^="Patch · PP1 / P${port} "][d^="M ${72 + 12 + (port - 1) * 14} 4 L"]`));
  const shared = hits.and(page.locator('[data-cable-count="4"][d^="M 272 16 L"]'));
  const tooltip = page.getByRole('tooltip');
  const chooser = page.getByRole('dialog', { name: 'Выбрать кабель на участке' });
  const inspector = page.getByRole('complementary', { name: 'Быстрый инспектор' });

  for (const zoom of [0.35, 1, 2]) {
    await page.getByRole('button', { name: `zoom ${zoom}`, exact: true }).click();
    await expect(lead(2)).toHaveCount(1);
    for (const port of [1, 2, 3, 4]) {
      const point = await pointOn(lead(port));
      // At low zoom, neighbouring leads are less than five screen pixels apart.
      await page.mouse.move(point.x + (zoom === .35 ? 1 : 5), point.y);
      await expect(tooltip).toContainText(`PP1 / P${port}`);
    }
    expect(await lead(2).evaluate(element => getComputedStyle(element).cursor)).toBe('crosshair');
    const port = page.locator('.blueprint-map-node__port[data-connection-point-id="PP1-p2"]');
    await port.click();
    await expect(page.getByTestId('clicked-port')).toHaveText('PP1-p2');
  }

  await page.getByRole('button', { name: 'zoom 1', exact: true }).click();
  const short = await pointOn(lead(2));
  await page.mouse.move(short.x, short.y);
  await expect(tooltip).toContainText('PP1 / P2');
  await expect(page.locator('.cable-route-foreground--hovered').first()).toBeVisible();
  await expect(inspector).toHaveCount(0);
  await page.mouse.click(short.x, short.y);
  await expect(inspector.getByRole('heading', { name: 'Patch' })).toBeVisible();
  await expect(page.locator('.cable-route-marker:not(.cable-route-marker--hovered)')).toHaveCount(1);

  const localShared = hits.and(page.locator('[data-cable-count="4"][d="M 264 16 L 272 16"]'));
  const outlet = await pointOn(localShared);
  await page.mouse.move(outlet.x, outlet.y);
  await expect(tooltip).toHaveText('Кабелей на участке: 4');
  await page.mouse.click(outlet.x, outlet.y);
  await expect(chooser.getByRole('button')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(chooser).toHaveCount(0);

  const trunk = await pointOn(shared);
  await page.mouse.move(trunk.x, trunk.y);
  await expect(tooltip).toHaveText('Кабелей на участке: 4');
  const before = await page.locator('.react-flow__viewport').getAttribute('style');
  await page.mouse.down();
  await page.mouse.move(trunk.x + 40, trunk.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__viewport')).not.toHaveAttribute('style', before!);
  await expect(chooser).toHaveCount(0);

  const panned = await pointOn(shared);
  await page.mouse.move(panned.x, panned.y - 20);
  await page.mouse.move(panned.x, panned.y);
  await expect(tooltip).toHaveText('Кабелей на участке: 4');
  await page.mouse.click(panned.x, panned.y);
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('button')).toHaveCount(4);
  await expect(chooser.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(chooser).toHaveCount(0);
  await page.mouse.click(panned.x, panned.y);
  await chooser.getByRole('button', { name: /PP1 \/ P3/ }).click();
  await expect(chooser).toHaveCount(0);
  await inspector.locator('summary').click();
  await expect(inspector.getByText('cable:cable-3', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Trace Cable 1' }).click();
  const traced = page.locator('.cable-route-foreground--traced');
  const geometry = await traced.evaluateAll(paths => paths.map(path => path.getAttribute('d')));
  expect(geometry.length).toBeGreaterThan(0);
  const other = await pointOn(lead(4));
  await page.mouse.move(other.x, other.y);
  await expect(tooltip).toContainText('PP1 / P4');
  await expect(page.locator('.cable-route-foreground--hovered')).toHaveCount(0);
  expect(await traced.evaluateAll(paths => paths.map(path => path.getAttribute('d')))).toEqual(geometry);
  await expect(inspector.getByText('cable:cable-3', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Free channels' }).click();
  expect(await page.locator('.object-virtual-channel.cable-route-foreground--free').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Wiring mode' }).click();
  await expect(hits).toHaveCount(0);
  await page.locator('.blueprint-map-node__port[data-connection-point-id="PP1-p5"]').click();
  await expect(page.getByTestId('clicked-port')).toHaveText('PP1-p5');
});
