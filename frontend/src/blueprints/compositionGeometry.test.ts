import { describe, expect, it } from 'vitest';
import { compositionCanvas, placementRect, portCenter, screenToPlacementPoint } from './compositionGeometry';
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
});
