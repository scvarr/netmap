import { describe, expect, it } from 'vitest';
import { deleteRegionDraftVertex, insertRegionDraftVertex, moveRegionDraftVertex, translateRegionDraft, validateRegionDraftPolygon } from './regionDraftGeometry';

const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe('Region draft geometry', () => {
  it('moves one vertex', () => expect(moveRegionDraftVertex(square, 1, { x: 12, y: 2 })).toEqual([{ x: 0, y: 0 }, { x: 12, y: 2 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));
  it('inserts a midpoint vertex at the ordered edge index', () => expect(insertRegionDraftVertex(square, 1, { x: 10, y: 5 })).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));
  it('deletes a vertex but cannot reduce a polygon below three', () => {
    expect(deleteRegionDraftVertex(square, 1)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(deleteRegionDraftVertex(square.slice(0, 3), 1)).toEqual(square.slice(0, 3));
  });
  it('translates every point by one delta without changing relative geometry', () => expect(translateRegionDraft(square, { x: -3, y: 4 })).toEqual([{ x: -3, y: 4 }, { x: 7, y: 4 }, { x: 7, y: 14 }, { x: -3, y: 14 }]));
  it.each([
    ['valid polygon', square, true],
    ['zero-length edge', [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }], false],
    ['repeated vertex', [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2 }], false],
    ['self intersection', [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }], false],
    ['boundary self-contact', [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 2, y: 0 }, { x: 0, y: 4 }], false],
    ['exact zero area', [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], false],
    ['very small exact non-zero area', [{ x: 0, y: 0 }, { x: 1e-20, y: 0 }, { x: 0, y: 1e-20 }], true],
  ])('%s', (_, points, valid) => expect(validateRegionDraftPolygon(points).valid).toBe(valid));
});
