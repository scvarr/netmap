import type { LocationDocument } from './locationTypes';
import type { MapLocationState, MapPlacement, PhysicalFace } from './savedMapTypes';
import { panelCompositionBounds } from './blueprintDisplaySize';
import { cableIdForNode, physicalObjectIdForNode } from './projection';
import type { BlueprintPresentation, ProjectionSourceRef, TopologyProjectionDocument, TopologySelection } from './types';

export interface TemporaryFace {
  face: PhysicalFace | 'BOTH';
  reason: 'cable' | 'trace';
}

const isCable = (ref: ProjectionSourceRef | undefined, id: string) =>
  ref?.ref_type === 'CANONICAL_FACT' && ref.entity_type === 'Cable' && ref.entity_id === id;

export function selectedCableIdFor(selection: TopologySelection): string | null {
  if (selection?.type === 'node') return cableIdForNode(selection.item);
  if (selection?.type === 'continuation') {
    const ref = selection.item.cable_ref;
    return isCable(ref, ref.entity_id) ? ref.entity_id : null;
  }
  return null;
}

export function cableEndpointIds(document: TopologyProjectionDocument, cableId: string): Set<string> {
  const result = new Set<string>();
  for (const edge of document.edges) {
    for (const pair of edge.attributes.endpoint_pairs ?? []) {
      if (!isCable(pair.cable_ref, cableId)) continue;
      result.add(pair.from_connection_point_id);
      result.add(pair.to_connection_point_id);
    }
  }
  for (const continuation of document.l1_off_map_continuations ?? []) {
    if (isCable(continuation.cable_ref, cableId) &&
        continuation.local_connection_point_ref.ref_type === 'CANONICAL_FACT' &&
        continuation.local_connection_point_ref.entity_type === 'ConnectionPoint') {
      result.add(continuation.local_connection_point_ref.entity_id);
    }
  }
  return result;
}

export function temporaryFacesFor(
  document: TopologyProjectionDocument,
  configured: ReadonlyMap<string, ResolvedFace>,
  selectedCableId: string | null,
  tracePoints?: ReadonlySet<string>,
): ReadonlyMap<string, TemporaryFace> {
  const result = new Map<string, TemporaryFace>();
  if (document.layer !== 'L1' || document.detail_level !== 'PHYSICAL_OBJECT') return result;
  const points = tracePoints ?? (selectedCableId ? cableEndpointIds(document, selectedCableId) : undefined);
  if (!points?.size) return result;
  for (const node of document.nodes) {
    const id = physicalObjectIdForNode(node);
    const base = id ? configured.get(id) : undefined;
    const blueprint = node.attributes.blueprint_presentation;
    if (!id || !base || !blueprint || blueprint.panels.length <= 1) continue;
    const panels = new Map(blueprint.panels.map(panel => [panel.panel_key, panel.face]));
    const needed = new Set(blueprint.slots.filter(slot => points.has(slot.connection_point_id))
      .map(slot => panels.get(slot.panel_key)).filter((face): face is PhysicalFace => Boolean(face)));
    const face = needed.size === 2 ? 'BOTH' : needed.values().next().value;
    if (face && face !== base.face) result.set(id, { face, reason: tracePoints ? 'trace' : 'cable' });
  }
  return result;
}

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
  return { hiddenPorts, visibleBlueprint: {
    ...blueprint, panels, slots,
    module_bodies: blueprint.module_bodies?.filter(body => byKey.has(body.panel_key)),
    module_sockets: blueprint.module_sockets?.filter(socket => byKey.has(socket.panel_key)),
  } };
}
