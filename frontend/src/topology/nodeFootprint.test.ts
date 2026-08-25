import { describe, expect, it } from 'vitest';
import { LAYOUT_NODE_HEIGHT, LAYOUT_NODE_WIDTH, type DeviceFlowNode } from './layout';
import { nodeFootprint, rectanglesOverlap } from './nodeFootprint';

const node = (id: string, position: { x: number; y: number }, attributes: Record<string, unknown> = {}): DeviceFlowNode => ({
  id,
  type: 'device',
  position,
  data: { projection: { id, kind: 'PHYSICAL_OBJECT', label: id, source_refs: [], attributes } },
});

describe('node footprint presentation geometry', () => {
  it('uses blueprint body dimensions for mixed-size physical objects', () => {
    const small = node('small', { x: 0, y: 0 }, { blueprint_presentation: { body: { width: 40, height: 20 } } });
    const large = node('large', { x: 45, y: 0 }, { blueprint_presentation: { body: { width: 320, height: 180 } } });
    expect(nodeFootprint(small)).toMatchObject({ width: 40, height: 20 });
    expect(nodeFootprint(large)).toMatchObject({ width: 320, height: 180 });
    expect(rectanglesOverlap(nodeFootprint(small), nodeFootprint(large))).toBe(false);
  });

  it('uses the existing generic layout footprint and permits touching boundaries', () => {
    const left = node('left', { x: 0, y: 0 });
    const right = node('right', { x: LAYOUT_NODE_WIDTH, y: 0 });
    expect(nodeFootprint(left)).toMatchObject({ width: LAYOUT_NODE_WIDTH, height: LAYOUT_NODE_HEIGHT });
    expect(rectanglesOverlap(nodeFootprint(left), nodeFootprint(right))).toBe(false);
  });
});
