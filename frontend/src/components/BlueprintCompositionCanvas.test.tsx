import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlueprintCompositionCanvas } from './BlueprintCompositionCanvas';
import type { BlueprintBlockInstance } from '../blueprints/editorModel';

const instance = (key: string, face: 'FRONT' | 'REAR', placement = { x: .1, y: .2, width: .3, height: .4 }): BlueprintBlockInstance => ({ instanceKey: key, portBlockRef: 'b', portBlockVersionRef: 'v', face, placement, portBlockName: key, versionNumber: 1, ports: [{ local_id: 'p1', display_label: 'P1', kind: 'CONNECTION_POINT', row: 1, column: 1, layout_order: 1 }, { local_id: 'p2', display_label: 'P2', kind: 'CONNECTION_POINT', row: 1, column: 2, layout_order: 2 }], resolvedSlotKeys: { p1: `${key}-1`, p2: `${key}-2` } });
const body = { width: 520, height: 60, fillColor: '#123456' };

describe('BlueprintCompositionCanvas', () => {
  it('uses corrected port geometry for same-face links and keeps faces independent', () => {
    const front = instance('front', 'FRONT'); const rear = instance('rear', 'REAR'); const { container, rerender } = render(<BlueprintCompositionCanvas body={body} face="FRONT" instances={[front, rear]} links={[{ from_slot_key: 'front-1', to_slot_key: 'front-2' }]} onSelect={vi.fn()} onPlacement={vi.fn()} />);
    expect(container.querySelector('[data-instance-key="front"]')).not.toBeNull(); expect(container.querySelector('[data-instance-key="rear"]')).toBeNull();
    const line = container.querySelector('line')!; const circles = container.querySelectorAll('circle'); expect(line.getAttribute('x1')).toBe(circles[0].getAttribute('cx')); expect(line.getAttribute('y1')).toBe(circles[0].getAttribute('cy')); expect(container.querySelectorAll('text')).toHaveLength(0); expect(container.querySelectorAll('title')).toHaveLength(2);
    rerender(<BlueprintCompositionCanvas body={body} face="REAR" instances={[front, rear]} links={[]} onSelect={vi.fn()} onPlacement={vi.fn()} />); expect(container.querySelector('[data-instance-key="front"]')).toBeNull(); expect(container.querySelector('[data-instance-key="rear"]')).not.toBeNull();
  });

  it('drags and resizes a stable instance while clamping it to the body', () => {
    const onPlacement = vi.fn(); const current = instance('stable', 'FRONT', { x: .7, y: .7, width: .2, height: .2 }); const { container } = render(<BlueprintCompositionCanvas body={body} face="FRONT" instances={[current]} links={[]} selectedKey="stable" onSelect={vi.fn()} onPlacement={onPlacement} />); const svg = container.querySelector('svg')!; Object.defineProperty(svg, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) });
    const group = container.querySelector('[data-instance-key="stable"]')!; fireEvent.pointerDown(group, { clientX: 900, clientY: 500, pointerId: 1 }); fireEvent.pointerMove(svg, { clientX: 1400, clientY: 511.5, pointerId: 1 });
    expect(onPlacement.mock.calls.at(-1)?.[0]).toBe('stable'); expect(onPlacement.mock.calls.at(-1)?.[1].x).toBe(.8); expect(onPlacement.mock.calls.at(-1)?.[1].y).toBeCloseTo(.8);
    const handle = container.querySelector('[data-resize-handle="stable-se"]')!; fireEvent.pointerDown(handle, { clientX: 900, clientY: 500, pointerId: 2 }); fireEvent.pointerMove(svg, { clientX: 1000, clientY: 511.5, pointerId: 2 });
    expect(onPlacement.mock.calls.at(-1)?.[0]).toBe('stable'); expect(onPlacement.mock.calls.at(-1)?.[1].width).toBeCloseTo(.3); expect(onPlacement.mock.calls.at(-1)?.[1].height).toBeCloseTo(.3);
  });

  it('exposes forgiving handles on every side and corner and blocks overlap', () => {
    const onPlacement = vi.fn(); const current = instance('stable', 'FRONT', { x: .1, y: .2, width: .2, height: .2 }); const peer = instance('peer', 'FRONT', { x: .5, y: .2, width: .2, height: .2 }); const { container } = render(<BlueprintCompositionCanvas body={body} face="FRONT" instances={[current, peer]} links={[]} selectedKey="stable" onSelect={vi.fn()} onPlacement={onPlacement} />); const svg = container.querySelector('svg')!; Object.defineProperty(svg, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) });
    expect(container.querySelectorAll('[data-resize-handle^="stable-"]')).toHaveLength(8);
    const group = container.querySelector('[data-instance-key="stable"]')!; fireEvent.pointerDown(group, { clientX: 200, clientY: 250, pointerId: 1 }); fireEvent.pointerMove(svg, { clientX: 650, clientY: 250, pointerId: 1 });
    const placement = onPlacement.mock.calls.at(-1)?.[1]; expect(placement.x + placement.width <= .5 || placement.x >= .7).toBe(true);
  });

  it('lets a historically overlapping block escape by dragging', () => {
    const onPlacement = vi.fn(); const current = instance('stable', 'FRONT', { x: .2, y: .2, width: .3, height: .3 }); const peer = instance('peer', 'FRONT', { x: .25, y: .25, width: .3, height: .3 }); const { container } = render(<BlueprintCompositionCanvas body={body} face="FRONT" instances={[current, peer]} links={[]} selectedKey="stable" onSelect={vi.fn()} onPlacement={onPlacement} />); const svg = container.querySelector('svg')!; Object.defineProperty(svg, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) });
    const group = container.querySelector('[data-instance-key="stable"]')!; fireEvent.pointerDown(group, { clientX: 250, clientY: 250, pointerId: 1 }); fireEvent.pointerMove(svg, { clientX: 250, clientY: 250, pointerId: 1 });
    const placement = onPlacement.mock.calls.at(-1)?.[1]; expect(placement.x + placement.width <= .25 || placement.x >= .55 || placement.y + placement.height <= .25 || placement.y >= .55).toBe(true);
  });
});
