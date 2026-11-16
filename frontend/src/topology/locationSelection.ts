import type { LocationDocument } from './locationTypes';
import type { FlowRectangle } from './nodeFootprint';
/** Select containment only after React Flow has classified a click as free pane space. */
export function locationAtPoint(locations: readonly LocationDocument[], frames: readonly {locationId:string; bounds:FlowRectangle}[], point:{x:number;y:number}): string | null {
  const parents = new Map(locations.map(l => [l.location_ref.entity_id, l.parent_location_ref?.entity_id]));
  const depth = (id:string) => {
    const seen = new Set<string>(); let parent = parents.get(id);
    while (parent && !seen.has(parent)) { seen.add(parent); parent = parents.get(parent); }
    return seen.size;
  };
  return frames.filter(({bounds:b}) => point.x >= b.x && point.x <= b.x+b.width && point.y >= b.y && point.y <= b.y+b.height)
    .sort((a,b) => depth(b.locationId)-depth(a.locationId) || a.locationId.localeCompare(b.locationId))[0]?.locationId ?? null;
}
