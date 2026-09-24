import { describe, expect, it } from 'vitest';
import { prepareLocationGroupMove, type GroupCableGeometry } from './locationGroupMove';
import type { LocationDocument } from './locationTypes';
import type { MapPlacement } from './savedMapTypes';

const location = (id: string, parent: string | null = null): LocationDocument => ({
  location_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: id }, name: id, type: null,
  parent_location_ref: parent ? { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: parent } : null,
});
const placement = (id: string, at: string, x: number, y: number, locked = false): MapPlacement => ({
  physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id },
  location_ref: location(at).location_ref,
  positions: { 'L1/PHYSICAL_OBJECT': { x, y, locked, display_width: 180 } },
});
const frame = { x: -20, y: -20, width: 240, height: 260 };
const locations = [location('room'), location('rack', 'room'), location('outside')];
const placements = [placement('a', 'room', 0, 0), placement('hidden', 'rack', 0, 100), placement('external', 'outside', 500, 0)];
const rectangles = new Map(placements.map((item) => [item.physical_object_ref.entity_id, { x: item.positions['L1/PHYSICAL_OBJECT']!.x, y: item.positions['L1/PHYSICAL_OBJECT']!.y, width: 100, height: 60 }]));
const cables: GroupCableGeometry[] = [
  { cableId: 'internal', sourceObjectId: 'a', targetObjectId: 'hidden', source: { x: 50, y: 30 }, target: { x: 50, y: 130 }, savedWaypoints: [{ x: 50, y: 80 }] },
  { cableId: 'boundary', sourceObjectId: 'a', targetObjectId: 'external', source: { x: 50, y: 30 }, target: { x: 500, y: 30 }, savedWaypoints: [{ x: 100, y: 30 }, { x: 360, y: 30 }] },
  { cableId: 'no-route', sourceObjectId: 'hidden', targetObjectId: 'external', source: { x: 50, y: 130 }, target: { x: 500, y: 30 } },
  { cableId: 'external', sourceObjectId: 'external', targetObjectId: 'elsewhere', source: { x: 500, y: 30 }, target: { x: 700, y: 30 }, savedWaypoints: [{ x: 600, y: 30 }] },
];

describe('Location group movement geometry', () => {
  it('collects canonical descendants regardless of collapse and sends one displacement with only boundary evidence', () => {
    const request = prepareLocationGroupMove('room', { x: 40, y: 20 }, frame, locations, placements, rectangles, cables);
    expect(request.delta_x).toBe(40);
    expect(request.delta_y).toBe(20);
    expect(request.footprints.map((item) => item.physical_object_id)).toEqual(['a', 'hidden', 'external']);
    expect(request.boundary_routes.map((route) => route.cable_id)).toEqual(['boundary']);
    expect(request.boundary_routes[0].moving_endpoint_is_source).toBe(true);
  });

  it('rejects any locked descendant or external collision, while ignoring internal overlap', () => {
    expect(() => prepareLocationGroupMove('room', { x: 40, y: 20 }, frame, locations, [placements[0], { ...placements[1], positions: { 'L1/PHYSICAL_OBJECT': { x: 0, y: 100, locked: true } } }, placements[2]], rectangles, cables)).toThrow(/зафиксированным/);
    expect(() => prepareLocationGroupMove('room', { x: 450, y: 0 }, frame, locations, placements, rectangles, cables)).toThrow(/пересекает/);
    const overlapping = [placements[0], { ...placements[1], positions: { 'L1/PHYSICAL_OBJECT': { x: 0, y: 0, locked: false } } }, placements[2]];
    expect(() => prepareLocationGroupMove('room', { x: 40, y: 20 }, frame, locations, overlapping, rectangles, cables)).not.toThrow();
  });

  it('sends saved boundary route evidence without client-side frame split rejection', () => {
    const reversed: GroupCableGeometry = { cableId: 'reverse', sourceObjectId: 'external', targetObjectId: 'a', source: { x: 500, y: 30 }, target: { x: 50, y: 30 }, savedWaypoints: [{ x: 360, y: 30 }, { x: 100, y: 30 }] };
    expect(prepareLocationGroupMove('room', { x: 40, y: 20 }, frame, locations, placements, rectangles, [reversed]).boundary_routes).toMatchObject([{ cable_id: 'reverse', moving_endpoint_is_source: false }]);
  });

  it('prepares a child move with no route, one ordinary crossing, a boundary anchor, and reversed cable orientation', () => {
    const childFrame = { x: -20, y: 80, width: 340, height: 100 };
    const childPlacements = [placement('child-a', 'rack', 0, 100), placement('child-b', 'rack', 200, 100), placement('sibling', 'room', 0, 0), placement('outside', 'outside', 900, 0)];
    const childRectangles = new Map(childPlacements.map((item) => [item.physical_object_ref.entity_id, { x: item.positions['L1/PHYSICAL_OBJECT']!.x, y: item.positions['L1/PHYSICAL_OBJECT']!.y, width: 100, height: 60 }]));
    const route = (savedWaypoints?: GroupCableGeometry['savedWaypoints']): GroupCableGeometry => ({ cableId: 'child-boundary', sourceObjectId: 'child-a', targetObjectId: 'outside', source: { x: 50, y: 130 }, target: { x: 900, y: 30 }, savedWaypoints });
    const move = (cable: GroupCableGeometry) => prepareLocationGroupMove('rack', { x: 400, y: 20 }, childFrame, locations, childPlacements, childRectangles, [cable]);
    expect(move(route()).boundary_routes).toEqual([]);
    expect(move(route([{ x: 200, y: 130 }, { x: 400, y: 130 }])).boundary_routes).toHaveLength(1);
    expect(move(route([{ x: 200, y: 130 }, { x: 320, y: 130 }, { x: 400, y: 130 }])).boundary_routes).toMatchObject([{ cable_id: 'child-boundary', moving_endpoint_is_source: true }]);
    const reverse: GroupCableGeometry = { cableId: 'child-boundary', sourceObjectId: 'outside', targetObjectId: 'child-a', source: { x: 900, y: 30 }, target: { x: 50, y: 130 }, savedWaypoints: [{ x: 400, y: 130 }, { x: 320, y: 130 }, { x: 200, y: 130 }] };
    expect(move(reverse).boundary_routes).toMatchObject([{ cable_id: 'child-boundary', moving_endpoint_is_source: false }]);
    expect(move(route([{ x: 200, y: 130 }, { x: 400, y: 130 }, { x: 200, y: 130 }, { x: 500, y: 130 }])).boundary_routes).toHaveLength(1);
  });
});
