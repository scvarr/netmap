import type { MapRegion, MapRegionPoint } from './savedMapTypes';

export interface RegionHierarchyNode { region: MapRegion; children: RegionHierarchyNode[] }

const EPSILON = 1e-9;

export const absolutePolygonArea = (points: readonly MapRegionPoint[]) => {
  if (points.length < 3) return 0;
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]; const next = points[(index + 1) % points.length];
    doubledArea += point.x * next.y - next.x * point.y;
  }
  return Math.abs(doubledArea) / 2;
};

const hasFinitePoints = (points: readonly MapRegionPoint[]) => points.length >= 3 && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
const compareRegions = (left: MapRegion, right: MapRegion) => left.label.localeCompare(right.label) || left.region_ref.entity_id.localeCompare(right.region_ref.entity_id);

const pointIsStrictlyInside = (point: MapRegionPoint, polygon: readonly MapRegionPoint[]) => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous]; const end = polygon[index];
    const cross = (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
    const onSegment = Math.abs(cross) <= EPSILON && point.x >= Math.min(start.x, end.x) - EPSILON && point.x <= Math.max(start.x, end.x) + EPSILON && point.y >= Math.min(start.y, end.y) - EPSILON && point.y <= Math.max(start.y, end.y) + EPSILON;
    if (onSegment) return false;
    if ((start.y > point.y) !== (end.y > point.y) && point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x) inside = !inside;
  }
  return inside;
};

/** Derives only presentation hierarchy from authoritative laminar Regions. */
export const deriveRegionHierarchy = (regions: readonly MapRegion[]): RegionHierarchyNode[] => {
  const byId = new Map<string, MapRegion>();
  for (const region of regions) if (!byId.has(region.region_ref.entity_id)) byId.set(region.region_ref.entity_id, region);
  const all = [...byId.values()].sort(compareRegions);
  const valid = all.filter((region) => hasFinitePoints(region.points) && absolutePolygonArea(region.points) > EPSILON);
  const areas = new Map(all.map((region) => [region.region_ref.entity_id, absolutePolygonArea(region.points)]));
  const parentById = new Map<string, string>();
  for (const region of valid) {
    const candidates = valid.filter((outer) => outer.region_ref.entity_id !== region.region_ref.entity_id && (areas.get(outer.region_ref.entity_id) ?? 0) > (areas.get(region.region_ref.entity_id) ?? 0) + EPSILON && region.points.every((point) => pointIsStrictlyInside(point, outer.points))).sort((left, right) => (areas.get(left.region_ref.entity_id)! - areas.get(right.region_ref.entity_id)!) || compareRegions(left, right));
    if (candidates.length > 0 && (!candidates[1] || Math.abs(areas.get(candidates[0].region_ref.entity_id)! - areas.get(candidates[1].region_ref.entity_id)!) > EPSILON)) parentById.set(region.region_ref.entity_id, candidates[0].region_ref.entity_id);
  }
  const nodes = new Map(all.map((region) => [region.region_ref.entity_id, { region, children: [] as RegionHierarchyNode[] }]));
  const roots: RegionHierarchyNode[] = [];
  for (const region of all) {
    const node = nodes.get(region.region_ref.entity_id)!; const parent = parentById.get(region.region_ref.entity_id);
    if (parent && nodes.has(parent)) nodes.get(parent)!.children.push(node); else roots.push(node);
  }
  const sortTree = (items: RegionHierarchyNode[]) => { items.sort((left, right) => compareRegions(left.region, right.region)); items.forEach((item) => sortTree(item.children)); };
  sortTree(roots);
  return roots;
};
