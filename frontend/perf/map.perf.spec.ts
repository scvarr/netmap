import { expect, type Locator, type Page, test } from '@playwright/test';

async function nextAnimationFrame(page: Page, mark: string): Promise<number> {
  return page.evaluate(async (name) => {
    performance.mark(`netmap:${name}`);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    performance.mark(`netmap:${name}:frame`);
    return performance.measure(`netmap:${name}`, `netmap:${name}`, `netmap:${name}:frame`).duration;
  }, mark);
}

/** Callable scenario seam: executes a real trace through the visible command bar. */
export async function runTraceScenario(page: Page) {
  const selects = page.locator('.trace-command select');
  await expect(selects.nth(0)).toBeEnabled();
  await selects.nth(0).selectOption({ index: 1 });
  await selects.nth(2).selectOption({ index: 2 });
  await page.locator('.trace-command button[type="submit"]').click();
  await expect(page.locator('.trace-result')).toBeVisible();
}

/** Callable scenario seam for a real wiring workflow; callers choose ports before mutation. */
export async function beginWiringScenario(page: Page, sourcePort: Locator) {
  await page.getByRole('button', { name: /соедин|connect/i }).click();
  await sourcePort.click();
  await expect(page.locator('.map-wiring-panel')).toBeVisible();
}

/** Callable scenario seam for a selected cable's route editing surface. */
export async function beginCableRouteEditingScenario(page: Page, cable: Locator) {
  await cable.click();
  await expect(page.getByRole('button', { name: /маршрут|route/i })).toBeVisible();
}

test('records real map, DOM, selection, pan, zoom, and drag interactions', async ({ page }) => {
  await page.addInitScript(() => { window.__NETMAP_PERF__ = true; });
  await page.goto(process.env.PERF_MAP_URL ?? '/map');
  await page.waitForFunction(() => performance.getEntriesByName('netmap:time-to-map').length > 0);
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();
  const domElements = await page.locator('*').count();

  await page.evaluate(() => performance.mark('netmap:selection-event'));
  await node.click();
  await expect(node).toHaveClass(/selected/);
  const selectionToNextAnimationFrameMs = await nextAnimationFrame(page, 'selection-event');

  const pane = page.locator('.react-flow__pane');
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error('React Flow pane is not measurable');
  await page.mouse.move(paneBox.x + 120, paneBox.y + 120);
  await page.mouse.down(); await page.mouse.move(paneBox.x + 220, paneBox.y + 170, { steps: 20 }); await page.mouse.up();
  const panSequenceMs = await nextAnimationFrame(page, 'pan-sequence');

  await page.locator('.react-flow__controls-zoomin').click();
  const zoomSequenceMs = await nextAnimationFrame(page, 'zoom-sequence');

  const nodeBox = await node.boundingBox();
  if (!nodeBox) throw new Error('React Flow node is not measurable');
  await page.mouse.move(nodeBox.x + 20, nodeBox.y + 20);
  await page.mouse.down(); await page.mouse.move(nodeBox.x + 45, nodeBox.y + 45, { steps: 8 }); await page.mouse.up();
  const dragStopToNextAnimationFrameMs = await nextAnimationFrame(page, 'drag-stop');
  const measures = await page.evaluate(() => Object.fromEntries(['layout-duration', 'time-to-map'].map((name) => [name, performance.getEntriesByName(`netmap:${name}`).at(-1)?.duration])));
  console.log(JSON.stringify({ ...measures, dom_elements: domElements, selection_to_next_animation_frame_ms: selectionToNextAnimationFrameMs, pan_sequence_ms: panSequenceMs, zoom_sequence_ms: zoomSequenceMs, drag_stop_to_next_animation_frame_ms: dragStopToNextAnimationFrameMs }));
});
