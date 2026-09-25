import { describe, expect, it } from 'vitest';
import { findForeignRouteSnap, FOREIGN_SEGMENT_CAPTURE_PX, FOREIGN_WAYPOINT_RADIUS_FLOW, FOREIGN_WAYPOINT_STROKE_FLOW, type ForeignRouteGeometry } from './foreignRouteSnap';

const transforms = (zoom: number) => ({
  toScreen: (point: { x: number; y: number }) => ({ x: point.x * zoom, y: point.y * zoom }),
  toFlow: (point: { x: number; y: number }) => ({ x: point.x / zoom, y: point.y / zoom }),
});
const snap = (pointer: { x: number; y: number }, routes: ForeignRouteGeometry[], zoom = 1, boundary?: Parameters<typeof findForeignRouteSnap>[4]) => {
  const { toScreen, toFlow } = transforms(zoom);
  return findForeignRouteSnap(pointer, routes, toScreen, toFlow, boundary);
};

describe('foreign route geometry snap', () => {
  it('chooses the nearest waypoint independent of route order and before a closer segment', () => {
    const near = { waypoints: [{ x: 15, y: 0 }], segments: [] };
    const far = { waypoints: [{ x: 18, y: 0 }], segments: [[{ x: 10, y: -10 }, { x: 10, y: 10 }]] as const };
    expect(snap({ x: 11, y: 0 }, [far, near])).toEqual({ kind: 'waypoint', point: { x: 15, y: 0 } });
    expect(snap({ x: 11, y: 0 }, [near, far])).toEqual({ kind: 'waypoint', point: { x: 15, y: 0 } });
  });

  it('projects to the nearest visible segment, including a straight route without waypoints', () => {
    const straight = { waypoints: [], segments: [[{ x: 0, y: 0 }, { x: 100, y: 0 }]] as const };
    const routed = { waypoints: [{ x: 40, y: 30 }], segments: [[{ x: 40, y: 30 }, { x: 80, y: 30 }]] as const };
    expect(snap({ x: 27, y: 3 }, [straight, routed])).toMatchObject({ kind: 'segment', point: { x: 27, y: 0 } });
    expect(snap({ x: 55, y: 27 }, [straight, routed])).toMatchObject({ kind: 'segment', point: { x: 55, y: 30 } });
  });

  it('captures a waypoint only inside its rendered circle, with no 8px halo', () => {
    const route = { waypoints: [{ x: 20, y: 0 }], segments: [] };
    expect(snap({ x: 24.4, y: 0 }, [route])?.kind).toBe('waypoint');
    expect(snap({ x: 24.6, y: 0 }, [route])).toBeNull();
    expect(snap({ x: 27.9, y: 0 }, [route])).toBeNull();
    expect(snap({ x: 25, y: 0 }, [{ ...route, segments: [[{ x: 0, y: 0 }, { x: 100, y: 0 }]] }])?.kind).toBe('segment');
  });

  it('uses the rendered waypoint footprint at different zoom values while segment capture stays at 8 screen pixels', () => {
    const route = { waypoints: [{ x: 100, y: 100 }], segments: [] };
    for (const zoom of [0.5, 1, 4]) {
      const visibleRadiusPx = (FOREIGN_WAYPOINT_RADIUS_FLOW + FOREIGN_WAYPOINT_STROKE_FLOW / 2) * zoom;
      expect(snap({ x: 100 * zoom + visibleRadiusPx - 0.1, y: 100 * zoom }, [route], zoom)?.point).toEqual({ x: 100, y: 100 });
      expect(snap({ x: 100 * zoom + visibleRadiusPx + 0.1, y: 100 * zoom }, [route], zoom)).toBeNull();
      const segment = { waypoints: [], segments: [[{ x: 0, y: 100 }, { x: 200, y: 100 }]] as const };
      expect(snap({ x: 100 * zoom, y: 100 * zoom + FOREIGN_SEGMENT_CAPTURE_PX - 0.1 }, [segment], zoom)?.kind).toBe('segment');
      expect(snap({ x: 100 * zoom, y: 100 * zoom + FOREIGN_SEGMENT_CAPTURE_PX + 0.1 }, [segment], zoom)).toBeNull();
    }
  });

  it('chooses dense waypoint markers by actual pointer distance instead of their former halo or render order', () => {
    const left = { waypoints: [{ x: 10, y: 0 }], segments: [] };
    const right = { waypoints: [{ x: 18, y: 0 }], segments: [] };
    expect(snap({ x: 13.8, y: 0 }, [left, right])?.point).toEqual({ x: 10, y: 0 });
    expect(snap({ x: 13.8, y: 0 }, [right, left])?.point).toEqual({ x: 10, y: 0 });
    expect(snap({ x: 15, y: 0 }, [left, right])?.point).toEqual({ x: 18, y: 0 });
  });

  it('keeps an anchor on its own boundary and never copies foreign anchor metadata', () => {
    const frame = { locationId: 'own', bounds: { x: 0, y: 0, width: 100, height: 100 } };
    const route = { waypoints: [{ x: 101, y: 40, anchor: { location_id: 'foreign', edge: 'left' as const, offset: .4 } }, { x: 30, y: 30 }], segments: [[{ x: 50, y: 50 }, { x: 150, y: 50 }]] as const };
    expect(snap({ x: 102, y: 40 }, [route], 1, frame)).toEqual({ kind: 'waypoint', point: { x: 100, y: 40, anchor: { location_id: 'own', edge: 'right', offset: .4 } } });
    expect(snap({ x: 100, y: 50 }, [{ waypoints: [], segments: route.segments }], 1, frame)).toMatchObject({ kind: 'segment', point: { x: 100, y: 50, anchor: { location_id: 'own', edge: 'right' } } });
    expect(snap({ x: 30, y: 30 }, [{ waypoints: [{ x: 30, y: 30 }], segments: [] }], 1, frame)).toBeNull();
  });

  it('uses the rotated visible diamond footprint without a boundary marker halo', () => {
    const route = { waypoints: [{ x: 100, y: 40, anchor: { location_id: 'foreign', edge: 'right' as const, offset: .4 } }], segments: [] };
    expect(snap({ x: 105.9, y: 40 }, [route])?.kind).toBe('waypoint');
    expect(snap({ x: 106.1, y: 40 }, [route])).toBeNull();
    expect(snap({ x: 104, y: 44 }, [route])).toBeNull();
    expect(snap({ x: (100 + 5.9) * 2, y: 40 * 2 }, [route], 2)?.kind).toBe('waypoint');
    expect(snap({ x: (100 + 6.1) * 2, y: 40 * 2 }, [route], 2)).toBeNull();
  });

  it('returns only an independent coordinate value for an ordinary route draft', () => {
    const waypoint = { x: 20, y: 30, anchor: { location_id: 'foreign', edge: 'top' as const, offset: .2 } };
    const result = snap({ x: 20, y: 30 }, [{ waypoints: [waypoint], segments: [] }]);
    expect(result?.point).toEqual({ x: 20, y: 30 });
    waypoint.x = 80;
    expect(result?.point).toEqual({ x: 20, y: 30 });
    expect(Object.keys(result!.point)).toEqual(['x', 'y']);
  });
});
