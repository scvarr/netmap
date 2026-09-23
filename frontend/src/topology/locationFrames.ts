import type { LocationDocument } from './locationTypes';
import type { MapPlacement } from './savedMapTypes';
import type { FlowRectangle } from './nodeFootprint';

/** Flow-coordinate presentation spacing; none of this is Location data. */
export const LOCATION_FRAME_PADDING = 20;

export interface DisplayedPhysicalObject {
  physicalObjectId: string;
  rectangle: FlowRectangle;
}

export interface LocationFrame {
  locationId: string;
  parentLocationId: string | null;
  pathLocationIds: string[];
  label: string;
  depth: number;
  bounds: FlowRectangle;
}

export interface ObjectLocationPath {
  physicalObjectId: string;
  pathLocationIds: string[];
  label: string;
}

export interface LocationPresentation {
  frames: LocationFrame[];
  objectPaths: ObjectLocationPath[];
}

const union = (rectangles: readonly FlowRectangle[]): FlowRectangle => {
  const x = Math.min(...rectangles.map((rectangle) => rectangle.x));
  const y = Math.min(...rectangles.map((rectangle) => rectangle.y));
  const right = Math.max(...rectangles.map((rectangle) => rectangle.x + rectangle.width));
  const bottom = Math.max(...rectangles.map((rectangle) => rectangle.y + rectangle.height));
  return { x, y, width: right - x, height: bottom - y };
};

const frameBounds = (content: FlowRectangle): FlowRectangle => ({
  x: content.x - LOCATION_FRAME_PADDING,
  y: content.y - LOCATION_FRAME_PADDING,
  width: content.width + LOCATION_FRAME_PADDING * 2,
  height: content.height + LOCATION_FRAME_PADDING * 2,
});

type Representation =
  | { kind: 'frame'; frame: LocationFrame; content: FlowRectangle; extent: FlowRectangle }
  | { kind: 'object'; path: ObjectLocationPath; object: FlowRectangle; extent: FlowRectangle };

/** Canonical direct arity determines whether a populated Location has a frame. */
export function deriveLocationPresentation(
  locations: readonly LocationDocument[],
  placements: readonly MapPlacement[],
  displayedObjects: readonly DisplayedPhysicalObject[],
): LocationPresentation {
  const byId = new Map(locations.map((location) => [location.location_ref.entity_id, location]));
  const children = new Map<string, string[]>();
  for (const location of locations) {
    const parentId = location.parent_location_ref?.entity_id;
    if (!parentId || !byId.has(parentId)) continue;
    const siblings = children.get(parentId) ?? [];
    siblings.push(location.location_ref.entity_id);
    children.set(parentId, siblings);
  }
  const displayedById = new Map(displayedObjects.map((object) => [object.physicalObjectId, object.rectangle]));
  const direct = new Map<string, DisplayedPhysicalObject[]>();
  for (const placement of placements) {
    const locationId = placement.location_ref?.entity_id;
    const rectangle = displayedById.get(placement.physical_object_ref.entity_id);
    if (!locationId || !byId.has(locationId) || !rectangle) continue;
    const members = direct.get(locationId) ?? [];
    members.push({ physicalObjectId: placement.physical_object_ref.entity_id, rectangle });
    direct.set(locationId, members);
  }

  const frames = new Map<string, LocationFrame>();
  const objectPaths = new Map<string, ObjectLocationPath>();
  const visiting = new Set<string>();
  const visit = (id: string, depth: number): Representation | null => {
    if (visiting.has(id)) return null; // Invalid cyclic catalogs provide no containment evidence.
    visiting.add(id);
    const location = byId.get(id)!;
    const childRepresentations = (children.get(id) ?? []).flatMap((childId) => {
      const representation = visit(childId, depth + 1);
      return representation ? [representation] : [];
    });
    visiting.delete(id);
    const objects = direct.get(id) ?? [];
    const arity = objects.length + childRepresentations.length;
    if (arity === 0) return null;

    if (arity >= 2) {
      const content = union([...objects.map((object) => object.rectangle), ...childRepresentations.map((child) => child.extent)]);
      const frame: LocationFrame = {
        locationId: id,
        parentLocationId: location.parent_location_ref?.entity_id ?? null,
        pathLocationIds: [id],
        label: location.name,
        depth,
        bounds: frameBounds(content),
      };
      frames.set(id, frame);
      return { kind: 'frame', frame, content, extent: frame.bounds };
    }

    const child = childRepresentations[0];
    if (child?.kind === 'frame') {
      const label = `${location.name} / ${child.frame.label}`;
      const frame = {
        ...child.frame,
        pathLocationIds: [id, ...child.frame.pathLocationIds],
        label,
        bounds: child.frame.bounds,
      };
      frames.set(frame.locationId, frame);
      return { kind: 'frame', frame, content: child.content, extent: frame.bounds };
    }
    const object = child?.kind === 'object' ? child.object : objects[0].rectangle;
    const physicalObjectId = child?.kind === 'object' ? child.path.physicalObjectId : objects[0].physicalObjectId;
    const label = child?.kind === 'object' ? `${location.name} / ${child.path.label}` : location.name;
    const path: ObjectLocationPath = {
      physicalObjectId,
      pathLocationIds: child?.kind === 'object' ? [id, ...child.path.pathLocationIds] : [id],
      label,
    };
    objectPaths.set(physicalObjectId, path);
    return { kind: 'object', path, object, extent: object };
  };
  for (const location of locations) {
    const id = location.location_ref.entity_id;
    if (!location.parent_location_ref || !byId.has(location.parent_location_ref.entity_id)) visit(id, 0);
  }
  return {
    frames: [...frames.values()].sort((a, b) => a.depth - b.depth || a.locationId.localeCompare(b.locationId)),
    objectPaths: [...objectPaths.values()].sort((a, b) => a.physicalObjectId.localeCompare(b.physicalObjectId)),
  };
}
