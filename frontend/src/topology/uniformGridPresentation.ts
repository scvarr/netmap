import { layoutLocationGrid, type LocationGridNode, type LocationGridResult } from './locationGridLayout';
import type { LocationDocument } from './locationTypes';
import type { MapPlacement, MapLocationState, UniformLocationGrid } from './savedMapTypes';
import type { DisplayedPhysicalObject } from './locationFrames';
import type { FlowRectangle } from './nodeFootprint';

/** Reconcile live hierarchy without moving surviving saved cells or mutating settings. */
export function gridTables(locations: readonly LocationDocument[], saved: UniformLocationGrid['tables'] = {}) {
  const tables: UniformLocationGrid['tables'] = {};
  const parents = new Map(locations.map(l => [l.location_ref.entity_id, l.parent_location_ref?.entity_id ?? 'root']));
  for (const parent of ['root', ...parents.keys()]) {
    const seen = new Set<string>();
    const rows = (saved[parent] ?? []).map(row => row.map(id => {
      if (!id || parents.get(id) !== parent || seen.has(id)) return null;
      seen.add(id); return id;
    }));
    for (const id of [...parents.keys()].sort()) if (parents.get(id) === parent && !seen.has(id)) {
      let inserted = false;
      for (const row of rows) { const hole = row.indexOf(null); if (hole >= 0) { row[hole] = id; inserted = true; break; } }
      if (!inserted) rows.push([id]);
    }
    tables[parent] = rows;
  }
  return tables;
}

export function uniformGridPresentation(locations: readonly LocationDocument[], placements: readonly MapPlacement[], objects: readonly DisplayedPhysicalObject[], states: readonly MapLocationState[], settings: UniformLocationGrid) {
  const tables = gridTables(locations, settings.tables);
  const dimensions = new Map(objects.map(o => [o.physicalObjectId, o.rectangle]));
  const direct = new Map<string, string[]>();
  for (const p of placements) {
    const parent = p.location_ref?.entity_id ?? 'root';
    direct.set(parent, [...(direct.get(parent) ?? []), p.physical_object_ref.entity_id]);
  }
  const objectIds = new Map<string, string[]>();
  const build = (id: string): LocationGridNode => {
    const state = states.find(s => s.location_ref.entity_id === id);
    const visible = new Set(state?.visible_direct_elements.map(r => r.entity_type + ':' + r.entity_id));
    const ids = (direct.get(id) ?? []).filter(key => dimensions.has(key)).sort();
    objectIds.set(id, ids.filter(key => !state?.collapsed || visible.has('PhysicalObject:' + key)));
    const label = locations.find(l => l.location_ref.entity_id === id)?.name ?? '';
    return { id, minimum: { width: Math.max(100, Math.min(360, 74 + [...label].length * 7)), height: 32 },
      directObjects: ids.map(key => dimensions.get(key)!),
      children: (tables[id] ?? []).map(row => row.map(key => key ? build(key) : null)),
      collapsed: Boolean(state?.collapsed && !visible.size),
      visibleChildren: state?.collapsed && visible.size ? [...visible].filter(key => key.startsWith('Location:')).map(key => key.slice(9)) : undefined,
      visibleObjects: state?.collapsed && visible.size ? ids.map((key, i) => visible.has('PhysicalObject:' + key) ? i : -1).filter(i => i >= 0) : undefined,
    };
  };
  const result = layoutLocationGrid(build('root'), settings.hide_empty);
  const frames = new Map<string, FlowRectangle>(), positions = new Map<string, FlowRectangle>();
  const visit = (node: LocationGridResult, x: number, y: number) => {
    const box = { ...node.bounds, x: x + node.bounds.x, y: y + node.bounds.y };
    frames.set(node.id, box);
    node.objects.forEach((r, i) => positions.set(objectIds.get(node.id)![i], { ...r, x: box.x + r.x, y: box.y + r.y }));
    node.children.forEach(child => visit(child, box.x, box.y));
  };
  visit(result, 0, 0);
  const hidden = new Set(locations.filter(l => !frames.has(l.location_ref.entity_id)).map(l => l.location_ref.entity_id));
  return { frames, positions, hidden };
}
