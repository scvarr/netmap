import type {
  BlueprintBody,
  BlueprintInternalLink,
  BlueprintSlot,
  BlueprintSlotKind,
  PresentationPanel,
  CreateObjectBlueprintRequest,
  CreateObjectBlueprintVersionRequest,
  LibraryRef,
  ObjectBlueprintCreationDocument,
  ObjectBlueprintDataSource,
  ObjectBlueprintListDocument,
  ObjectBlueprintInstantiationDocument,
  ObjectBlueprintVersionDocument,
} from './objectBlueprintTypes';

const DEFAULT_ENDPOINT = '/api/v1/library/object-blueprints';
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const malformed = (message: string): never => { throw new Error(`Malformed object blueprint response: ${message}`); };
const requireObject = (value: unknown, path: string): Record<string, unknown> => isObject(value) ? value : malformed(`${path} must be an object.`);
const requireString = (value: unknown, path: string): string => typeof value === 'string' && value ? value : malformed(`${path} must be a non-empty string.`);

const parseRef = (value: unknown, path: string, type: LibraryRef['entity_type']): LibraryRef => {
  const ref = requireObject(value, path);
  if (ref.ref_type !== 'LIBRARY_RECORD') malformed(`${path}.ref_type must be "LIBRARY_RECORD".`);
  if (ref.entity_type !== type) malformed(`${path}.entity_type must be "${type}".`);
  return { ref_type: 'LIBRARY_RECORD', entity_type: type, entity_id: requireString(ref.entity_id, `${path}.entity_id`) };
};
const parseCanonicalRef = <T extends 'PhysicalObject' | 'ConnectionPoint' | 'NetworkInterface'>(value: unknown, path: string, type: T): { ref_type: 'CANONICAL_FACT'; entity_type: T; entity_id: string } => {
  const ref = requireObject(value, path);
  if (ref.ref_type !== 'CANONICAL_FACT' || ref.entity_type !== type) malformed(`${path} must be a CANONICAL_FACT ${type} ref.`);
  return { ref_type: 'CANONICAL_FACT' as const, entity_type: type, entity_id: requireString(ref.entity_id, `${path}.entity_id`) };
};

const parseBody = (value: unknown, path: string): BlueprintBody => {
  const body = requireObject(value, path);
  if (body.kind !== 'RECTANGLE') malformed(`${path}.kind must be "RECTANGLE".`);
  if (typeof body.width !== 'number' || !Number.isFinite(body.width) || body.width <= 0) malformed(`${path}.width must be positive.`);
  if (typeof body.height !== 'number' || !Number.isFinite(body.height) || body.height <= 0) malformed(`${path}.height must be positive.`);
  if (body.fill_color != null && (typeof body.fill_color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(body.fill_color))) malformed(`${path}.fill_color must be #RRGGBB or null.`);
  return { kind: 'RECTANGLE', width: body.width as number, height: body.height as number, fill_color: body.fill_color as string | null | undefined };
};

const parseSlot = (value: unknown, path: string): BlueprintSlot => {
  const slot = requireObject(value, path); const rendered = requireObject(slot.rendered_position, `${path}.rendered_position`);
  if (slot.kind !== 'CONNECTION_POINT' && slot.kind !== 'NETWORK_PORT') malformed(`${path}.kind is unsupported.`);
  if (typeof rendered.x !== 'number' || typeof rendered.y !== 'number' || !Number.isFinite(rendered.x) || !Number.isFinite(rendered.y) || rendered.x < 0 || rendered.x > 1 || rendered.y < 0 || rendered.y > 1) malformed(`${path}.rendered_position is invalid.`);
  return { key: requireString(slot.key, `${path}.key`), display_name: requireString(slot.display_name, `${path}.display_name`), kind: slot.kind as BlueprintSlotKind, panel_key: requireString(slot.panel_key, `${path}.panel_key`), rendered_position: { x: rendered.x as number, y: rendered.y as number } };
};

