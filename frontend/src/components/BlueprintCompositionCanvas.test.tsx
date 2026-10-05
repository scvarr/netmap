import { fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import type { BlueprintSlot } from '../topology/objectBlueprintTypes';
import { BlueprintCompositionCanvas } from './BlueprintCompositionCanvas';

const slot = (index: number, x = .5, y = .5): BlueprintSlot => ({
  key: `slot-${index}`, display_name: `Port ${index}`, kind: 'NETWORK_PORT', panel_key: 'panel-1',
  rendered_position: { x, y },
});

afterEach(() => vi.restoreAllMocks());

describe('active panel body foreground', () => {
  it.each([0, 50])('switches body stacking without changing source order or geometry (second panel x=%s)', (x) => {
    const panels = [
      { panel_key: 'panel-1', panel_number: 1, display_name: 'One', x: 0, y: 0, width: 100, height: 80 },
      { panel_key: 'panel-2', panel_number: 2, display_name: 'Two', x, y: 0, width: 100, height: 80 },
    ];
    const original = panels.map((panel) => ({ ...panel }));
    panels.forEach(Object.freeze); Object.freeze(panels);
    const onPanelGeometry = vi.fn();
    const props = { body: { width: 100 + x, height: 80, fillColor: '#123456' }, panels,
      slots: [slot(1), { ...slot(2), panel_key: 'panel-2' }], links: [{ from_slot_key: 'slot-1', to_slot_key: 'slot-2' }],
      selectedKeys: new Set<string>(), onActivatePanel: vi.fn(), onSelect: vi.fn(), onMarquee: vi.fn(), onTranslate: vi.fn(), onContextMenu: vi.fn(), onPanelGeometry };
    const { container, rerender } = render(<I18nProvider><BlueprintCompositionCanvas {...props} activePanelKey="panel-1" /></I18nProvider>);
    const bodies = () => [...container.querySelectorAll('[data-panel-key]')].map((node) => node.getAttribute('data-panel-key'));
    const rectangles = () => Object.fromEntries(panels.map((panel) => {
      const body = container.querySelector(`[data-panel-key="${panel.panel_key}"] .blueprint-composition-canvas__body`)!;
      return [panel.panel_key, ['x', 'y', 'width', 'height'].map((axis) => body.getAttribute(axis))];
    }));
    const originalRectangles = rectangles();
    const link = container.querySelector('.blueprint-composition-canvas__link');
    const endpoints = [...container.querySelectorAll('[data-slot-key]')];
    expect(bodies()).toEqual(['panel-2', 'panel-1']);
    rerender(<I18nProvider><BlueprintCompositionCanvas {...props} activePanelKey="panel-2" /></I18nProvider>);
    expect(bodies()).toEqual(['panel-1', 'panel-2']);
    expect(rectangles()).toEqual(originalRectangles);
    expect(panels).toEqual(original);
    expect(container.querySelector('.blueprint-composition-canvas__link')).toBe(link);
    expect([...container.querySelectorAll('[data-slot-key]')]).toEqual(endpoints);
    expect(container.querySelector('[data-panel-move-border]')).toHaveAttribute('data-panel-move-border', 'panel-2');
    expect(container.querySelectorAll('[data-panel-resize]')).toHaveLength(8);
    expect(onPanelGeometry).not.toHaveBeenCalled();
  });
});

describe('Blueprint endpoint screen-space markers', () => {
  it('keeps the gesture view stable while an outer panel moves and derives link endpoints', () => {
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 400 } as DOMRect);
    const initial = [
      { panel_key: 'panel-1', panel_number: 1, display_name: 'One', x: 0, y: 0, width: 100, height: 80 },
      { panel_key: 'panel-2', panel_number: 2, display_name: 'Two', x: 100, y: 0, width: 100, height: 80 },
    ];
    const onMarquee = vi.fn();
    function Harness() {
      const [panels, setPanels] = useState(initial);
      return <I18nProvider><BlueprintCompositionCanvas body={{ width: 200, height: 80, fillColor: '#123456' }} panels={panels} activePanelKey="panel-2"
        slots={[slot(1), { ...slot(2), panel_key: 'panel-2' }]} links={[{ from_slot_key: 'slot-1', to_slot_key: 'slot-2' }]}
        selectedKeys={new Set()} onActivatePanel={vi.fn()} onSelect={vi.fn()} onMarquee={onMarquee} onTranslate={vi.fn()} onContextMenu={vi.fn()}
        onPanelGeometry={(key, rectangle) => setPanels((old) => old.map((panel) => panel.panel_key === key ? { ...panel, ...rectangle } : panel))} /></I18nProvider>;
    }
    const { container } = render(<Harness />);
    const canvas = container.querySelector('svg')!;
    const border = container.querySelector('[data-panel-move-border]')!;
    fireEvent.pointerDown(border, { button: 0, clientX: 900, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 950, clientY: 100 });
    expect(canvas.getAttribute('viewBox')).toBe('0 0 1000 400');
    expect(container.querySelector('[data-panel-key="panel-2"] .blueprint-composition-canvas__body')).toHaveAttribute('x', '550');
    fireEvent.pointerMove(canvas, { clientX: 1000, clientY: 100 });
    expect(container.querySelector('[data-panel-key="panel-2"] .blueprint-composition-canvas__body')).toHaveAttribute('x', '600');
    expect(container.querySelector('.blueprint-composition-canvas__link')).toHaveAttribute('x2', '850');
    expect(onMarquee).not.toHaveBeenCalled();
    fireEvent.pointerUp(canvas);
    expect(container.querySelector('[data-panel-guide-x]')).toBeNull();
    expect(Number(container.querySelector('svg')?.getAttribute('viewBox')?.split(' ')[3])).toBeCloseTo(1000 * 80 / 220);
  });

  it('shows eight screen-space handles and keeps interior marquee available', () => {
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 400 } as DOMRect);
    const onMarquee = vi.fn(); const onPanelGeometry = vi.fn();
    const { container } = render(<I18nProvider><BlueprintCompositionCanvas body={{ width: 100, height: 40, fillColor: '#123456' }}
      panels={[{ panel_key: 'panel-1', panel_number: 1, display_name: 'One', x: 0, y: 0, width: 100, height: 40 }]}
      activePanelKey="panel-1" slots={[slot(1)]} links={[]} selectedKeys={new Set()} onActivatePanel={vi.fn()} onSelect={vi.fn()}
      onMarquee={onMarquee} onTranslate={vi.fn()} onContextMenu={vi.fn()} onPanelGeometry={onPanelGeometry} /></I18nProvider>);
    const canvas = container.querySelector('svg')!;
    expect(container.querySelectorAll('[data-panel-resize]')).toHaveLength(8);
    for (const handle of container.querySelectorAll('[data-panel-resize]')) expect(Number(handle.getAttribute('r')) * 2).toBeCloseTo(14);
    fireEvent.pointerDown(container.querySelector('.blueprint-composition-canvas__body')!, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(canvas, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas);
    expect(onMarquee).toHaveBeenCalled();
    expect(onPanelGeometry).not.toHaveBeenCalled();
  });

  it('renders panel guides only at snapped coordinates and clears them on cancel', () => {
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 400 } as DOMRect);
    const panels = [
      { panel_key: 'panel-1', panel_number: 1, display_name: 'One', x: 0, y: 0, width: 100, height: 80 },
      { panel_key: 'panel-2', panel_number: 2, display_name: 'Two', x: 100, y: 0, width: 100, height: 80 },
    ];
    const onPanelGeometry = vi.fn();
    const { container } = render(<I18nProvider><BlueprintCompositionCanvas body={{ width: 200, height: 80, fillColor: '#123456' }}
      panels={panels} activePanelKey="panel-2" slots={[]} links={[]} selectedKeys={new Set()} onActivatePanel={vi.fn()} onSelect={vi.fn()}
      onMarquee={vi.fn()} onTranslate={vi.fn()} onContextMenu={vi.fn()} onPanelGeometry={onPanelGeometry} /></I18nProvider>);
    const canvas = container.querySelector('svg')!;
    fireEvent.pointerDown(container.querySelector('[data-panel-move-border]')!, { button: 0, clientX: 700, clientY: 100 });
    fireEvent.pointerMove(canvas, { clientX: 740, clientY: 150 });
    expect(container.querySelector('[data-panel-guide-x]')).toBeNull();
    expect(container.querySelector('[data-panel-guide-y]')).toBeNull();
    fireEvent.pointerMove(canvas, { clientX: 205, clientY: 150 });
    expect(onPanelGeometry).toHaveBeenLastCalledWith('panel-2', { x: 0, y: 10, width: 100, height: 80 });
    expect(container.querySelector('[data-panel-guide-x]')).toHaveAttribute('x1', '0');
    fireEvent.pointerCancel(canvas);
    expect(container.querySelector('[data-panel-guide-x]')).toBeNull();
  });
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
    expect(container.querySelector('[data-panel-key="panel-1"] .blueprint-composition-canvas__body')).toHaveAttribute('x', '500');
    expect(container.querySelector('[data-panel-key="panel-2"] .blueprint-composition-canvas__body')).toHaveAttribute('x', '0');
    expect(container.querySelector('.blueprint-composition-canvas text')).toBeNull();
    expect(container.querySelector('.blueprint-composition-canvas__link')).toHaveAttribute('x1', '750');
    fireEvent.pointerDown(container.querySelector('[data-panel-key="panel-2"] .blueprint-composition-canvas__body')!);
    expect(onActivatePanel).toHaveBeenCalledWith('panel-2');
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(container.querySelector('[data-slot-key="slot-2"]')!);
    expect(onActivatePanel).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith('slot-2', false);
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


