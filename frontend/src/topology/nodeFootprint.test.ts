import { describe, expect, it } from 'vitest';
import { LAYOUT_NODE_HEIGHT, LAYOUT_NODE_WIDTH, type DeviceFlowNode } from './layout';
import {
  footprintDimensionsForProjectionNode,
  nearestFreePosition,
  nodeFootprint,
  projectionNodeFootprint,
  rectanglesOverlap,
  type FlowRectangle,
} from './nodeFootprint';

const node = (id: string, position: { x: number; y: number }, attributes: Record<string, unknown> = {}): DeviceFlowNode => ({
  id,
  type: 'device',
  position,
  data: { projection: { id, kind: 'PHYSICAL_OBJECT', label: id, source_refs: [], attributes } },
});

describe('node footprint presentation geometry', () => {
  it('uses display dimensions, not intrinsic body magnitude, for Blueprint-backed objects', () => {
    const wide = node('wide', { x: 0, y: 0 }, { blueprint_presentation: { body: { width: 480, height: 60 }, slots: [{ face: 'FRONT' }] } });
    const compact = node('compact', { x: 45, y: 0 }, { blueprint_presentation: { body: { width: 8, height: 1 }, slots: [{ face: 'FRONT' }] } });
    expect(nodeFootprint(wide)).toMatchObject({ width: 240, height: 70 });
    expect(nodeFootprint(compact)).toMatchObject({ width: 240, height: 70 });
    expect(projectionNodeFootprint(wide.data.projection, { x: 5, y: 6 }, 320)).toMatchObject({ x: 5, y: 6, width: 320, height: 80 });
    expect(footprintDimensionsForProjectionNode(compact.data.projection, 480)).toEqual({ width: 480, height: 100 });
  });

  it('uses the existing generic layout footprint and permits touching boundaries', () => {
    const left = node('left', { x: 0, y: 0 });
    const right = node('right', { x: LAYOUT_NODE_WIDTH, y: 0 });
    expect(nodeFootprint(left)).toMatchObject({ width: LAYOUT_NODE_WIDTH, height: LAYOUT_NODE_HEIGHT });
    expect(rectanglesOverlap(nodeFootprint(left), nodeFootprint(right))).toBe(false);
  });

  it('uses the full simultaneous two-face footprint for collision and insertion geometry', () => {
    const twoFace = node('two-face', { x: 0, y: 0 }, { blueprint_presentation: { body: { width: 8, height: 1 }, slots: [{ face: 'FRONT' }, { face: 'REAR' }] } });
    const footprint = nodeFootprint(twoFace);
    expect(footprint).toMatchObject({ width: 240, height: 130 });
    expect(rectanglesOverlap(footprint, { x: 0, y: 120, width: 240, height: 20 })).toBe(true);
    expect(nearestFreePosition({ x: 0, y: 0 }, footprint, [{ x: 0, y: 0, width: 240, height: 130 }])).not.toEqual({ x: 0, y: 0 });
  });
});

describe('nearest-free Saved Map placement', () => {
  const candidate = { width: 40, height: 20 };

  it('keeps a free requested anchor unchanged', () => {
    expect(nearestFreePosition({ x: 10, y: 20 }, candidate, [])).toEqual({ x: 10, y: 20 });
  });

  it('moves an overlapping candidate to a deterministic free grid position', () => {
    const occupied: FlowRectangle[] = [{ x: 0, y: 0, width: 100, height: 80 }];
    const first = nearestFreePosition({ x: 0, y: 0 }, candidate, occupied);
    expect(first).not.toEqual({ x: 0, y: 0 });
    expect(first).toEqual(nearestFreePosition({ x: 0, y: 0 }, candidate, occupied));
    expect(occupied.some((rectangle) => rectanglesOverlap({ ...first!, ...candidate }, rectangle))).toBe(false);
  });

  it('permits touching boundaries and handles mixed-size obstacles around the anchor', () => {
    const touching: FlowRectangle = { x: 40, y: 0, width: 320, height: 180 };
    expect(nearestFreePosition({ x: 0, y: 0 }, candidate, [touching])).toEqual({ x: 0, y: 0 });

    const occupied: FlowRectangle[] = [
      { x: -200, y: -100, width: 240, height: 160 },
      { x: 0, y: 0, width: 320, height: 180 },
      { x: 300, y: -100, width: 80, height: 320 },
    ];
    const result = nearestFreePosition({ x: 0, y: 0 }, { width: 120, height: 90 }, occupied);
    expect(result).not.toBeNull();
    expect(occupied.some((rectangle) => rectanglesOverlap({ ...result!, width: 120, height: 90 }, rectangle))).toBe(false);
  });
});
