import type { MemberAddress } from './exactMemberTrace';
import { memberAddressKey } from './exactMemberTrace';
import { PHYSICAL_PROJECTION_REQUEST, physicalObjectIdForNode } from './projection';
import type { TopologyDataSource, TopologyProjectionDocument } from './types';
import type { ConnectionPointDetails, PhysicalObjectDetailsDataSource } from './physicalObjectDetailsTypes';
import type { CatalogInventoryEquipmentItem } from './catalogInventoryTypes';

export function traceObjectNames(items: CatalogInventoryEquipmentItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
  return new Map(items.map(item => {
    const id = item.physical_object_ref.entity_id;
    return [id, counts.get(item.label) === 1 ? item.label : `${item.label} [${id}]`];
  }));
}

export function tracePointNames(object: string, points: ConnectionPointDetails[]) {
  const names = points.map(point => {
    const panel = point.panel_context;
    return [object, panel?.panel_name, panel?.bay_name, panel?.module_name, panel?.port_name ?? point.label]
      .filter(Boolean).join(' / ');
  });
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return new Map(points.map((point, index) => {
    const id = point.connection_point_ref.entity_id;
    const name = names[index];
    return [id, counts.get(name) === 1 ? name : `${name} [${id}]`];
  }));
}


export function traceMemberLabel(pointName: string, index: number, designation?: string) {
  return `${pointName} · #${index}${designation && designation !== String(index) ? ` (${designation})` : ''}`;
}

function tracePointOwners(projection: TopologyProjectionDocument | null | undefined) {
  const owners = new Map<string, string>();
  if (projection?.layer !== 'L1') return owners;

  for (const node of projection.nodes) {
    const owner = physicalObjectIdForNode(node);
    if (!owner) continue;
    for (const point of node.attributes.connection_points ?? []) owners.set(point.connection_point_id, owner);
  }
  for (const continuation of projection.l1_off_map_continuations ?? []) {
    owners.set(continuation.remote_connection_point_ref.entity_id, continuation.remote_physical_object_ref.entity_id);
  }
  return owners;
}

export async function resolveTraceMemberNames(
  addresses: readonly MemberAddress[],
  equipment: CatalogInventoryEquipmentItem[],
  details: PhysicalObjectDetailsDataSource,
  projection: TopologyProjectionDocument | null | undefined,
  projectionSource: TopologyDataSource | undefined,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!addresses.length || signal.aborted) return names;

  const owners = tracePointOwners(projection);
  if (projectionSource && addresses.some(address => !owners.has(address.point_id))) {
    try {
      // The projection only identifies owners. Trace evidence stays in the original response.
      const global = await projectionSource.loadProjection(PHYSICAL_PROJECTION_REQUEST);
      for (const [point, owner] of tracePointOwners(global)) owners.set(point, owner);
    } catch {
      // Addresses already associated with an owner are still resolvable.
    }
  }
  if (signal.aborted) return names;

  const addressesByOwner = new Map<string, MemberAddress[]>();
  for (const address of addresses) {
    const owner = owners.get(address.point_id);
    if (!owner) continue;
    const members = addressesByOwner.get(owner) ?? [];
    members.push(address);
    addressesByOwner.set(owner, members);
  }

  const objectNames = traceObjectNames(equipment);
  await Promise.allSettled([...addressesByOwner].map(async ([owner, members]) => {
    const object = await details.loadPhysicalObjectDetails(owner);
    const pointNames = tracePointNames(objectNames.get(owner) ?? object.physical_object.label, object.connection_points);
    const points = new Map(object.connection_points.map(point => [point.connection_point_ref.entity_id, point]));
    for (const address of members) {
      const point = points.get(address.point_id);
      const pointName = pointNames.get(address.point_id);
      if (pointName === undefined || !point || address.member_index > point.cardinality) continue;
      const designation = point.members?.find(member => member.index === address.member_index)?.designation;
      names.set(memberAddressKey(address), traceMemberLabel(pointName, address.member_index, designation));
    }
  }));
  return names;
}