describe('ordered canvas gestures', () => {
  it('renders screen-space badges and prevents endpoint drag and marquee, retaining panel gestures', () => {
    vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 500, height: 200 } as DOMRect);
    const onSelect = vi.fn(), onMarquee = vi.fn(), onTranslate = vi.fn(), onPanelGeometry = vi.fn();
    const props = { body: { width: 100, height: 40, fillColor: '#123456' }, panels: [{ panel_key: 'panel-1', panel_number: 1, display_name: 'One', x: 0, y: 0, width: 100, height: 40 }], activePanelKey: 'panel-1', slots: [slot(1), slot(2)], links: [], selectedKeys: new Set<string>(), onActivatePanel: vi.fn(), onSelect, onMarquee, onTranslate, onContextMenu: vi.fn(), onPanelGeometry };
    const { container, rerender } = render(<I18nProvider><BlueprintCompositionCanvas {...props} orderedKeys={['slot-2', 'slot-1']} /></I18nProvider>);
    const canvas = container.querySelector('svg')!;
    expect(container.querySelector('[data-slot-key="slot-1"] [data-endpoint-sequence]')).toHaveTextContent('2');
    const badge = container.querySelector('[data-endpoint-sequence]')!; expect(badge).toHaveAttribute('pointer-events', 'none'); expect(badge.getAttribute('transform')).toContain('scale(2)');
    fireEvent.pointerDown(container.querySelector('[data-slot-key="slot-1"]')!, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 150 }); fireEvent.pointerUp(canvas);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('slot-1', false); expect(onTranslate).not.toHaveBeenCalled();
    fireEvent.pointerDown(container.querySelector('.blueprint-composition-canvas__body')!, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { clientX: 500, clientY: 200 }); fireEvent.pointerUp(canvas); expect(onMarquee).not.toHaveBeenCalled();
    fireEvent.pointerDown(container.querySelector('[data-panel-resize="e"]')!, { button: 0, clientX: 500, clientY: 100 });
    fireEvent.pointerMove(canvas, { clientX: 550, clientY: 100 }); fireEvent.pointerUp(canvas); expect(onPanelGeometry).toHaveBeenCalled();
    rerender(<I18nProvider><BlueprintCompositionCanvas {...props} /></I18nProvider>); expect(container.querySelector('[data-endpoint-sequence]')).toBeNull();
  });
});
