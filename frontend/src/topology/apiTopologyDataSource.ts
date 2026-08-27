import type {
  TopologyDataSource,
  TopologyProjectionDocument,
  TopologyProjectionRequest,
} from './types';

const DEFAULT_ENDPOINT = '/api/v1/topology/projection';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const malformed = (message: string): never => {
  throw new Error(`Malformed topology projection response: ${message}`);
};

const requireObject: (
  value: unknown,
  path: string,
) => asserts value is Record<string, unknown> = (value, path) => {
  if (!isObject(value)) malformed(`${path} must be an object.`);
};

const requireString = (value: unknown, path: string): void => {
  if (typeof value !== 'string') malformed(`${path} must be a string.`);
};
const requirePositiveNumber = (value: unknown, path: string): void => { if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) malformed(`${path} must be positive.`); };
const validateLibraryRef = (value: unknown, path: string, type: string): void => { requireObject(value, path); if (value.ref_type !== 'LIBRARY_RECORD' || value.entity_type !== type) malformed(`${path} must be a LIBRARY_RECORD ${type} ref.`); requireString(value.entity_id, `${path}.entity_id`); };
const validateBlueprintPresentation = (value: unknown, path: string): void => { requireObject(value, path); validateLibraryRef(value.blueprint_ref, `${path}.blueprint_ref`, 'ObjectBlueprint'); validateLibraryRef(value.version_ref, `${path}.version_ref`, 'ObjectBlueprintVersion'); requireObject(value.body, `${path}.body`); if (value.body.kind !== 'RECTANGLE') malformed(`${path}.body.kind must be RECTANGLE.`); requirePositiveNumber(value.body.width, `${path}.body.width`); requirePositiveNumber(value.body.height, `${path}.body.height`); if (value.body.fill_color != null && (typeof value.body.fill_color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value.body.fill_color))) malformed(`${path}.body.fill_color is invalid.`); if (!Array.isArray(value.slots)) malformed(`${path}.slots must be an array.`); for (const [index, item] of (value.slots as unknown[]).entries()) { requireObject(item, `${path}.slots[${index}]`); requireString(item.slot_key, `${path}.slots[${index}].slot_key`); requireString(item.display_name, `${path}.slots[${index}].display_name`); if (item.kind !== 'CONNECTION_POINT' && item.kind !== 'NETWORK_PORT') malformed(`${path}.slots[${index}].kind is invalid.`); if (item.face !== 'FRONT' && item.face !== 'REAR') malformed(`${path}.slots[${index}].face is invalid.`); requireObject(item.rendered_position, `${path}.slots[${index}].rendered_position`); requireObject(item.external_attachment, `${path}.slots[${index}].external_attachment`); if (typeof item.rendered_position.x !== 'number' || typeof item.rendered_position.y !== 'number' || typeof item.external_attachment.x !== 'number' || typeof item.external_attachment.y !== 'number' || !['LEFT', 'RIGHT', 'TOP', 'BOTTOM'].includes(String(item.external_attachment.side))) malformed(`${path}.slots[${index}].geometry is invalid.`); requireString(item.connection_point_id, `${path}.slots[${index}].connection_point_id`); if (item.network_interface_id != null) requireString(item.network_interface_id, `${path}.slots[${index}].network_interface_id`); } };
const validateEndpointPairs = (value: unknown, path: string): void => { if (!Array.isArray(value)) malformed(`${path} must be an array.`); for (const [index, pair] of (value as unknown[]).entries()) { requireObject(pair, `${path}[${index}]`); for (const key of ['from_connection_point_id', 'to_connection_point_id', 'connection_id', 'connection_member_id']) requireString(pair[key], `${path}[${index}].${key}`); for (const key of ['from_member_index', 'to_member_index']) if (!Number.isInteger(pair[key]) || (pair[key] as number) < 1) malformed(`${path}[${index}].${key} must be positive integer.`); } };
const validateConnectionPoints = (value: unknown, path: string): void => { if (!Array.isArray(value)) malformed(`${path} must be an array.`); for (const [index, point] of (value as unknown[]).entries()) { requireObject(point, `${path}[${index}]`); requireString(point.connection_point_id, `${path}[${index}].connection_point_id`); requireString(point.display_name, `${path}[${index}].display_name`); for (const key of ['cardinality', 'external_connection_count']) if (!Number.isInteger(point[key]) || (point[key] as number) < (key === 'cardinality' ? 1 : 0)) malformed(`${path}[${index}].${key} is invalid.`); } };

const requireStringArray = (value: unknown, path: string): void => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    malformed(`${path} must be an array of strings.`);
  }
};

const validateNode = (value: unknown, index: number): void => {
  const path = `nodes[${index}]`;
  requireObject(value, path);
  requireString(value.id, `${path}.id`);
  requireString(value.kind, `${path}.kind`);
  requireString(value.label, `${path}.label`);
  if (!Array.isArray(value.source_refs)) malformed(`${path}.source_refs must be an array.`);
  if (!isObject(value.attributes)) malformed(`${path}.attributes must be an object.`);
  requireObject(value.attributes, `${path}.attributes`); if (value.attributes.blueprint_presentation != null) validateBlueprintPresentation(value.attributes.blueprint_presentation, `${path}.attributes.blueprint_presentation`); if (value.attributes.connection_points != null) validateConnectionPoints(value.attributes.connection_points, `${path}.attributes.connection_points`); if (value.attributes.internal_l1_links != null) validateInternalL1Links(value.attributes.internal_l1_links, `${path}.attributes.internal_l1_links`);
};

