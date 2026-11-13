import type { LocationDocument } from './locationTypes';
import type { AutomaticLocationLayout, MapLocationState, MapPlacement } from './savedMapTypes';
import type { DisplayedPhysicalObject } from './locationFrames';
import type { FlowRectangle } from './nodeFootprint';

// Flow units: clearance for border headings/cable leads, and sequence gaps.
const CLEARANCE = 12;
// Two border headings need separation at 1x; equipment needs only half
// a heading's height. uiScale caps headings at 1x, so zoom is not an input.
const NESTED_HEADING_CLEARANCE = 24;
const HORIZONTAL_GAP = 20;
const MIN_HEIGHT = 32;

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
  const includedByLocation = new Map<string, Array<[string, FlowRectangle]>>();
  const flexible = new Set(objects.filter(o => o.flexibleCableZone).map(o => o.physicalObjectId));
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
    let cursor = CLEARANCE, cross = 0;
    const horizontal = config?.direction === 'HORIZONTAL';
    const included: Array<[string, FlowRectangle]> = [];
    for (const key of keys) {
      const location = key.startsWith('Location:');
      const child = key.slice(key.indexOf(':') + 1);
      if (!location && !dimensions.has(child)) continue;
      if (location && settings.hide_empty && !count(child)) { hidden.add(child); continue; }
      if (state?.collapsed && !visible.has(key)) continue;
      const box = location ? measure(child) : { ...dimensions.get(child)!, x: 0, y: 0 };
      const top = id !== 'root' && location ? NESTED_HEADING_CLEARANCE : CLEARANCE;
      if (!horizontal && !included.length) cursor = top;
      const placed = { ...box, x: horizontal ? cursor : CLEARANCE, y: horizontal ? top : cursor };
      included.push([key, placed]);
      cursor += (horizontal ? box.width : box.height) + (horizontal ? HORIZONTAL_GAP : CLEARANCE);
      cross = Math.max(cross, horizontal ? box.height : box.width);
    }
    includedByLocation.set(id, included);
    // Only direct visible frames share a cross-axis size. Descendants retain
    // their own independently measured groups; equipment is never stretched.
    for (const [key, placed] of included) if (key.startsWith('Location:')) {
      if (horizontal) placed.height = cross; else placed.width = cross;
    }
    const extent = included.length ? cursor - (horizontal ? HORIZONTAL_GAP : CLEARANCE) + CLEARANCE : 2 * CLEARANCE;
    const bottom = Math.max(0, ...included.map(([, placed]) => placed.y + placed.height));
    const box = { x: 0, y: 0, width: Math.max(minWidth, horizontal ? extent : cross + 2 * CLEARANCE), height: Math.max(MIN_HEIGHT, bottom + CLEARANCE) };
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
    const included = includedByLocation.get(id) ?? [];
    if (id !== 'root' && included.length === 1 && included[0][0].startsWith('PhysicalObject:')) {
      const objectId = included[0][0].slice(15);
      const object = positions.get(objectId);
      if (object && flexible.has(objectId)) object.width = Math.max(object.width, box.width - 2 * CLEARANCE);
    }
    for (const key of members.get(id) ?? []) {
      const child = key.slice(key.indexOf(':') + 1);
      if (key.startsWith('Location:') && frames.has(child)) place(child, box.x, box.y);
      else if (key.startsWith('PhysicalObject:') && positions.has(child)) { const p = positions.get(child)!; p.x += box.x; p.y += box.y; }
    }
  };
  place('root', 0, 0);
  return { frames, positions, hidden };
}
