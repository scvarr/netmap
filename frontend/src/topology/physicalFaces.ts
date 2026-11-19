import type { LocationDocument } from './locationTypes';
import type { MapLocationState, MapPlacement, PhysicalFace } from './savedMapTypes';
import { panelCompositionBounds } from './blueprintDisplaySize';
import type { BlueprintPresentation } from './types';

export interface ResolvedFace {
  face: PhysicalFace;
  source: { kind: 'variant' | 'object' } | { kind: 'location'; name: string };
  explicit: boolean;
}

export function resolveFaces(
  defaultFace: PhysicalFace,
  locations: readonly LocationDocument[],
  states: readonly MapLocationState[],
  placements: readonly MapPlacement[],
) {
  const catalog = new Map(locations.map(location => [location.location_ref.entity_id, location]));
  const overrides = new Map(states.map(state => [state.location_ref.entity_id, state.face_override]));
  const fallback: ResolvedFace = { face: defaultFace, source: { kind: 'variant' }, explicit: false };
  const locationFaces = new Map<string, ResolvedFace>();
  const resolveLocation = (id: string): ResolvedFace => {
    const cached = locationFaces.get(id);
    if (cached) return cached;
    const location = catalog.get(id);
    if (!location) return fallback;
    const override = overrides.get(id);
    const parent = location.parent_location_ref;
    const resolved: ResolvedFace = override
      ? { face: override, source: { kind: 'location', name: location.name }, explicit: true }
      : parent ? { ...resolveLocation(parent.entity_id), explicit: false } : fallback;
    locationFaces.set(id, resolved);
    return resolved;
  };

  for (const id of catalog.keys()) resolveLocation(id);
  const objectFaces = new Map(placements.map(placement => {
    const override = placement.positions['L1/PHYSICAL_OBJECT']?.face_override;
    const resolved: ResolvedFace = override
      ? { face: override, source: { kind: 'object' }, explicit: true }
      : { ...resolveLocation(placement.location_ref?.entity_id ?? ''), explicit: false };
    return [placement.physical_object_ref.entity_id, resolved] as const;
  }));
  return { locationFaces, objectFaces };
}

export function blueprintFace(blueprint: BlueprintPresentation, face: PhysicalFace) {
  if (blueprint.panels.length <= 1) return undefined;
  const panels = blueprint.panels.filter(panel => !panel.face || panel.face === face);
  if (panels.length === blueprint.panels.length) return undefined;

  const bounds = panelCompositionBounds(panels);
  const byKey = new Map(panels.map(panel => [panel.panel_key, panel]));
  const hiddenPorts = new Set<string>();
  const slots = blueprint.slots.flatMap(slot => {
    const panel = byKey.get(slot.panel_key);
    if (!panel) {
      hiddenPorts.add(slot.connection_point_id);
      return [];
    }
    const x = (panel.x - bounds.x + panel.width * slot.panel_local_position.x) / bounds.width;
    const y = (panel.y - bounds.y + panel.height * slot.panel_local_position.y) / bounds.height;
    const side = slot.external_attachment.side;
    return [{ ...slot, rendered_position: { x, y }, external_attachment: {
      x: side === 'LEFT' ? 0 : side === 'RIGHT' ? 1 : x,
      y: side === 'TOP' ? 0 : side === 'BOTTOM' ? 1 : y,
      side,
    } }];
  });
  return { hiddenPorts, visibleBlueprint: { ...blueprint, panels, slots } };
}
