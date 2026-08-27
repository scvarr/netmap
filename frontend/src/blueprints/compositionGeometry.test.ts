import { describe, expect, it } from 'vitest';
import { compositionCanvas, initialPlacementForPorts, placementRect, portCenter, resizePlacement, resolvePlacement, screenToPlacementPoint } from './compositionGeometry';
import type { BlueprintBlockInstance } from './editorModel';

const item: BlueprintBlockInstance = { instanceKey: 'stable', portBlockRef: 'block', portBlockVersionRef: 'version', face: 'FRONT', placement: { x: .2, y: .25, width: .5, height: .5 }, portBlockName: 'Panel', versionNumber: 1, ports: [{ local_id: 'p1', display_label: 'P1', kind: 'CONNECTION_POINT', row: 1, column: 1, layout_order: 1 }, { local_id: 'p2', display_label: 'P2', kind: 'CONNECTION_POINT', row: 2, column: 2, layout_order: 2 }], resolvedSlotKeys: { p1: 'one', p2: 'two' } };

describe('Blueprint composition geometry', () => {
  it('uses actual non-square canvas dimensions for rectangles and port centers', () => {
    const canvas = compositionCanvas({ width: 520, height: 60 }); const rect = placementRect(item.placement!, canvas);
    expect(canvas).toEqual({ width: 1000, height: 60_000 / 520 });
    for (const port of item.ports) { const point = portCenter(item, port.local_id, item.placement!, canvas)!; expect(point.x).toBeGreaterThan(rect.x); expect(point.x).toBeLessThan(rect.x + rect.width); expect(point.y).toBeGreaterThan(rect.y); expect(point.y).toBeLessThan(rect.y + rect.height); }
  });

  it('removes preserveAspectRatio letterboxing before normalizing pointer coordinates', () => {
    const canvas = compositionCanvas({ width: 520, height: 60 });
    const point = screenToPlacementPoint(500, 500, { left: 0, top: 0, width: 1000, height: 1000 }, canvas); expect(point.x).toBeCloseTo(.5); expect(point.y).toBeCloseTo(.5);
  });

  it('sizes a new block from its port grid and finds an unoccupied place', () => {
    const placement = initialPlacementForPorts([{ row: 1, column: 1 }, { row: 2, column: 3 }], [{ x: 0, y: 0, width: .5, height: .5 }]);
    if (!placement) throw new Error('expected a free placement');
    expect(placement.width).toBeCloseTo(.4);
    expect(placement.height).toBeCloseTo(.34);
    expect(placement.x + placement.width <= .5 || placement.y + placement.height <= .5).toBe(true);
  });

  it('places a second block in free space after reducing an oversized recommendation', () => {
    const occupied = [{ x: 0, y: 0, width: 1, height: .8 }];
    const placement = initialPlacementForPorts([{ row: 1, column: 1 }], occupied);
    if (!placement) throw new Error('expected a reduced free placement');
    expect(placement.height).toBeLessThan(.22);
    expect(placement.y).toBeGreaterThanOrEqual(.8);
    expect(placement.y + placement.height).toBeLessThanOrEqual(1);
  });

  it('refuses a full canvas instead of returning an overlapping origin placement', () => {
    expect(initialPlacementForPorts([{ row: 1, column: 1 }], [{ x: 0, y: 0, width: 1, height: 1 }])).toBeUndefined();
  });

  it('snaps to panel and neighbouring block edges without allowing overlap', () => {
    const result = resolvePlacement({ x: .487, y: .2, width: .2, height: .2 }, { x: .1, y: .2, width: .2, height: .2 }, [{ x: .7, y: .1, width: .2, height: .5 }], 'drag');
    expect(result.placement.x + result.placement.width).toBeCloseTo(.7);
    expect(result.guides).toContainEqual({ axis: 'x', position: .7 });
    const blocked = resolvePlacement({ x: .6, y: .2, width: .25, height: .2 }, { x: .1, y: .2, width: .2, height: .2 }, [{ x: .7, y: .1, width: .2, height: .5 }], 'drag');
    expect(blocked.placement.x + blocked.placement.width <= .7 || blocked.placement.x >= .9).toBe(true);
  });

  it('resizes from every anchored direction and rejects resizing through another block', () => {
    expect(resizePlacement({ x: .2, y: .2, width: .3, height: .3 }, 'nw', -.1, -.1)).toMatchObject({ x: .1, y: .1, width: .4, height: .4 });
    const east = resizePlacement({ x: .2, y: .2, width: .3, height: .3 }, 'e', .1, 0); expect(east.x).toBeCloseTo(.2); expect(east.width).toBeCloseTo(.4);
    const previous = { x: .1, y: .1, width: .2, height: .2 };
    expect(resolvePlacement({ ...previous, width: .6 }, previous, [{ x: .5, y: .1, width: .2, height: .2 }], 'resize').placement).toEqual(previous);
  });

  it('finds an exit for a historical overlapping placement', () => {
    const result = resolvePlacement({ x: .2, y: .2, width: .3, height: .3 }, { x: .2, y: .2, width: .3, height: .3 }, [{ x: .25, y: .25, width: .3, height: .3 }], 'drag');
    expect(result.placement.x + result.placement.width <= .25 || result.placement.x >= .55 || result.placement.y + result.placement.height <= .25 || result.placement.y >= .55).toBe(true);
  });
});
