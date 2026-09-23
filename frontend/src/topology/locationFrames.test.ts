import { describe, expect, it } from 'vitest';
import { deriveLocationPresentation, LOCATION_FRAME_PADDING } from './locationFrames';
import type { LocationDocument } from './locationTypes';
import type { MapPlacement } from './savedMapTypes';
import type { FlowRectangle } from './nodeFootprint';

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
const contains = (outer: FlowRectangle, inner: FlowRectangle) => {
  expect(outer.x).toBeLessThanOrEqual(inner.x);
  expect(outer.y).toBeLessThanOrEqual(inner.y);
  expect(outer.x + outer.width).toBeGreaterThanOrEqual(inner.x + inner.width);
  expect(outer.y + outer.height).toBeGreaterThanOrEqual(inner.y + inner.height);
};

describe('expanded Location presentation arity', () => {
  it('retains a full frame for two direct displayed objects using their actual rectangles', () => {
    const objects = [shown('a', 10, 20, 310, 170), shown('b', 450, 80, 100, 60)];
    const result = deriveLocationPresentation([location('room')], [placement('a', 'room'), placement('b', 'room')], objects);
    expect(result.frames).toHaveLength(1);
    expect(result.captions).toHaveLength(0);
    expect(result.frames[0]).toMatchObject({ locationId: 'room', label: 'room', pathLocationIds: ['room'] });
    objects.forEach((object) => contains(result.frames[0].bounds, object.rectangle));
    expect(result.frames[0].bounds).toEqual({
      x: 10 - LOCATION_FRAME_PADDING,
      y: 20 - LOCATION_FRAME_PADDING,
      width: 550 - 10 + LOCATION_FRAME_PADDING * 2,
      height: 190 - 20 + LOCATION_FRAME_PADDING * 2,
    });
  });

  it('retains a parent frame for two non-empty child Locations and ignores an empty sibling', () => {
    const result = deriveLocationPresentation(
      [location('room'), location('rack-a', 'room'), location('rack-b', 'room'), location('empty', 'room')],
      [placement('a', 'rack-a'), placement('b', 'rack-b')],
      [shown('a', 0, 0), shown('b', 400, 0)],
    );
    expect(result.frames.map((frame) => frame.locationId)).toEqual(['room']);
    expect(result.captions.map((caption) => caption.label)).toEqual(['rack-a', 'rack-b']);
    contains(result.frames[0].bounds, shown('a', 0, 0).rectangle);
    contains(result.frames[0].bounds, shown('b', 400, 0).rectangle);
  });

  it('suppresses a single-object frame and provides one compact object caption', () => {
    const result = deriveLocationPresentation([location('unit')], [placement('a', 'unit')], [shown('a', 10, 20)]);
    expect(result.frames).toEqual([]);
    expect(result.captions).toMatchObject([{ physicalObjectId: 'a', label: 'unit', pathLocationIds: ['unit'] }]);
    expect(result.captions[0]).not.toHaveProperty('bounds');
    expect(result.captions[0].position.x).toBe(10);
  });

  it('compresses a deep unary chain into one path without repeated padding or headers', () => {
    const locations = Array.from({ length: 12 }, (_, index) => location(`L${index}`, index ? `L${index - 1}` : null));
    const one = deriveLocationPresentation([location('L11')], [placement('a', 'L11')], [shown('a', 0, 100)]);
    const deep = deriveLocationPresentation(locations, [placement('a', 'L11')], [shown('a', 0, 100)]);
    expect(deep.frames).toEqual([]);
    expect(deep.captions).toHaveLength(1);
    expect(deep.captions[0].pathLocationIds).toEqual(locations.map((item) => item.location_ref.entity_id));
    expect(deep.captions[0].label).toBe(locations.map((item) => item.name).join(' / '));
    expect(deep.captions[0].position).toEqual(one.captions[0].position);
  });

  it('merges unary ancestor names into one retained branching frame', () => {
    const objects = [shown('x', 0, 0), shown('y', 300, 0)];
    const result = deriveLocationPresentation(
      [location('A'), location('B', 'A'), location('C', 'B')],
      [placement('x', 'C'), placement('y', 'C')],
      objects,
    );
    const uncompressed = deriveLocationPresentation([location('C')], [placement('x', 'C'), placement('y', 'C')], objects);
    expect(result.frames).toMatchObject([{ locationId: 'C', label: 'A / B / C', pathLocationIds: ['A', 'B', 'C'] }]);
    expect(result.frames[0].bounds).toEqual(uncompressed.frames[0].bounds);
    expect(result.captions).toEqual([]);
  });

  it('does not size a retained frame from a long unary path label', () => {
    const long = 'Very-long-semantic-Location-name-that-exceeds-the-displayed-frame-width';
    const objects = [shown('x', 0, 0), shown('y', 100, 100)];
    const plain = deriveLocationPresentation([location('branch')], [placement('x', 'branch'), placement('y', 'branch')], objects);
    const path = deriveLocationPresentation([location(long), location('branch', long)], [placement('x', 'branch'), placement('y', 'branch')], objects);
    expect(path.frames[0].label).toBe(`${long} / branch`);
    expect(path.frames[0].bounds).toEqual(plain.frames[0].bounds);
  });

  it('retains a parent with one direct object and one non-empty child', () => {
    const result = deriveLocationPresentation(
      [location('parent'), location('child', 'parent')],
      [placement('a', 'parent'), placement('b', 'child')],
      [shown('a', 0, 0), shown('b', 300, 100)],
    );
    expect(result.frames.map((frame) => frame.locationId)).toEqual(['parent']);
    expect(result.captions.map((caption) => caption.label)).toEqual(['child']);
    contains(result.frames[0].bounds, shown('b', 300, 100).rectangle);
    contains(result.frames[0].bounds, shown('a', 0, 0).rectangle);
  });

  it('keeps the same parent bounds when a child object gains a unary caption', () => {
    const objects = [shown('a', 0, 0), shown('b', 300, 100)];
    const direct = deriveLocationPresentation([location('parent')], [placement('a', 'parent'), placement('b', 'parent')], objects);
    const unary = deriveLocationPresentation([location('parent'), location('child', 'parent')], [placement('a', 'parent'), placement('b', 'child')], objects);
    expect(unary.captions).toHaveLength(1);
    expect(unary.frames[0].bounds).toEqual(direct.frames[0].bounds);
  });

  it('derives frame bounds and caption position afresh on movement and resize', () => {
    const locations = [location('room'), location('unit', 'room')];
    const placements = [placement('a', 'room'), placement('b', 'unit')];
    const derive = (x: number, width: number) => deriveLocationPresentation(locations, placements, [shown('a', 0, 0), shown('b', x, 100, width, 60)]);
    const initial = derive(300, 100);
    const moved = derive(400, 100);
    const resized = derive(300, 400);
    expect(moved.captions[0].position.x - initial.captions[0].position.x).toBe(100);
    expect(moved.frames[0].bounds.width).toBeGreaterThan(initial.frames[0].bounds.width);
    expect(resized.frames[0].bounds.width).toBeGreaterThan(initial.frames[0].bounds.width);
  });

  it('does not invent representation for empty, unlocated, unknown or undisplayed placements', () => {
    const result = deriveLocationPresentation(
      [location('empty'), location('known')],
      [placement('unlocated', null), placement('unknown', 'missing'), placement('hidden', 'known')],
      [shown('unlocated', 0, 0), shown('unknown', 100, 0)],
    );
    expect(result).toEqual({ frames: [], captions: [] });
  });
});