const validateEdge = (value: unknown, index: number): void => {
  const path = `edges[${index}]`;
  requireObject(value, path);
  requireString(value.id, `${path}.id`);
  requireString(value.from_node_id, `${path}.from_node_id`);
  requireString(value.to_node_id, `${path}.to_node_id`);
  requireString(value.kind, `${path}.kind`);
  if (typeof value.aggregate !== 'boolean') malformed(`${path}.aggregate must be a boolean.`);
  if (!Array.isArray(value.source_refs)) malformed(`${path}.source_refs must be an array.`);
  if (!isObject(value.attributes)) malformed(`${path}.attributes must be an object.`);
  requireObject(value.attributes, `${path}.attributes`); if (value.attributes.endpoint_pairs != null) validateEndpointPairs(value.attributes.endpoint_pairs, `${path}.attributes.endpoint_pairs`);
};
const validateCanonicalRef = (value: unknown, path: string, entityType: string): void => { requireObject(value, path); if (value.ref_type !== 'CANONICAL_FACT' || value.entity_type !== entityType) malformed(`${path} must be a CANONICAL_FACT ${entityType} ref.`); requireString(value.entity_id, `${path}.entity_id`); };
const validateInternalL1Links = (value: unknown, path: string): void => { validateEndpointPairs(value, path); for (const [index, link] of (value as unknown[]).entries()) { requireObject(link, `${path}[${index}]`); if (!Array.isArray(link.source_refs)) malformed(`${path}[${index}].source_refs must be an array.`); } };
const validateOffMapContinuations = (value: unknown): void => { if (!Array.isArray(value)) malformed('l1_off_map_continuations must be an array.'); for (const [index, item] of (value as unknown[]).entries()) { const path = `l1_off_map_continuations[${index}]`; requireObject(item, path); for (const key of ['id', 'local_node_id', 'local_connection_point_display_name', 'cable_display_name', 'remote_display_name', 'remote_connection_point_display_name']) requireString(item[key], `${path}.${key}`); validateCanonicalRef(item.local_physical_object_ref, `${path}.local_physical_object_ref`, 'PhysicalObject'); validateCanonicalRef(item.local_connection_point_ref, `${path}.local_connection_point_ref`, 'ConnectionPoint'); validateCanonicalRef(item.cable_ref, `${path}.cable_ref`, 'PhysicalObject'); validateCanonicalRef(item.remote_physical_object_ref, `${path}.remote_physical_object_ref`, 'PhysicalObject'); validateCanonicalRef(item.remote_connection_point_ref, `${path}.remote_connection_point_ref`, 'ConnectionPoint'); if (!Array.isArray(item.source_refs)) malformed(`${path}.source_refs must be an array.`); } };

const parseProjectionDocument = (value: unknown): TopologyProjectionDocument => {
  requireObject(value, 'document');
  if (value.schema_version !== '1.0') malformed('schema_version must be "1.0".');
  if (value.layer !== 'L1' && value.layer !== 'L2' && value.layer !== 'L3') {
    malformed('layer must be one of L1, L2, or L3.');
  }
  if (value.detail_level !== 'DEVICE' && value.detail_level !== 'PHYSICAL_OBJECT') {
    malformed('detail_level must be "DEVICE" or "PHYSICAL_OBJECT".');
  }
  if (
    (value.layer === 'L1' && value.detail_level !== 'PHYSICAL_OBJECT')
    || (value.layer === 'L2' && value.detail_level !== 'DEVICE')
  ) {
    malformed('layer/detail_level combination is unsupported.');
  }
  if (!Array.isArray(value.nodes)) return malformed('nodes must be an array.');
  if (!Array.isArray(value.edges)) return malformed('edges must be an array.');
  requireStringArray(value.gaps, 'gaps');
  requireStringArray(value.warnings, 'warnings');
  value.nodes.forEach(validateNode);
  value.edges.forEach(validateEdge);
  if (value.l1_off_map_continuations != null) validateOffMapContinuations(value.l1_off_map_continuations);
  return value as unknown as TopologyProjectionDocument;
};

const readBackendError = async (response: Response): Promise<Error> => {
  try {
    const body: unknown = await response.json();
    if (
      isObject(body)
      && isObject(body.error)
      && typeof body.error.code === 'string'
      && typeof body.error.message === 'string'
      && isObject(body.error.details)
    ) {
      return new Error(`${body.error.code}: ${body.error.message}`);
    }
  } catch {
    // A non-JSON error response falls through to the generic HTTP message.
  }

  const statusText = response.statusText ? ` ${response.statusText}` : '';
  return new Error(`HTTP ${response.status}${statusText} while loading topology projection.`);
};

export class ApiTopologyDataSource implements TopologyDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async loadProjection(request: TopologyProjectionRequest): Promise<TopologyProjectionDocument> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) throw await readBackendError(response);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      malformed('response body must be valid JSON.');
    }
    return parseProjectionDocument(body);
  }
}
