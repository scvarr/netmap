import type { LocationDocument } from './locationTypes';
import type { MapPlacement } from './savedMapTypes';
import type { FlowRectangle } from './nodeFootprint';

/** Presentation spacing in flow coordinates; Location has no stored geometry. */
export const LOCATION_FRAME_PADDING = 24;
export const LOCATION_FRAME_HEADER = 32;

export interface DisplayedPhysicalObject {
  physicalObjectId: string;
  rectangle: FlowRectangle;
}

export interface LocationFrame {
  locationId: string;
  parentLocationId: string | null;
  label: string;
  depth: number;
  bounds: FlowRectangle;
}

const union = (rectangles: readonly FlowRectangle[]): FlowRectangle => {
  const x = Math.min(...rectangles.map((rectangle) => rectangle.x));
  const y = Math.min(...rectangles.map((rectangle) => rectangle.y));
  const right = Math.max(...rectangles.map((rectangle) => rectangle.x + rectangle.width));
  const bottom = Math.max(...rectangles.map((rectangle) => rectangle.y + rectangle.height));
  return { x, y, width: right - x, height: bottom - y };
};

/** Direct canonical membership, then bottom-up bounds over displayed descendants only. */
export function deriveLocationFrames(
  locations: readonly LocationDocument[],
  placements: readonly MapPlacement[],
  displayedObjects: readonly DisplayedPhysicalObject[],
): LocationFrame[] {
  const byId = new Map(locations.map((location) => [location.location_ref.entity_id, location]));
  const children = new Map<string, string[]>();
  for (const location of locations) {
    const parentId = location.parent_location_ref?.entity_id;
    if (parentId && byId.has(parentId)) children.set(parentId, [...(children.get(parentId) ?? []), location.location_ref.entity_id]);
  }
  const displayedById = new Map(displayedObjects.map((object) => [object.physicalObjectId, object.rectangle]));
  const direct = new Map<string, FlowRectangle[]>();
  for (const placement of placements) {
    const locationId = placement.location_ref?.entity_id;
    const rectangle = displayedById.get(placement.physical_object_ref.entity_id);
    if (locationId && byId.has(locationId) && rectangle) direct.set(locationId, [...(direct.get(locationId) ?? []), rectangle]);
  }

  const frames = new Map<string, LocationFrame>();
  const visiting = new Set<string>();
  const visit = (id: string, depth: number): LocationFrame | null => {
    if (visiting.has(id)) return null; // An invalid catalog must not invent cyclic containment.
    visiting.add(id);
    const location = byId.get(id)!;
    const childFrames = (children.get(id) ?? []).flatMap((childId) => {
      const frame = visit(childId, depth + 1);
      return frame ? [frame] : [];
    });
    visiting.delete(id);
    const content = [...(direct.get(id) ?? []), ...childFrames.map((frame) => frame.bounds)];
    if (!content.length) return null;
    const contentBounds = union(content);
    const frame: LocationFrame = {
      locationId: id,
      parentLocationId: location.parent_location_ref?.entity_id ?? null,
      label: location.name,
      depth,
      bounds: {
        x: contentBounds.x - LOCATION_FRAME_PADDING,
        y: contentBounds.y - LOCATION_FRAME_PADDING - LOCATION_FRAME_HEADER,
        width: contentBounds.width + LOCATION_FRAME_PADDING * 2,
        height: contentBounds.height + LOCATION_FRAME_PADDING * 2 + LOCATION_FRAME_HEADER,
      },
    };
    frames.set(id, frame);
    return frame;
  };
  for (const location of locations) {
    const id = location.location_ref.entity_id;
    if (!location.parent_location_ref || !byId.has(location.parent_location_ref.entity_id)) visit(id, 0);
  }
  return [...frames.values()].sort((a, b) => a.depth - b.depth || a.locationId.localeCompare(b.locationId));
}
