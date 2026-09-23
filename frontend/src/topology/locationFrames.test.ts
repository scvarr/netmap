import { describe, expect, it } from 'vitest';
import { deriveLocationFrames, LOCATION_FRAME_HEADER, LOCATION_FRAME_PADDING } from './locationFrames';
import type { LocationDocument } from './locationTypes';
import type { MapPlacement } from './savedMapTypes';

const location = (id: string, parent: string | null = null): LocationDocument => ({
  location_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: id },
  name: id,
  type: null,
  parent_location_ref: parent ? { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: parent } : null,
});
const placement = (id: string, at: string | null): MapPlacement => ({
  physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id },
  location_ref: at ? location(at).location_ref : null,
  positions: {},
});
const shown = (physicalObjectId: string, x: number, y: number, width = 100, height = 60) => ({
  physicalObjectId, rectangle: { x, y, width, height },
});
const contains = (outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }) => {
  expect(outer.x).toBeLessThan(inner.x);
  expect(outer.y).toBeLessThan(inner.y);
  expect(outer.x + outer.width).toBeGreaterThan(inner.x + inner.width);
  expect(outer.y + outer.height).toBeGreaterThan(inner.y + inner.height);
};

describe('expanded canonical Location frames', () => {
  it('frames a direct object using its actual rendered rectangle and presentation space', () => {
    const [frame] = deriveLocationFrames([location('room')], [placement('server', 'room')], [shown('server', 10, 20, 310, 170)]);
    expect(frame).toMatchObject({ locationId: 'room', label: 'room', depth: 0, parentLocationId: null });
    expect(frame.bounds).toEqual({ x: 10 - LOCATION_FRAME_PADDING, y: 20 - LOCATION_FRAME_PADDING - LOCATION_FRAME_HEADER, width: 310 + LOCATION_FRAME_PADDING * 2, height: 170 + LOCATION_FRAME_PADDING * 2 + LOCATION_FRAME_HEADER });
  });

  it('builds every populated ancestor, enclosing a child frame and direct parent object', () => {
    const frames = deriveLocationFrames(
      [location('room'), location('rack', 'room'), location('unit', 'rack')],
      [placement('parent-object', 'room'), placement('leaf-object', 'unit')],
      [shown('parent-object', 0, 0), shown('leaf-object', 400, 200)],
    );
    expect(frames.map((frame) => frame.locationId)).toEqual(['room', 'rack', 'unit']);
    const [room, rack, unit] = frames;
    expect(frames.map((frame) => frame.depth)).toEqual([0, 1, 2]);
    contains(room.bounds, rack.bounds);
    contains(rack.bounds, unit.bounds);
    contains(room.bounds, shown('parent-object', 0, 0).rectangle);
  });

  it('keeps siblings separate and omits empty branches, unknown Locations and unlocated objects', () => {
    const frames = deriveLocationFrames(
      [location('room'), location('rack-a', 'room'), location('rack-b', 'room'), location('empty', 'room')],
      [placement('a', 'rack-a'), placement('b', 'rack-b'), placement('none', null), placement('unknown', 'missing')],
      [shown('a', 0, 0), shown('b', 400, 0), shown('none', 800, 0), shown('unknown', 1000, 0)],
    );
    expect(frames.map((frame) => frame.locationId)).toEqual(['room', 'rack-a', 'rack-b']);
    expect(frames[1].bounds.x + frames[1].bounds.width).toBeLessThan(frames[2].bounds.x);
    expect(frames[0].bounds.x + frames[0].bounds.width).toBeLessThan(800);
  });

  it('recomputes bounds from current position and display dimensions', () => {
    const input = [location('rack')];
    const placements = [placement('switch', 'rack')];
    const first = deriveLocationFrames(input, placements, [shown('switch', 5, 8, 100, 60)])[0].bounds;
    const moved = deriveLocationFrames(input, placements, [shown('switch', 55, 88, 100, 60)])[0].bounds;
    const resized = deriveLocationFrames(input, placements, [shown('switch', 5, 8, 240, 180)])[0].bounds;
    expect(moved.x - first.x).toBe(50);
    expect(moved.y - first.y).toBe(80);
    expect(resized.width - first.width).toBe(140);
    expect(resized.height - first.height).toBe(120);
  });

  it('has no fixed hierarchy depth or Location type taxonomy', () => {
    const levels = Array.from({ length: 9 }, (_, index) => location(`L${index}`, index ? `L${index - 1}` : null));
    const frames = deriveLocationFrames(levels, [placement('x', 'L8')], [shown('x', 0, 0)]);
    expect(frames).toHaveLength(9);
    expect(frames.at(-1)?.depth).toBe(8);
    expect(frames[0].bounds.width).toBeGreaterThan(frames.at(-1)!.bounds.width);
  });
});
