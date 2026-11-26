import type { ConnectionPointDetails } from './physicalObjectDetailsTypes';
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
