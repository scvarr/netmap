import { describe, expect, it } from 'vitest';
import { assistBoundaryWaypoint, normalizeLocationBoundaryAnchors, projectBoundaryWaypoint, resolveBoundaryWaypoint } from './locationBoundaryAnchors';
import type { MapCableRouteWaypoint } from './savedMapTypes';

const frame = { locationId: 'child', bounds: { x: 0, y: 0, width: 100, height: 80 } };
const source = { x: 50, y: 40 }, target = { x: 150, y: 40 };

describe('Location boundary anchors', () => {
  it('inserts an anchor between free waypoints and keeps route order on repeated saves', () => {
    const initial = [{ x: 75, y: 40 }, { x: 125, y: 40 }];
    const normalized = normalizeLocationBoundaryAnchors(source, target, initial, [frame]);
    expect(normalized).toEqual([initial[0], { x: 100, y: 40, anchor: { location_id: 'child', edge: 'right', offset: 0.5 } }, initial[1]]);
    expect(normalizeLocationBoundaryAnchors(source, target, normalized, [frame])).toEqual(normalized);
  });

  it('converts a waypoint already on the crossing and ignores a tangent touch', () => {
    const normalized = normalizeLocationBoundaryAnchors(source, target, [{ x: 100, y: 40 }], [frame]);
    expect(normalized).toEqual([{ x: 100, y: 40, anchor: { location_id: 'child', edge: 'right', offset: 0.5 } }]);
    expect(normalizeLocationBoundaryAnchors({ x: -20, y: 20 }, { x: -20, y: 60 }, [{ x: 0, y: 40 }], [frame])).toEqual([{ x: 0, y: 40 }]);
  });

  it('resolves all four sides from current frame bounds while preserving offset', () => {
    const resized = { locationId: 'child', bounds: { x: 10, y: 20, width: 200, height: 120 } };
    const expected = { top: { x: 60, y: 20 }, right: { x: 210, y: 50 }, bottom: { x: 60, y: 140 }, left: { x: 10, y: 50 } };
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const waypoint: MapCableRouteWaypoint = { x: -1, y: -1, anchor: { location_id: 'child', edge, offset: 0.25 } };
      expect(resolveBoundaryWaypoint(waypoint, [resized])).toEqual({ ...expected[edge], anchor: waypoint.anchor });
      expect(resolveBoundaryWaypoint(waypoint, [])).toEqual(waypoint);
      expect(waypoint.anchor?.offset).toBe(0.25);
    }
  });

  it('projects dragged anchors onto the nearest edge and crosses corners', () => {
    const right = projectBoundaryWaypoint('child', frame.bounds, { x: 130, y: 70 });
    expect(right).toEqual({ x: 100, y: 70, anchor: { location_id: 'child', edge: 'right', offset: 0.875 } });
    const bottom = projectBoundaryWaypoint('child', frame.bounds, { x: 70, y: 110 });
    expect(bottom).toEqual({ x: 70, y: 80, anchor: { location_id: 'child', edge: 'bottom', offset: 0.7 } });
    expect(projectBoundaryWaypoint('child', frame.bounds, { x: 150, y: 110 })).toMatchObject({ x: 100, y: 80 });
  });

  it('preserves explicit anchors of different Locations without adding geometric duplicates', () => {
    const outside = { locationId: 'outside', bounds: { x: 200, y: 0, width: 100, height: 80 } };
    const childAnchor: MapCableRouteWaypoint = { x: 100, y: 40, anchor: { location_id: 'child', edge: 'right', offset: .5 } };
    const outsideAnchor: MapCableRouteWaypoint = { x: 200, y: 40, anchor: { location_id: 'outside', edge: 'left', offset: .5 } };
    const route = [childAnchor, { x: 150, y: 40 }, outsideAnchor];
    expect(normalizeLocationBoundaryAnchors(source, { x: 250, y: 40 }, route, [frame, outside])).toEqual(route);
  });

  it('snaps a boundary drag to 45°, then 15°, otherwise projects, and crosses a corner', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const identity = (point: { x: number; y: number }) => point;
    const fortyFive = assistBoundaryWaypoint('child', bounds, { x: 100, y: 95 }, [{ x: 0, y: 0 }], identity);
    expect(fortyFive.x).toBeCloseTo(100);
    expect(fortyFive.y).toBeCloseTo(100);
    expect(fortyFive.anchor?.location_id).toBe('child');
    const fifteen = assistBoundaryWaypoint('child', bounds, { x: 100, y: 79 }, [{ x: 0, y: 50 }], identity);
    expect(fifteen.x).toBe(100);
    expect(fifteen.y).toBeCloseTo(50 + 100 * Math.tan(Math.PI / 12));
    expect(fifteen.anchor).toMatchObject({ edge: 'right', offset: fifteen.y / 100 });
    const unsnapped = assistBoundaryWaypoint('child', bounds, { x: 130, y: 70 }, [{ x: 0, y: 50 }], identity);
    expect(unsnapped).toMatchObject({ x: 100, y: 70, anchor: { edge: 'right', offset: .7 } });
    const corner = assistBoundaryWaypoint('child', bounds, { x: 70, y: 130 }, [{ x: 0, y: 50 }], identity);
    expect(corner).toMatchObject({ x: 70, y: 100, anchor: { edge: 'bottom', offset: .7 } });
  });
});
