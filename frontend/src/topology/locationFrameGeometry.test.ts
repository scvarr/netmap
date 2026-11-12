import { expect, it } from 'vitest';
import { layoutLocationFrames, translateFrameSubtree } from './locationFrameGeometry';
import { resolveBoundaryWaypoint } from './locationBoundaryAnchors';
import type { LocationDocument } from './locationTypes';
const location = (id: string, parent?: string): LocationDocument => ({ location_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: id }, name: id, type: null, parent_location_ref: parent ? { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: parent } : null });
const locations = [location('808'), location('823', '808'), location('821', '808'), location('U19', '823'), location('U23', '823')];
const inside = (p: { x: number; y: number; width: number; height: number }, c: typeof p) => c.x >= p.x + 20 && c.y >= p.y + 40 && c.x + c.width <= p.x + p.width - 20 && c.y + c.height <= p.y + p.height - 20;
it('lays out empty nested branches deterministically, independently of input order', () => {
  const frames = layoutLocationFrames(locations, new Map());
  expect(layoutLocationFrames([...locations].reverse(), new Map())).toEqual(frames);
  for (const l of locations) if (l.parent_location_ref) expect(inside(frames.get(l.parent_location_ref.entity_id)!, frames.get(l.location_ref.entity_id)!)).toBe(true);
  expect(frames.get('821')!.y + frames.get('821')!.height).toBeLessThan(frames.get('823')!.y);
  expect(frames.get('U19')!.y + frames.get('U19')!.height).toBeLessThan(frames.get('U23')!.y);
});
it('places a new child inside saved parents and keeps siblings apart after expansion', () => {
  const frames = layoutLocationFrames(locations, new Map());
  const expanded = layoutLocationFrames([...locations, location('U24', '823')], frames);
  expect(inside(expanded.get('823')!, expanded.get('U24')!)).toBe(true);
  expect(inside(expanded.get('808')!, expanded.get('823')!)).toBe(true);
  expect(expanded.get('U24')!.y).toBeGreaterThan(frames.get('U23')!.y + frames.get('U23')!.height);
});
it('translates descendants together and resolves each boundary on its own moved frame', () => {
  const frames = layoutLocationFrames(locations, new Map());
  const before = frames.get('823')!;
  const moved = translateFrameSubtree(locations, frames, '823', { ...before, x: before.x + 50, y: before.y + 70 });
  for (const id of ['823', 'U19', 'U23']) {
    expect(moved.get(id)!.x).toBe(frames.get(id)!.x + 50);
    expect(moved.get(id)!.y).toBe(frames.get(id)!.y + 70);
    const g = moved.get(id)!;
    const point = resolveBoundaryWaypoint({ x: 0, y: 0, anchor: { location_id: id, edge: g.edge, offset: g.offset } }, [{ locationId: id, bounds: g }]);
    expect(point.x).toBe(g.x + g.width);
    expect(point.y).toBe(g.y + g.height * .5);
  }
  expect(moved.get('821')).toEqual(frames.get('821'));
  expect(frames.get('823')).toEqual(before);
});
