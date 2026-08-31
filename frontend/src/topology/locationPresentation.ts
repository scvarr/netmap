import type { LocationDocument } from './locationTypes';

export function locationPath(items: LocationDocument[], id: string | null): string | null {
  if (!id) return null;
  const byId = new Map(items.map((item) => [item.location_ref.entity_id, item])); const labels: string[] = []; const seen = new Set<string>(); let current = byId.get(id);
  while (current && !seen.has(current.location_ref.entity_id)) { seen.add(current.location_ref.entity_id); labels.unshift(current.name); current = current.parent_location_ref ? byId.get(current.parent_location_ref.entity_id) : undefined; }
  return labels.length ? labels.join(' / ') : null;
}
