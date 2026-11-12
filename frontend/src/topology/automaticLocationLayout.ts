import type { LocationDocument } from './locationTypes';
import type { AutomaticLocationLayout, MapLocationState, MapPlacement } from './savedMapTypes';
import type { DisplayedPhysicalObject } from './locationFrames';
import type { FlowRectangle } from './nodeFootprint';

/** Technical root is presentation only. Identity and canonical parents are inputs. */
export function automaticLocationLayout(locations: readonly LocationDocument[], placements: readonly MapPlacement[], objects: readonly DisplayedPhysicalObject[], states: readonly MapLocationState[], settings: AutomaticLocationLayout) {
  const byId = new Map(locations.map(l => [l.location_ref.entity_id, l]));
  const stateById = new Map(states.map(s => [s.location_ref.entity_id, s]));
  const members = new Map<string, string[]>();
  const add = (parent: string, key: string) => members.set(parent, [...(members.get(parent) ?? []), key]);
  for (const l of locations) add(l.parent_location_ref?.entity_id ?? 'root', 'Location:' + l.location_ref.entity_id);
  const dimensions = new Map(objects.map(o => [o.physicalObjectId, o.rectangle]));
  for (const p of placements) add(p.location_ref?.entity_id ?? 'root', 'PhysicalObject:' + p.physical_object_ref.entity_id);
  const counts = new Map<string, number>();
  const count = (id: string): number => {
    if (counts.has(id)) return counts.get(id)!;
    const result = (members.get(id) ?? []).reduce((n, key) => n + (key.startsWith('Location:') ? count(key.slice(9)) : 1), 0);
    counts.set(id, result); return result;
  };
  count('root');
  const frames = new Map<string, FlowRectangle>();
  const positions = new Map<string, FlowRectangle>();
  const hidden = new Set<string>();
  const measure = (id: string): FlowRectangle => {
    const state = stateById.get(id);
    const visible = new Set(state?.visible_direct_elements.map(r => r.entity_type + ':' + r.entity_id));
    const full = state?.collapsed && !visible.size;
    const label = byId.get(id)?.name ?? '';
    const minWidth = Math.max(100, Math.min(360, 74 + [...label].length * 7));
    if (full) { const box = { x: 0, y: 0, width: minWidth, height: 32 }; frames.set(id, box); return box; }
    const config = settings.containers[id];
    const order = config?.order ?? [];
    const keys = [...(members.get(id) ?? [])].sort((a,b) => {
      const ai = order.indexOf(a), bi = order.indexOf(b);
      return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) || a.localeCompare(b);
    });
    let cursor = 20, cross = 0;
    const horizontal = config?.direction === 'HORIZONTAL';
    const included: Array<[string, FlowRectangle]> = [];
    for (const key of keys) {
      const location = key.startsWith('Location:');
      const child = key.slice(key.indexOf(':') + 1);
      if (!location && !dimensions.has(child)) continue;
      if (location && settings.hide_empty && !count(child)) { hidden.add(child); continue; }
      if (state?.collapsed && !visible.has(key)) continue;
      const box = location ? measure(child) : { ...dimensions.get(child)!, x: 0, y: 0 };
      const placed = { ...box, x: horizontal ? cursor : 20, y: horizontal ? 44 : cursor + 24 };
      included.push([key, placed]);
      cursor += (horizontal ? box.width : box.height) + 20;
      cross = Math.max(cross, horizontal ? box.height : box.width);
    }
    const box = { x: 0, y: 0, width: Math.max(minWidth, horizontal ? cursor : cross + 40), height: Math.max(64, horizontal ? cross + 64 : cursor + 24) };
    frames.set(id, box);
    // Child coordinates are relative until the final top-down pass.
    for (const [key, placed] of included) if (key.startsWith('Location:')) frames.set(key.slice(9), placed); else positions.set(key.slice(15), placed);
    return box;
  };
  if (settings.hide_empty) for (const id of byId.keys()) if (!count(id)) hidden.add(id);
  measure('root');
  const place = (id: string, x: number, y: number) => {
    const box = frames.get(id)!;
    box.x += x; box.y += y;
    for (const key of members.get(id) ?? []) {
      const child = key.slice(key.indexOf(':') + 1);
      if (key.startsWith('Location:') && frames.has(child)) place(child, box.x, box.y);
      else if (key.startsWith('PhysicalObject:') && positions.has(child)) { const p = positions.get(child)!; p.x += box.x; p.y += box.y; }
    }
  };
  place('root', 0, 0);
  return { frames, positions, hidden };
}
