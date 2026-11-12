import { layoutLocationFrames } from './locationFrameGeometry';
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

export interface LocationProxy { locationId: string; pathLocationIds: string[]; label: string; bounds: FlowRectangle; hiddenObjectCount: number }

const proxyWidth = (label: string): number => Math.max(100, Math.min(360, 74 + [...label].length * 7));
const proxyHeight = 30;

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

/** All canonical Locations have independent presentation frames. */
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
  const geometryById = layoutLocationFrames(locations, new Map(states.flatMap(state => state.geometry ? [[state.location_ref.entity_id, state.geometry] as const] : [])));
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
  const visit = (id: string, depth: number): void => {
    if (visiting.has(id)) return; // Invalid cyclic catalogs provide no containment evidence.
    visiting.add(id);
    const location = byId.get(id)!;
    const state = stateById.get(id);
    const visible = new Set(state?.visible_direct_elements.map((ref) => `${ref.entity_type}:${ref.entity_id}`) ?? []);
    const hiddenChildren: string[] = [];
    for (const childId of children.get(id) ?? []) {
      if (state?.collapsed && !visible.has('Location:' + childId)) hiddenChildren.push(childId);
      else visit(childId, depth + 1);
    }
    visiting.delete(id);
    const directObjects = direct.get(id) ?? [];
    const hidden = state?.collapsed ? [
      ...directObjects.filter((object) => !visible.has(`PhysicalObject:${object.physicalObjectId}`)),
      ...hiddenChildren.flatMap((childId) => subtreeObjects.get(childId) ?? []),
    ] : [];
    if (hidden.length) {
      const center = union(hidden.map((object) => object.rectangle));
      const width = proxyWidth(location.name);
      const bounds = { x: center.x + center.width / 2 - width / 2, y: center.y + center.height / 2 - proxyHeight / 2, width, height: proxyHeight };
      const proxy: LocationProxy = { locationId: id, pathLocationIds: [id], label: location.name, bounds, hiddenObjectCount: hidden.length };
      proxies.set(id, proxy);
      hidden.forEach((object) => hiddenObjectProxy.set(object.physicalObjectId, id));
    }

    const bounds = geometryById.get(id)!;
    const path: string[] = [id];
    let parent = location.parent_location_ref?.entity_id;
    while (parent && byId.has(parent) && !path.includes(parent)) {
      path.unshift(parent);
      parent = byId.get(parent)?.parent_location_ref?.entity_id;
    }
    const frame: LocationFrame = { locationId: id, parentLocationId: location.parent_location_ref?.entity_id ?? null,
      pathLocationIds: [id], label: path.map(key => byId.get(key)!.name).join(' / '), depth, bounds };
    frames.set(id, frame);
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
