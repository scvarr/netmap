import { describe, expect, it } from 'vitest';
import { waypointAtSegmentLength } from './numericSegmentGeometry';
import { segmentLength } from './geometryAssist';

describe('exact numeric segment length', () => {
  it.each([
    [{ x: 10, y: 20 }, { x: 30, y: 20 }, '12.5', { x: 22.5, y: 20 }],
    [{ x: 10, y: 20 }, { x: 10, y: 40 }, '12.5', { x: 10, y: 32.5 }],
    [{ x: 10, y: 20 }, { x: 20, y: 30 }, '7.5', { x: 10 + 7.5 / Math.SQRT2, y: 20 + 7.5 / Math.SQRT2 }],
  ])('moves only the selected waypoint along its current direction', (fixed, selected, length, expected) => {
    const originalFixed = { ...fixed };
    const moved = waypointAtSegmentLength(fixed, selected, length);
    expect(moved?.x).toBeCloseTo(expected.x);
    expect(moved?.y).toBeCloseTo(expected.y);
    expect(segmentLength(fixed, moved!)).toBeCloseTo(Number(length));
    expect(fixed).toEqual(originalFixed);
  });

  it.each(['', ' ', '0', '-2', 'NaN', 'Infinity', 'abc', '1e999'])('rejects invalid length %s', (value) => {
    expect(waypointAtSegmentLength({ x: 0, y: 0 }, { x: 5, y: 0 }, value)).toBeNull();
  });

  it('does not numerically move a boundary anchor or a zero-length segment', () => {
    const anchor = { x: 5, y: 0, anchor: { location_id: 'room', edge: 'left' as const, offset: .5 } };
    expect(waypointAtSegmentLength({ x: 0, y: 0 }, anchor, '20')).toBeNull();
    expect(waypointAtSegmentLength({ x: 0, y: 0 }, { x: 0, y: 0 }, '20')).toBeNull();
    expect(waypointAtSegmentLength(anchor, { x: 10, y: 0 }, '20')).toEqual({ x: 25, y: 0 });
    expect(anchor.anchor).toEqual({ location_id: 'room', edge: 'left', offset: .5 });
  });
});
