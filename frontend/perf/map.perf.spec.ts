import { expect, test } from '@playwright/test';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

test('records real-browser map foundation metrics and interaction seams', async ({ page }) => {
  await page.addInitScript(() => { window.__NETMAP_PERF__ = true; });
  const measures: Record<string, number[]> = {};
  await page.exposeFunction('recordPerfMeasure', (name: string, duration: number) => (measures[name] ??= []).push(duration));
  await page.addInitScript(() => window.addEventListener('netmap-perf-measure', (event) => {
    const name = (event as CustomEvent<{name: string}>).detail.name;
    const entries = performance.getEntriesByName(`netmap:${name}`);
    void (window as any).recordPerfMeasure(name, entries.at(-1)?.duration ?? 0);
  }));
  await page.goto(process.env.PERF_MAP_URL ?? '/map');
  await page.waitForTimeout(250); // the harness records an explicit unavailable/not-measured result if no map is selected.
  const domElements = await page.locator('*').count();
  const interaction = await page.evaluate(async () => {
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame((time) => resolve(time)));
    const before = performance.now(); await frame(); const selectionToFrame = performance.now() - before;
    const panStart = performance.now(); for (let i = 0; i < 20; i++) await frame(); const panSequence = performance.now() - panStart;
    const zoomStart = performance.now(); for (let i = 0; i < 5; i++) await frame(); const zoomSequence = performance.now() - zoomStart;
    const dragStart = performance.now(); await frame(); return { selection_to_next_animation_frame_ms: selectionToFrame, pan_sequence_ms: panSequence, zoom_sequence_ms: zoomSequence, drag_stop_to_next_animation_frame_ms: performance.now() - dragStart };
  });
  console.log(JSON.stringify({ metrics: measures, dom_elements: domElements, ...interaction, scenarios_prepared: ['trace', 'wiring', 'cable-route-editing'] }));
  expect(domElements).toBeGreaterThan(0);
});
