import type { LocationDocument } from './locationTypes';

/** Explicit canonical parent chains only; names and user-defined types are irrelevant. */
export function locationDescendantIds(locations: readonly LocationDocument[], rootId: string): ReadonlySet<string> {
  const children = new Map<string, string[]>();
  for (const location of locations) {
    const parent = location.parent_location_ref?.entity_id;
    if (!parent) continue;
    const items = children.get(parent) ?? [];
    items.push(location.location_ref.entity_id);
    children.set(parent, items);
  }
  const result = new Set<string>([rootId]);
  const pending = [rootId];
  while (pending.length) for (const child of children.get(pending.pop()!) ?? []) if (!result.has(child)) { result.add(child); pending.push(child); }
  return result;
}
