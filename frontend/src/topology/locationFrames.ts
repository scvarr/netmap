import type { LocationDocument } from './locationTypes';
import type { MapLocationState, MapPlacement } from './savedMapTypes';
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
  proxies: LocationProxy[];
  hiddenObjectProxy: Map<string, string>;
}

export interface LocationProxy { locationId: string; label: string; bounds: FlowRectangle; hiddenObjectCount: number }

/** Only presentation endpoints change; each retained edge keeps its exact evidence and id. */
export function projectCollapsedEdges<T extends { source: string; target: string }>(edges: readonly T[], hiddenNodeProxies: ReadonlyMap<string, string>): T[] {
  return edges.flatMap((edge) => {
    const source = hiddenNodeProxies.get(edge.source) ?? edge.source;
    const target = hiddenNodeProxies.get(edge.target) ?? edge.target;
    const continuation = (edge as { data?: { continuation?: unknown } }).data?.continuation;
    return source === target && source.startsWith('location-proxy:') && !continuation ? [] : [{ ...edge, source, target }];
  });
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
  | { kind: 'object'; path: ObjectLocationPath; object: FlowRectangle; extent: FlowRectangle }
  | { kind: 'proxy'; proxy: LocationProxy; extent: FlowRectangle };

/** Canonical direct arity determines whether a populated Location has a frame. */
export function deriveLocationPresentation(
  locations: readonly LocationDocument[],
  placements: readonly MapPlacement[],
  displayedObjects: readonly DisplayedPhysicalObject[],
  states: readonly MapLocationState[] = [],
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
  const proxies = new Map<string, LocationProxy>();
  const hiddenObjectProxy = new Map<string, string>();
  const stateById = new Map(states.map((state) => [state.location_ref.entity_id, state]));
  const subtreeObjects = new Map<string, DisplayedPhysicalObject[]>();
  const collect = (id: string, visiting = new Set<string>()): DisplayedPhysicalObject[] => {
    const cached = subtreeObjects.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return [];
    visiting.add(id);
    const result = [...(direct.get(id) ?? []), ...(children.get(id) ?? []).flatMap((child) => collect(child, new Set(visiting)))];
    subtreeObjects.set(id, result);
    return result;
  };
  for (const location of locations) collect(location.location_ref.entity_id);
  const visiting = new Set<string>();
  const visit = (id: string, depth: number): Representation | null => {
    if (visiting.has(id)) return null; // Invalid cyclic catalogs provide no containment evidence.
    visiting.add(id);
    const location = byId.get(id)!;
    const state = stateById.get(id);
    const visible = new Set(state?.visible_direct_elements.map((ref) => `${ref.entity_type}:${ref.entity_id}`) ?? []);
    const hiddenChildren: string[] = [];
    const childRepresentations = (children.get(id) ?? []).flatMap((childId) => {
      if (state?.collapsed && !visible.has(`Location:${childId}`)) { hiddenChildren.push(childId); return []; }
      const representation = visit(childId, depth + 1);
      return representation ? [representation] : [];
    });
    visiting.delete(id);
    const directObjects = direct.get(id) ?? [];
    const objects = state?.collapsed ? directObjects.filter((object) => visible.has(`PhysicalObject:${object.physicalObjectId}`)) : directObjects;
    const hidden = state?.collapsed ? [
      ...directObjects.filter((object) => !visible.has(`PhysicalObject:${object.physicalObjectId}`)),
      ...hiddenChildren.flatMap((childId) => subtreeObjects.get(childId) ?? []),
    ] : [];
    let proxyRepresentation: Representation | null = null;
    if (hidden.length) {
      const center = union(hidden.map((object) => object.rectangle));
      const bounds = { x: center.x + center.width / 2 - 76, y: center.y + center.height / 2 - 30, width: 152, height: 60 };
      const proxy: LocationProxy = { locationId: id, label: location.name, bounds, hiddenObjectCount: hidden.length };
      proxies.set(id, proxy);
      hidden.forEach((object) => hiddenObjectProxy.set(object.physicalObjectId, id));
      proxyRepresentation = { kind: 'proxy', proxy, extent: bounds };
    }
    const represented = [...childRepresentations, ...(proxyRepresentation ? [proxyRepresentation] : [])];
    const arity = objects.length + represented.length;
    if (arity === 0) return null;

    if (arity >= 2) {
      const content = union([...objects.map((object) => object.rectangle), ...represented.map((child) => child.extent)]);
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

    const child = represented[0];
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
    if (child?.kind === 'proxy') {
      const proxy = { ...child.proxy, label: `${location.name} / ${child.proxy.label}` };
      proxies.set(child.proxy.locationId, proxy);
      return { kind: 'proxy', proxy, extent: child.extent };
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
    proxies: [...proxies.values()],
    hiddenObjectProxy,
  };
}
