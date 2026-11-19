import type { DeviceNodeData } from './layout';
import type { ProjectionSourceRef, TopologyProjectionDocument, TopologyProjectionNode } from './types';

function isCanonicalCable(ref?: ProjectionSourceRef) {
  return ref?.ref_type === 'CANONICAL_FACT' && ref.entity_type === 'Cable';
}

export function cableOccupiedPortIds(document: TopologyProjectionDocument): ReadonlySet<string> {
  const occupied = new Set<string>();
  if (document.layer !== 'L1' || document.detail_level !== 'PHYSICAL_OBJECT') return occupied;
  for (const edge of document.edges) {
    for (const pair of edge.attributes.endpoint_pairs ?? []) {
      if (!isCanonicalCable(pair.cable_ref)) continue;
      occupied.add(pair.from_connection_point_id);
      occupied.add(pair.to_connection_point_id);
    }
  }
  for (const continuation of document.l1_off_map_continuations ?? []) {
    if (isCanonicalCable(continuation.cable_ref)) occupied.add(continuation.local_connection_point_ref.entity_id);
  }
  return occupied;
}

export function tracedPortIds(projection: TopologyProjectionNode, memberIds?: ReadonlySet<string>) {
  return new Set((projection.attributes.internal_l1_links ?? [])
    .filter(link => memberIds?.has(link.connection_member_id))
    .flatMap(link => [link.from_connection_point_id, link.to_connection_point_id]));
}

export function physicalPortPaint(color: string | null | undefined, occupied: boolean, traced: boolean,
  wiring?: NonNullable<DeviceNodeData['physicalPortStates']>[string]) {
  const typeColor = color || '#18383a';
  const outline = wiring === 'source' || wiring === 'destination' ? '#fff'
    : wiring === 'eligible' ? '#7be6ff'
      : traced ? '#fff2bc'
        : occupied ? '#e6fffb' : typeColor;
  return { fill: occupied ? typeColor : '#0a1518', outline };
}
