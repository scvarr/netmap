import { describe, expect, it } from 'vitest';
import { assistSegment, segmentAngle, segmentLength } from './geometryAssist';

const flow = (point: { x: number; y: number }) => point;
const assist = (x: number, y: number, options: Partial<Parameters<typeof assistSegment>[0]> = {}) => assistSegment({ anchor: { x: 0, y: 0 }, pointerScreen: { x, y }, screenToFlowPosition: flow, flowToScreenPosition: flow, ...options });

describe('geometry assist', () => {
  it('calculates canvas angle and flow-coordinate length', () => {
    expect(segmentAngle({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(270);
    expect(segmentLength({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it('leaves an exact target unchanged', () => expect(assist(100, 0)).toMatchObject({ point: { x: 100, y: 0 }, snappedAngle: true, snappedLength: true }));
  it('magnetically snaps a near 10 degree direction', () => expect(assist(99, 19)).toMatchObject({ snappedAngle: true, angle: 10 }));
  it('does not snap an angle outside capture', () => expect(assist(100, 27)).toMatchObject({ snappedAngle: false }));
  it('magnetically snaps a near 10-unit length', () => expect(assist(103, 0)).toMatchObject({ snappedLength: true, length: 100 }));
  it('does not snap a length outside capture', () => expect(assist(105, 0)).toMatchObject({ snappedLength: false }));
  it('combines direction and length when their joint point is nearby', () => {
    const result = assist(98, 18); expect(result).toMatchObject({ snappedAngle: true, snappedLength: true, angle: 10 }); expect(result.length).toBeCloseTo(100);
  });
  it('Ctrl bypasses automatic magnets', () => expect(assist(98, 18, { ctrlKey: true })).toMatchObject({ point: { x: 98, y: 18 }, snappedAngle: false, snappedLength: false }));
  it('Shift keeps its screen-axis constraint while length can snap', () => expect(assist(103, 4, { shiftKey: true })).toMatchObject({ point: { x: 100, y: 0 }, snappedAngle: false, snappedLength: true }));
  it('Ctrl+Shift keeps H/V but leaves length free', () => expect(assist(103, 4, { shiftKey: true, ctrlKey: true })).toMatchObject({ point: { x: 103, y: 0 }, snappedAngle: false, snappedLength: false }));
  it('uses the same screen capture at different zoom factors', () => {
    const atZoom = (zoom: number) => assistSegment({ anchor: { x: 0, y: 0 }, pointerScreen: { x: 100 * zoom + 3, y: 0 }, screenToFlowPosition: ({ x, y }) => ({ x: x / zoom, y: y / zoom }), flowToScreenPosition: ({ x, y }) => ({ x: x * zoom, y: y * zoom }) });
    expect(atZoom(1).snappedLength).toBe(true); expect(atZoom(2).snappedLength).toBe(true);
  });
});
