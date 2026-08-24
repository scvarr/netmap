import type { ProjectionSourceRef } from './types';
import type { CatalogInventoryDataSource, CatalogInventoryDocument } from './catalogInventoryTypes';

const DEFAULT_ENDPOINT = '/api/v1/catalog/inventory';
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const malformed = (message: string): never => { throw new Error(`Malformed catalog inventory response: ${message}`); };
const object = (value: unknown, path: string): Record<string, unknown> => { if (!isObject(value)) malformed(`${path} must be an object.`); return value as Record<string, unknown>; };
const string = (value: unknown, path: string): void => { if (typeof value !== 'string' || value.length === 0) malformed(`${path} must be a non-empty string.`); };
const strings = (value: unknown, path: string): void => { if (!Array.isArray(value) || !(value as unknown[]).every((item) => typeof item === 'string')) malformed(`${path} must be an array of strings.`); };
const count = (value: unknown, path: string): void => { if (!Number.isInteger(value) || Number(value) < 0) malformed(`${path} must be a non-negative integer.`); };
const exactKeys = (value: Record<string, unknown>, path: string, keys: string[]): void => { if (Object.keys(value).some((key) => !keys.includes(key))) malformed(`${path} has unsupported fields.`); };
const ref = (value: unknown, path: string, expected?: string): ProjectionSourceRef => { const item = object(value, path); if (item.ref_type !== 'CANONICAL_FACT') malformed(`${path}.ref_type must be CANONICAL_FACT.`); string(item.entity_type, `${path}.entity_type`); if (expected && item.entity_type !== expected) malformed(`${path}.entity_type must be ${expected}.`); string(item.entity_id, `${path}.entity_id`); return item as unknown as ProjectionSourceRef; };
const refs = (value: unknown, path: string): void => { if (!Array.isArray(value)) malformed(`${path} must be an array.`); (value as unknown[]).forEach((item, index) => ref(item, `${path}[${index}]`)); };
const label = (item: Record<string, unknown>, path: string): void => { string(item.label, `${path}.label`); if (item.label_source !== undefined && item.label_source !== 'TECHNICAL_FALLBACK') malformed(`${path}.label_source is unsupported.`); };
const endpoint = (value: unknown, path: string): void => { const item = object(value, path); ref(item.remote_physical_object_ref, `${path}.remote_physical_object_ref`, 'PhysicalObject'); string(item.remote_physical_object_label, `${path}.remote_physical_object_label`); ref(item.remote_connection_point_ref, `${path}.remote_connection_point_ref`, 'ConnectionPoint'); string(item.remote_connection_point_label, `${path}.remote_connection_point_label`); refs(item.evidence_refs, `${path}.evidence_refs`); };

export const parseCatalogInventoryDocument = (value: unknown): CatalogInventoryDocument => {
  const document = object(value, 'document');
  if (document.schema_version !== '1.0') malformed('schema_version must be "1.0".');
  if (!Array.isArray(document.equipment)) malformed('equipment must be an array.');
  (document.equipment as unknown[]).forEach((value, index) => { const path = `equipment[${index}]`; const item = object(value, path); ref(item.physical_object_ref, `${path}.physical_object_ref`, 'PhysicalObject'); label(item, path); if (item.class !== undefined) string(item.class, `${path}.class`); if (item.occupancy !== undefined && item.occupancy !== null) { const occupancy = object(item.occupancy, `${path}.occupancy`); count(occupancy.total_ports, `${path}.occupancy.total_ports`); count(occupancy.connected_ports, `${path}.occupancy.connected_ports`); count(occupancy.free_ports, `${path}.occupancy.free_ports`); if (Number(occupancy.connected_ports) + Number(occupancy.free_ports) !== Number(occupancy.total_ports)) malformed(`${path}.occupancy counts must add up.`); } if (!Array.isArray(item.map_memberships)) malformed(`${path}.map_memberships must be an array.`); (item.map_memberships as unknown[]).forEach((membership, membershipIndex) => { const mapPath = `${path}.map_memberships[${membershipIndex}]`; const map = object(membership, mapPath); const mapRef = object(map.map_ref, `${mapPath}.map_ref`); exactKeys(mapRef, `${mapPath}.map_ref`, ['entity_type', 'entity_id']); if (mapRef.entity_type !== 'SavedMap') malformed(`${mapPath}.map_ref.entity_type must be SavedMap.`); string(mapRef.entity_id, `${mapPath}.map_ref.entity_id`); string(map.name, `${mapPath}.name`); }); });
  if (!Array.isArray(document.cables)) malformed('cables must be an array.');
  (document.cables as unknown[]).forEach((value, index) => { const path = `cables[${index}]`; const item = object(value, path); ref(item.cable_ref, `${path}.cable_ref`, 'PhysicalObject'); label(item, path); if (item.resolution !== 'SIMPLE_CABLE' && item.resolution !== 'UNRESOLVED') malformed(`${path}.resolution is invalid.`); strings(item.gaps, `${path}.gaps`); strings(item.warnings, `${path}.warnings`); if (item.resolution === 'SIMPLE_CABLE') { endpoint(item.endpoint_a, `${path}.endpoint_a`); endpoint(item.endpoint_b, `${path}.endpoint_b`); } else if (item.endpoint_a !== undefined || item.endpoint_b !== undefined) malformed(`${path} unresolved cable must not have endpoints.`); });
  strings(document.gaps, 'gaps'); strings(document.warnings, 'warnings');
  return document as unknown as CatalogInventoryDocument;
};

export class ApiCatalogInventoryDataSource implements CatalogInventoryDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}
  async loadCatalogInventory(): Promise<CatalogInventoryDocument> {
    const response = await fetch(this.endpoint);
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`Catalog inventory request failed with status ${response.status}.`);
    return parseCatalogInventoryDocument(body);
  }
}
