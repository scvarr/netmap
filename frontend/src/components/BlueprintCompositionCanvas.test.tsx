import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import type { BlueprintSlot } from '../topology/objectBlueprintTypes';
import { BlueprintCompositionCanvas } from './BlueprintCompositionCanvas';

const slot = (index: number, x = .5, y = .5): BlueprintSlot => ({
  key: `slot-${index}`, display_name: `Port ${index}`, kind: 'NETWORK_PORT', panel_key: 'panel-1',
  rendered_position: { x, y },
});

afterEach(() => vi.restoreAllMocks());

describe('Blueprint endpoint screen-space markers', () => {
  it.each([10, 4, 2])('keeps markers readable and selected markers distinct at %s:1 body ratio', (ratio) => {
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 700, height: 280,
    } as DOMRect);
    const { container } = render(<I18nProvider><BlueprintCompositionCanvas
      body={{ width: ratio, height: 1, fillColor: '#123' }} panelKey="panel-1"
      slots={[slot(1), slot(2, .75, .5)]} links={[]} selectedKeys={new Set(['slot-2'])}
      onSelect={vi.fn()} onMarquee={vi.fn()} onTranslate={vi.fn()} onContextMenu={vi.fn()}
    /></I18nProvider>);
    const canvas = container.querySelector('svg')!;
    const viewHeight = 1000 / ratio;
    const scale = Math.min(700 / 1000, 280 / viewHeight);
    expect(canvas.getAttribute('viewBox')).toBe(`0 0 1000 ${viewHeight}`);
    const regular = container.querySelector('[data-slot-key="slot-1"] [data-endpoint-marker]')!;
    const selected = container.querySelector('[data-slot-key="slot-2"] [data-endpoint-marker]')!;
    const hit = container.querySelector('[data-slot-key="slot-1"] [data-endpoint-hit-target]')!;
    expect(Number(regular.getAttribute('r')) * scale * 2).toBeCloseTo(10);
    expect(Number(selected.getAttribute('r')) * scale * 2).toBeCloseTo(12);
    expect(Number(hit.getAttribute('r')) * scale * 2).toBeCloseTo(22);
    expect(regular.getAttribute('cx')).toBe('500');
    expect(regular.getAttribute('cy')).toBe(String(viewHeight / 2));
  });

  it('uses the same marker size for a 52 endpoint wide body', () => {
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 700, height: 280,
    } as DOMRect);
    const slots = Array.from({ length: 52 }, (_, index) => slot(index, (index % 13 + .5) / 13, (Math.floor(index / 13) + .5) / 4));
    const { container } = render(<I18nProvider><BlueprintCompositionCanvas
      body={{ width: 10, height: 1, fillColor: '#123' }} panelKey="panel-1"
      slots={slots} links={[]} selectedKeys={new Set()} onSelect={vi.fn()} onMarquee={vi.fn()} onTranslate={vi.fn()} onContextMenu={vi.fn()}
    /></I18nProvider>);
    const markers = container.querySelectorAll('[data-endpoint-marker]');
    expect(markers).toHaveLength(52);
    expect(new Set([...markers].map((marker) => marker.getAttribute('r'))).size).toBe(1);
    expect(Number(markers[0].getAttribute('r')) * .7 * 2).toBeCloseTo(10);
  });
});
