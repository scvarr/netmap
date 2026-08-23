import type {
  BlueprintAnchorSide,
  BlueprintBody,
  BlueprintInternalLink,
  BlueprintSlot,
  BlueprintSlotKind,
  CreateObjectBlueprintRequest,
  LibraryRef,
  ObjectBlueprintCreationDocument,
  ObjectBlueprintDataSource,
  ObjectBlueprintListDocument,
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

const parseBody = (value: unknown, path: string): BlueprintBody => {
  const body = requireObject(value, path);
  if (body.kind !== 'RECTANGLE') malformed(`${path}.kind must be "RECTANGLE".`);
  if (typeof body.width !== 'number' || !Number.isFinite(body.width) || body.width <= 0) malformed(`${path}.width must be positive.`);
  if (typeof body.height !== 'number' || !Number.isFinite(body.height) || body.height <= 0) malformed(`${path}.height must be positive.`);
  if (body.fill_color != null && (typeof body.fill_color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(body.fill_color))) malformed(`${path}.fill_color must be #RRGGBB or null.`);
  return { kind: 'RECTANGLE', width: body.width as number, height: body.height as number, fill_color: body.fill_color as string | null | undefined };
};

const parseSlot = (value: unknown, path: string): BlueprintSlot => {
  const slot = requireObject(value, path); const anchor = requireObject(slot.anchor, `${path}.anchor`);
  if (slot.kind !== 'CONNECTION_POINT' && slot.kind !== 'NETWORK_PORT') malformed(`${path}.kind is unsupported.`);
  if (!['LEFT', 'RIGHT', 'TOP', 'BOTTOM'].includes(String(anchor.side))) malformed(`${path}.anchor.side is unsupported.`);
  if (typeof anchor.offset !== 'number' || anchor.offset < 0 || anchor.offset > 1) malformed(`${path}.anchor.offset must be 0..1.`);
  return { key: requireString(slot.key, `${path}.key`), display_name: requireString(slot.display_name, `${path}.display_name`), kind: slot.kind as BlueprintSlotKind, anchor: { side: anchor.side as BlueprintAnchorSide, offset: anchor.offset as number } };
};

const parseLink = (value: unknown, path: string): BlueprintInternalLink => {
  const link = requireObject(value, path);
  return { from_slot_key: requireString(link.from_slot_key, `${path}.from_slot_key`), to_slot_key: requireString(link.to_slot_key, `${path}.to_slot_key`) };
};

export const parseObjectBlueprintListDocument = (value: unknown): ObjectBlueprintListDocument => {
  const document = requireObject(value, 'document');
  if (document.schema_version !== '1.0' || !Array.isArray(document.blueprints)) malformed('document must have schema_version 1.0 and blueprints.');
  return { schema_version: '1.0', blueprints: (document.blueprints as unknown[]).map((value, index) => {
    const item = requireObject(value, `blueprints[${index}]`);
    if (typeof item.version_number !== 'number' || item.version_number < 1 || typeof item.slot_count !== 'number' || item.slot_count < 0 || typeof item.internal_link_count !== 'number' || item.internal_link_count < 0) malformed(`blueprints[${index}] has invalid counts.`);
    if (item.default_physical_object_class != null) requireString(item.default_physical_object_class, `blueprints[${index}].default_physical_object_class`);
    return { blueprint_ref: parseRef(item.blueprint_ref, `blueprints[${index}].blueprint_ref`, 'ObjectBlueprint'), name: requireString(item.name, `blueprints[${index}].name`), version_ref: parseRef(item.version_ref, `blueprints[${index}].version_ref`, 'ObjectBlueprintVersion'), version_number: item.version_number as number, default_physical_object_class: item.default_physical_object_class as string | null | undefined, body: parseBody(item.body, `blueprints[${index}].body`), slot_count: item.slot_count as number, internal_link_count: item.internal_link_count as number };
  }) };
};

export const parseObjectBlueprintVersionDocument = (value: unknown): ObjectBlueprintVersionDocument => {
  const document = requireObject(value, 'document');
  if (document.schema_version !== '1.0' || !Array.isArray(document.slots) || !Array.isArray(document.internal_links)) malformed('version document has invalid shape.');
  if (typeof document.version_number !== 'number' || document.version_number < 1) malformed('version_number must be positive.');
  return { schema_version: '1.0', blueprint_ref: parseRef(document.blueprint_ref, 'blueprint_ref', 'ObjectBlueprint'), name: requireString(document.name, 'name'), version_ref: parseRef(document.version_ref, 'version_ref', 'ObjectBlueprintVersion'), version_number: document.version_number as number, default_physical_object_class: document.default_physical_object_class as string | null | undefined, body: parseBody(document.body, 'body'), slots: (document.slots as unknown[]).map((slot, index) => parseSlot(slot, `slots[${index}]`)), internal_links: (document.internal_links as unknown[]).map((link, index) => parseLink(link, `internal_links[${index}]`)) };
};

export const parseObjectBlueprintCreationDocument = (value: unknown): ObjectBlueprintCreationDocument => {
  const document = requireObject(value, 'document');
  if (document.schema_version !== '1.0') malformed('schema_version must be "1.0".');
  return { schema_version: '1.0', blueprint_ref: parseRef(document.blueprint_ref, 'blueprint_ref', 'ObjectBlueprint'), version_ref: parseRef(document.version_ref, 'version_ref', 'ObjectBlueprintVersion') };
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
}
