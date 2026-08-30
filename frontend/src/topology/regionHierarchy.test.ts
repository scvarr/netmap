import { describe, expect, it } from 'vitest';
import { deriveRegionHierarchy } from './regionHierarchy';
import type { MapRegion } from './savedMapTypes';

const region = (id: string, label: string, min: number, max: number): MapRegion => ({
  region_ref: { entity_type: 'MapRegion', entity_id: id }, label,
  points: [{ x: min, y: min }, { x: max, y: min }, { x: max, y: max }, { x: min, y: max }],
  style: { fill_color: '#000', fill_opacity: 0, stroke_color: '#000', stroke_width: 1, stroke_style: 'solid' }, z_order: 0,
});
const treeShape = (nodes: ReturnType<typeof deriveRegionHierarchy>): unknown[] => nodes.map((node) => [node.region.region_ref.entity_id, treeShape(node.children)]);
const shape = (regions: readonly MapRegion[]) => treeShape(deriveRegionHierarchy(regions));

describe('deriveRegionHierarchy', () => {
  it.each([
    ['keeps disjoint Regions as roots', [region('a', 'A', 0, 10), region('b', 'B', 20, 30)], [['a', []], ['b', []]]],
    ['nests an inner Region', [region('outer', 'Outer', 0, 30), region('inner', 'Inner', 5, 10)], [['outer', [['inner', []]]]]],
    ['supports arbitrary nesting depth', [region('outer', 'Outer', 0, 30), region('middle', 'Middle', 4, 20), region('inner', 'Inner', 6, 10)], [['outer', [['middle', [['inner', []]]]]]]],
    ['keeps siblings under their immediate parent', [region('parent', 'Parent', 0, 50), region('left', 'Left', 5, 15), region('right', 'Right', 20, 30)], [['parent', [['left', []], ['right', []]]]]],
    ['chooses the smallest containing Region as parent', [region('outer', 'Outer', 0, 50), region('middle', 'Middle', 5, 30), region('inner', 'Inner', 10, 15)], [['outer', [['middle', [['inner', []]]]]]]],
    ['keeps strict nesting with a sub-nanounit containment gap', [region('outer', 'Outer', 0, 1), region('inner', 'Inner', 5e-10, 1 - 5e-10)], [['outer', [['inner', []]]]]],
  ])('%s', (_, regions, expected) => expect(shape(regions)).toEqual(expected));

  it('does not depend on input order', () => {
    const regions = [region('outer', 'Outer', 0, 30), region('inner', 'Inner', 5, 10), region('root', 'Root', 40, 50)];
    expect(shape(regions)).toEqual(shape([...regions].reverse()));
  });

  it('keeps malformed ambiguous data bounded as roots', () => {
    const malformed = { ...region('bad', 'Bad', 0, 1), points: [] };
    const duplicate = region('outer', 'Duplicate', 0, 30);
    expect(() => shape([region('outer', 'Outer', 0, 30), region('inner', 'Inner', 5, 10), malformed, duplicate])).not.toThrow();
    expect(shape([region('outer', 'Outer', 0, 30), region('inner', 'Inner', 5, 10), malformed, duplicate])).toEqual([['bad', []], ['outer', [['inner', []]]]]);
  });
});
