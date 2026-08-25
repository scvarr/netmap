import { describe, expect, it } from 'vitest';
import { cableRouteForCollapsedCable } from './cableRoutePresentation';

const cable = (id: string, label = 'same label') => ({
  id: `node-${id}`,
  kind: 'PHYSICAL_OBJECT',
  label,
  source_refs: [{ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: id }],
  attributes: { class: 'cable' },
});
const route = (id: string, waypoints = [{ x: 12, y: -3 }]) => ({
  cable_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: id },
  view: 'L1/PHYSICAL_OBJECT' as const,
  waypoints,
});

describe('authoritative collapsed cable route lookup', () => {
  it('matches only the exact canonical cable PhysicalObject identity', () => {
    const current = route('cable-a');
    expect(cableRouteForCollapsedCable(cable('cable-a'), [route('cable-b'), current])).toBe(current);
    expect(cableRouteForCollapsedCable(cable('cable-b', 'same label'), [current])).toBeUndefined();
  });

  it('preserves a persisted zero-waypoint record instead of treating it as no route', () => {
    const explicitStraightRoute = route('cable-a', []);
    expect(cableRouteForCollapsedCable(cable('cable-a'), [explicitStraightRoute])).toBe(explicitStraightRoute);
    expect(cableRouteForCollapsedCable(cable('cable-a'), [])).toBeUndefined();
  });
});