const parsePanel = (value: unknown, path: string): PresentationPanel => {
  const panel = requireObject(value, path);
  if (!Number.isInteger(panel.panel_number) || (panel.panel_number as number) < 1) malformed(`${path}.panel_number is invalid.`);
  for (const field of ['x', 'y', 'width', 'height'] as const) if (typeof panel[field] !== 'number' || !Number.isFinite(panel[field])) malformed(`${path}.${field} is invalid.`);
  if ((panel.width as number) <= 0 || (panel.height as number) <= 0) malformed(`${path} dimensions must be positive.`);
  return { panel_key: requireString(panel.panel_key, `${path}.panel_key`), panel_number: panel.panel_number as number, display_name: requireString(panel.display_name, `${path}.display_name`), x: panel.x as number, y: panel.y as number, width: panel.width as number, height: panel.height as number };
};

const parseLink = (value: unknown, path: string): BlueprintInternalLink => {
  const link = requireObject(value, path);
  return { from_slot_key: requireString(link.from_slot_key, `${path}.from_slot_key`), to_slot_key: requireString(link.to_slot_key, `${path}.to_slot_key`) };
};

export const parseObjectBlueprintListDocument = (value: unknown): ObjectBlueprintListDocument => {
  const document = requireObject(value, 'document');
  if (document.schema_version !== '2.0' || !Array.isArray(document.blueprints)) malformed('document must have schema_version 2.0 and blueprints.');
  return { schema_version: '2.0', blueprints: (document.blueprints as unknown[]).map((value, index) => {
    const item = requireObject(value, `blueprints[${index}]`);
    if (typeof item.version_number !== 'number' || item.version_number < 1 || typeof item.slot_count !== 'number' || item.slot_count < 0 || typeof item.internal_link_count !== 'number' || item.internal_link_count < 0 || typeof item.version_count !== 'number' || item.version_count < 1) malformed(`blueprints[${index}] has invalid counts.`);
    if (item.default_physical_object_class != null) requireString(item.default_physical_object_class, `blueprints[${index}].default_physical_object_class`);
    return { blueprint_ref: parseRef(item.blueprint_ref, `blueprints[${index}].blueprint_ref`, 'ObjectBlueprint'), name: requireString(item.name, `blueprints[${index}].name`), version_ref: parseRef(item.version_ref, `blueprints[${index}].version_ref`, 'ObjectBlueprintVersion'), version_number: item.version_number as number, default_physical_object_class: item.default_physical_object_class as string | null | undefined, body: parseBody(item.body, `blueprints[${index}].body`), slot_count: item.slot_count as number, internal_link_count: item.internal_link_count as number, version_count: item.version_count as number };
  }) };
};

export const parseObjectBlueprintVersionDocument = (value: unknown): ObjectBlueprintVersionDocument => {
  const document = requireObject(value, 'document');
  if (document.schema_version !== '2.0' || !Array.isArray(document.panels) || !Array.isArray(document.slots) || !Array.isArray(document.internal_links)) malformed('version document has invalid shape.');
  if (typeof document.version_number !== 'number' || document.version_number < 1) malformed('version_number must be positive.');
  if (!Number.isInteger(document.next_panel_number) || (document.next_panel_number as number) <= 0) malformed('next_panel_number must be positive.');
  const panels = (document.panels as unknown[]).map((panel, index) => parsePanel(panel, `panels[${index}]`));
  const slots = (document.slots as unknown[]).map((slot, index) => parseSlot(slot, `slots[${index}]`));
  if (!panels.length || new Set(panels.map((panel) => panel.panel_key)).size !== panels.length || new Set(panels.map((panel) => panel.panel_number)).size !== panels.length || slots.some((slot) => !panels.some((panel) => panel.panel_key === slot.panel_key))) malformed('version panel membership is invalid.');
  return { schema_version: '2.0', blueprint_ref: parseRef(document.blueprint_ref, 'blueprint_ref', 'ObjectBlueprint'), name: requireString(document.name, 'name'), version_ref: parseRef(document.version_ref, 'version_ref', 'ObjectBlueprintVersion'), version_number: document.version_number as number, next_panel_number: document.next_panel_number as number, default_physical_object_class: document.default_physical_object_class as string | null | undefined, body: parseBody(document.body, 'body'), panels, slots, internal_links: (document.internal_links as unknown[]).map((link, index) => parseLink(link, `internal_links[${index}]`)) };
};

