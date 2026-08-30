import type { XYPosition } from '@xyflow/react';

export type RegionDraftValidation = { valid: true } | { valid: false; reason: 'too-few-points' | 'non-finite-point' | 'zero-length-edge' | 'repeated-vertex' | 'self-intersection' | 'zero-area' };

export const moveRegionDraftVertex = (points: readonly XYPosition[], index: number, point: XYPosition): XYPosition[] =>
  points.map((current, currentIndex) => currentIndex === index ? { x: point.x, y: point.y } : { x: current.x, y: current.y });

/** Inserts after the edge's start vertex, preserving the polygon's ordered ring. */
export const insertRegionDraftVertex = (points: readonly XYPosition[], edgeStartIndex: number, point: XYPosition): XYPosition[] =>
  [...points.slice(0, edgeStartIndex + 1), { x: point.x, y: point.y }, ...points.slice(edgeStartIndex + 1)];

export const deleteRegionDraftVertex = (points: readonly XYPosition[], index: number): XYPosition[] =>
  points.length <= 3 ? [...points] : points.filter((_, currentIndex) => currentIndex !== index);

export const translateRegionDraft = (points: readonly XYPosition[], delta: XYPosition): XYPosition[] =>
  points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }));

const samePoint = (left: XYPosition, right: XYPosition) => left.x === right.x && left.y === right.y;
const cross = (origin: XYPosition, left: XYPosition, right: XYPosition) =>
  (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
const pointOnSegment = (point: XYPosition, start: XYPosition, end: XYPosition) =>
  cross(start, end, point) === 0
  && point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x)
  && point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y);

const segmentsIntersect = (a: XYPosition, b: XYPosition, c: XYPosition, d: XYPosition) => {
  const abC = cross(a, b, c); const abD = cross(a, b, d);
  const cdA = cross(c, d, a); const cdB = cross(c, d, b);
  if ((abC > 0 && abD < 0 || abC < 0 && abD > 0) && (cdA > 0 && cdB < 0 || cdA < 0 && cdB > 0)) return true;
  return (abC === 0 && pointOnSegment(c, a, b)) || (abD === 0 && pointOnSegment(d, a, b)) || (cdA === 0 && pointOnSegment(a, c, d)) || (cdB === 0 && pointOnSegment(b, c, d));
};

export const validateRegionDraftPolygon = (points: readonly XYPosition[]): RegionDraftValidation => {
  if (points.length < 3) return { valid: false, reason: 'too-few-points' };
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return { valid: false, reason: 'non-finite-point' };
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    if (samePoint(points[index], next)) return { valid: false, reason: 'zero-length-edge' };
    for (let other = index + 1; other < points.length; other += 1)
      if (samePoint(points[index], points[other])) return { valid: false, reason: 'repeated-vertex' };
  }
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    for (let other = index + 1; other < points.length; other += 1) {
      const otherNext = (other + 1) % points.length;
      if (index === other || next === other || otherNext === index) continue;
      if (segmentsIntersect(points[index], points[next], points[other], points[otherNext])) return { valid: false, reason: 'self-intersection' };
    }
  }
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    doubledArea += points[index].x * next.y - next.x * points[index].y;
  }
  return doubledArea === 0 ? { valid: false, reason: 'zero-area' } : { valid: true };
};
