import { fireEvent, render } from '@testing-library/react';
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
  it('renders negative-origin panels together and activates only the clicked panel', () => {
    const onActivatePanel = vi.fn();
    const onSelect = vi.fn();
    const panels = [
      { panel_key: 'panel-1', panel_number: 1, display_name: 'Front', x: 0, y: 0, width: 100, height: 40 },
      { panel_key: 'panel-2', panel_number: 2, display_name: 'Rear', x: -100, y: -40, width: 100, height: 40 },
    ];
    const { container } = render(<I18nProvider><BlueprintCompositionCanvas
      body={{ width: 200, height: 80, fillColor: '#123456' }} panels={panels} activePanelKey="panel-1"
      slots={[slot(1), { ...slot(2), panel_key: 'panel-2' }]} links={[{ from_slot_key: 'slot-1', to_slot_key: 'slot-2' }]}
      selectedKeys={new Set()} onActivatePanel={onActivatePanel} onSelect={onSelect} onMarquee={vi.fn()} onTranslate={vi.fn()} onContextMenu={vi.fn()}
    /></I18nProvider>);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 1000 400');
    expect([...container.querySelectorAll('.blueprint-composition-canvas__body')].map((node) => node.getAttribute('x'))).toEqual(['500', '0']);
    expect(container.querySelector('.blueprint-composition-canvas text')).toBeNull();
    expect(container.querySelector('.blueprint-composition-canvas__link')).toHaveAttribute('x1', '750');
    fireEvent.pointerDown(container.querySelector('[data-panel-key="panel-2"] .blueprint-composition-canvas__body')!);
    expect(onActivatePanel).toHaveBeenCalledWith('panel-2');
    fireEvent.pointerDown(container.querySelector('[data-slot-key="slot-2"]')!);
    expect(onActivatePanel).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it.each([10, 4, 2])('keeps markers readable and selected markers distinct at %s:1 body ratio', (ratio) => {
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 700, height: 280,
    } as DOMRect);
    const { container } = render(<I18nProvider><BlueprintCompositionCanvas
      body={{ width: ratio, height: 1, fillColor: '#123' }} panels={[{ panel_key: "panel-1", panel_number: 1, display_name: "Панель 1", x: 0, y: 0, width: ratio, height: 1 }]} activePanelKey="panel-1" onActivatePanel={vi.fn()}
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
      body={{ width: 10, height: 1, fillColor: '#123' }} panels={[{ panel_key: "panel-1", panel_number: 1, display_name: "Панель 1", x: 0, y: 0, width: 10, height: 1 }]} activePanelKey="panel-1" onActivatePanel={vi.fn()}
      slots={slots} links={[]} selectedKeys={new Set()} onSelect={vi.fn()} onMarquee={vi.fn()} onTranslate={vi.fn()} onContextMenu={vi.fn()}
    /></I18nProvider>);
    const markers = container.querySelectorAll('[data-endpoint-marker]');
    expect(markers).toHaveLength(52);
    expect(new Set([...markers].map((marker) => marker.getAttribute('r'))).size).toBe(1);
    expect(Number(markers[0].getAttribute('r')) * .7 * 2).toBeCloseTo(10);
  });
});