export const parseObjectBlueprintCreationDocument = (value: unknown): ObjectBlueprintCreationDocument => {
  const document = requireObject(value, 'document');
  if (document.schema_version !== '2.0') malformed('schema_version must be "2.0".');
  return { schema_version: '2.0', blueprint_ref: parseRef(document.blueprint_ref, 'blueprint_ref', 'ObjectBlueprint'), version_ref: parseRef(document.version_ref, 'version_ref', 'ObjectBlueprintVersion') };
};
export const parseObjectBlueprintInstantiationDocument = (value: unknown): ObjectBlueprintInstantiationDocument => {
  const document = requireObject(value, 'document');
  if (document.schema_version !== '2.0' || !Array.isArray(document.slots)) malformed('instantiation document has invalid shape.');
  const slots = document.slots as unknown[];
  return { schema_version: '2.0', blueprint_ref: parseRef(document.blueprint_ref, 'blueprint_ref', 'ObjectBlueprint'), version_ref: parseRef(document.version_ref, 'version_ref', 'ObjectBlueprintVersion'), physical_object_ref: parseCanonicalRef(document.physical_object_ref, 'physical_object_ref', 'PhysicalObject'), slots: slots.map((value, index) => { const slot = requireObject(value, `slots[${index}]`); return { slot_key: requireString(slot.slot_key, `slots[${index}].slot_key`), connection_point_ref: parseCanonicalRef(slot.connection_point_ref, `slots[${index}].connection_point_ref`, 'ConnectionPoint'), network_interface_ref: slot.network_interface_ref == null ? slot.network_interface_ref as null | undefined : parseCanonicalRef(slot.network_interface_ref, `slots[${index}].network_interface_ref`, 'NetworkInterface') }; }) };
};

const backendError = async (response: Response): Promise<Error> => {
  try { const body: unknown = await response.json(); if (isObject(body) && isObject(body.error) && typeof body.error.code === 'string' && typeof body.error.message === 'string') return new Error(`${body.error.code}: ${body.error.message}`); } catch { /* generic below */ }
  return new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''} while loading object blueprints.`);
};

export class ApiObjectBlueprintDataSource implements ObjectBlueprintDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}
  async loadObjectBlueprints(): Promise<ObjectBlueprintListDocument> {
    const response = await fetch(this.endpoint); if (!response.ok) throw await backendError(response);
    let body: unknown; try { body = await response.json(); } catch { return malformed('response body must be valid JSON.'); }
    return parseObjectBlueprintListDocument(body);
  }
  async loadObjectBlueprintVersion(blueprintId: string, versionId: string): Promise<ObjectBlueprintVersionDocument> {
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(blueprintId)}/versions/${encodeURIComponent(versionId)}`); if (!response.ok) throw await backendError(response);
    let body: unknown; try { body = await response.json(); } catch { return malformed('response body must be valid JSON.'); }
    return parseObjectBlueprintVersionDocument(body);
  }
  async createObjectBlueprint(request: CreateObjectBlueprintRequest): Promise<ObjectBlueprintCreationDocument> {
    const response = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }); if (!response.ok) throw await backendError(response);
    let body: unknown; try { body = await response.json(); } catch { return malformed('response body must be valid JSON.'); }
    return parseObjectBlueprintCreationDocument(body);
  }
  async createObjectBlueprintVersion(blueprintId: string, request: CreateObjectBlueprintVersionRequest): Promise<ObjectBlueprintCreationDocument> {
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(blueprintId)}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }); if (!response.ok) throw await backendError(response);
    let body: unknown; try { body = await response.json(); } catch { return malformed('response body must be valid JSON.'); }
    return parseObjectBlueprintCreationDocument(body);
  }
  async deleteObjectBlueprint(blueprintId: string): Promise<void> {
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(blueprintId)}`, { method: 'DELETE' }); if (!response.ok) throw await backendError(response);
  }
  async instantiateObjectBlueprint(blueprintId: string, versionId: string, request: { display_name: string; location_id?: string }): Promise<ObjectBlueprintInstantiationDocument> {
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(blueprintId)}/versions/${encodeURIComponent(versionId)}/instantiate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }); if (!response.ok) throw await backendError(response);
    let body: unknown; try { body = await response.json(); } catch { return malformed('response body must be valid JSON.'); }
    return parseObjectBlueprintInstantiationDocument(body);
  }
}
