import type { MapLocationGeometry } from './savedMapTypes';
import type { LocationDocument } from './locationTypes';

export const FRAME_PADDING = 20;
export const FRAME_HEADER = 40;

export function layoutLocationFrames(locations: readonly LocationDocument[], saved: ReadonlyMap<string, MapLocationGeometry>) {
  const parents = new Map(locations.map(l => [l.location_ref.entity_id, l.parent_location_ref?.entity_id]));
  const children = new Map([...parents.keys()].map(id => [id, [] as string[]]));
  const roots: string[] = [];
  for (const [id, parent] of parents) (parent && children.has(parent) ? children.get(parent)! : roots).push(id);
  for (const ids of [roots, ...children.values()]) ids.sort();
  const result = new Map<string, MapLocationGeometry>();
  const shift = (id: string, dy: number) => { result.get(id)!.y += dy; for (const child of children.get(id)!) shift(child, dy); };
  const newSubtree = (id: string): boolean => !saved.has(id) || children.get(id)!.some(newSubtree);
  const place = (id: string, x: number, y: number) => {
    const g = { ...(saved.get(id) ?? { x, y, width: 300, height: 200, edge: 'right' as const, offset: .5 }) };
    result.set(id, g);
    let cursor = Math.max(g.y + FRAME_HEADER, ...children.get(id)!.flatMap(child => saved.has(child) ? [saved.get(child)!.y + saved.get(child)!.height + FRAME_PADDING] : []));
    const placed: string[] = [];
    for (const child of children.get(id)!) {
      place(child, g.x + FRAME_PADDING, cursor);
      const c = result.get(child)!;
      if (newSubtree(id)) while (true) {
        const conflicts = placed.map(other => result.get(other)!).filter(o => c.x < o.x + o.width + FRAME_PADDING && c.x + c.width + FRAME_PADDING > o.x && c.y < o.y + o.height + FRAME_PADDING && c.y + c.height + FRAME_PADDING > o.y);
        if (!conflicts.length) break;
        shift(child, Math.max(...conflicts.map(o => o.y + o.height + FRAME_PADDING)) - c.y);
      }
      placed.push(child);
      cursor = Math.max(cursor, c.y + c.height + FRAME_PADDING);
      g.width = Math.max(g.width, c.x + c.width + FRAME_PADDING - g.x);
      g.height = Math.max(g.height, c.y + c.height + FRAME_PADDING - g.y);
    }
  };
  let cursor = Math.max(0, ...roots.flatMap(id => saved.has(id) ? [saved.get(id)!.x + saved.get(id)!.width + 40] : []));
  for (const id of roots) { place(id, cursor, 0); const g = result.get(id)!; cursor = Math.max(cursor, g.x + g.width + 40); }
  return result;
}

export function translateFrameSubtree(locations: readonly LocationDocument[], frames: ReadonlyMap<string, MapLocationGeometry>, id: string, geometry: MapLocationGeometry) {
  const result = new Map(frames);
  const original = frames.get(id)!;
  const subtree = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of locations) if (l.parent_location_ref && subtree.has(l.parent_location_ref.entity_id) && !subtree.has(l.location_ref.entity_id)) {
      subtree.add(l.location_ref.entity_id); changed = true;
    }
  }
  for (const child of subtree) {
    const g = frames.get(child)!;
    result.set(child, child === id ? geometry : { ...g, x: g.x + geometry.x - original.x, y: g.y + geometry.y - original.y });
  }
  return result;
}
