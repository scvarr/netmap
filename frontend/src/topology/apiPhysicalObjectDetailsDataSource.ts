import type { ProjectionSourceRef } from './types';
import type {
  PhysicalObjectDetailsDataSource,
  PhysicalObjectDetailsDocument,
} from './physicalObjectDetailsTypes';

const DEFAULT_ENDPOINT = '/api/v1/topology/physical-objects';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const malformed = (message: string): never => {
  throw new Error(`Malformed physical object details response: ${message}`);
};

const requireObject: (
  value: unknown,
  path: string,
) => asserts value is Record<string, unknown> = (value, path) => {
  if (!isObject(value)) malformed(`${path} must be an object.`);
};

const requireString = (value: unknown, path: string): void => {
  if (typeof value !== 'string' || value.length === 0) malformed(`${path} must be a non-empty string.`);
};

const requireCount = (value: unknown, path: string, minimum = 0): void => {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    malformed(`${path} must be an integer greater than or equal to ${minimum}.`);
  }
};

const validateRef = (value: unknown, path: string): ProjectionSourceRef => {
  requireObject(value, path);
  if (value.ref_type !== 'CANONICAL_FACT') malformed(`${path}.ref_type must be CANONICAL_FACT.`);
  requireString(value.entity_type, `${path}.entity_type`);
  requireString(value.entity_id, `${path}.entity_id`);
  return value as unknown as ProjectionSourceRef;
};

const validateRefs = (value: unknown, path: string): void => {
  if (!Array.isArray(value)) malformed(`${path} must be an array.`);
  const refs = value as unknown[];
  refs.forEach((item, index) => validateRef(item, `${path}[${index}]`));
};
const validateLibraryRef = (value: unknown, path: string, entityType: string): void => {
  requireObject(value, path);
  if (value.ref_type !== 'LIBRARY_RECORD' || value.entity_type !== entityType) malformed(`${path} must be a LIBRARY_RECORD ${entityType} ref.`);
  requireString(value.entity_id, `${path}.entity_id`);
};
const validateOptionalLabel = (value: unknown, path: string): void => { if (value !== undefined) requireString(value, path); };

const validateLabel = (value: Record<string, unknown>, path: string): void => {
  requireString(value.label, `${path}.label`);
  if (value.label_source !== undefined && value.label_source !== 'TECHNICAL_FALLBACK') {
    malformed(`${path}.label_source is unsupported.`);
  }
};

const requireStringArray = (value: unknown, path: string): void => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    malformed(`${path} must be an array of strings.`);
  }
};

export const parsePhysicalObjectDetailsDocument = (
  value: unknown,
): PhysicalObjectDetailsDocument => {
  requireObject(value, 'document');
  if (value.schema_version !== '1.0') malformed('schema_version must be "1.0".');
  requireObject(value.physical_object, 'physical_object');
  validateRef(value.physical_object.source_ref, 'physical_object.source_ref');
  validateLabel(value.physical_object, 'physical_object');
  if (value.physical_object.class !== undefined) {
    requireString(value.physical_object.class, 'physical_object.class');
  }
  if (value.blueprint_provenance !== undefined) {
    requireObject(value.blueprint_provenance, 'blueprint_provenance');
    validateLibraryRef(value.blueprint_provenance.blueprint_ref, 'blueprint_provenance.blueprint_ref', 'ObjectBlueprint');
    validateLibraryRef(value.blueprint_provenance.version_ref, 'blueprint_provenance.version_ref', 'ObjectBlueprintVersion');
    requireCount(value.blueprint_provenance.version_number, 'blueprint_provenance.version_number', 1);
  }
  if (!Array.isArray(value.connection_points)) malformed('connection_points must be an array.');
  const connectionPoints = value.connection_points as unknown[];
  connectionPoints.forEach((item, index) => {
    const path = `connection_points[${index}]`;
    requireObject(item, path);
    validateRef(item.connection_point_ref, `${path}.connection_point_ref`);
    validateLabel(item, path);
    requireCount(item.cardinality, `${path}.cardinality`, 1);
    requireCount(item.incident_connection_count, `${path}.incident_connection_count`);
    requireCount(item.external_connection_count, `${path}.external_connection_count`);
    requireCount(item.direct_interface_binding_count, `${path}.direct_interface_binding_count`);
    if (item.ordering_key !== undefined) requireString(item.ordering_key, `${path}.ordering_key`);
    if (item.blueprint_slot !== undefined) {
      requireObject(item.blueprint_slot, `${path}.blueprint_slot`); requireString(item.blueprint_slot.slot_key, `${path}.blueprint_slot.slot_key`);
      if (!['CONNECTION_POINT', 'NETWORK_PORT'].includes(String(item.blueprint_slot.kind))) malformed(`${path}.blueprint_slot.kind is invalid.`);
    }
    const validateItems = (items: unknown, name: string, validate: (entry: Record<string, unknown>, entryPath: string) => void): void => { if (items !== undefined) { if (!Array.isArray(items)) malformed(`${path}.${name} must be an array.`); (items as unknown[]).forEach((entry, entryIndex) => { const entryPath = `${path}.${name}[${entryIndex}]`; requireObject(entry, entryPath); validate(entry, entryPath); }); } };
    validateItems(item.direct_interface_bindings, 'direct_interface_bindings', (entry, entryPath) => { validateRef(entry.interface_ref, `${entryPath}.interface_ref`); validateLabel(entry, entryPath); validateRefs(entry.evidence_refs, `${entryPath}.evidence_refs`); });
    validateItems(item.internal_physical_counterparts, 'internal_physical_counterparts', (entry, entryPath) => { validateRef(entry.connection_point_ref, `${entryPath}.connection_point_ref`); validateLabel(entry, entryPath); validateRef(entry.connection_ref, `${entryPath}.connection_ref`); validateRefs(entry.evidence_refs, `${entryPath}.evidence_refs`); });
    validateItems(item.external_physical_attachments, 'external_physical_attachments', (entry, entryPath) => { if (!['DIRECT_CONNECTION', 'CABLE'].includes(String(entry.kind))) malformed(`${entryPath}.kind is invalid.`); validateRef(entry.connection_ref, `${entryPath}.connection_ref`); validateRefs(entry.evidence_refs, `${entryPath}.evidence_refs`); for (const key of ['remote_physical_object_ref', 'remote_connection_point_ref']) if (entry[key] !== undefined) validateRef(entry[key], `${entryPath}.${key}`); for (const key of ['remote_physical_object_label', 'remote_connection_point_label', 'cable_label']) validateOptionalLabel(entry[key], `${entryPath}.${key}`); if (entry.kind === 'CABLE') { const cable = validateRef(entry.cable_ref, `${entryPath}.cable_ref`); if (cable.entity_type !== 'Cable') malformed(`${entryPath}.cable_ref must be a Cable ref.`); } else if (entry.cable_ref !== undefined) malformed(`${entryPath}.cable_ref is only valid for CABLE.`); });
    validateRefs(item.source_refs, `${path}.source_refs`);
  });
  requireCount(value.owned_interface_count, 'owned_interface_count');
  requireStringArray(value.gaps, 'gaps');
  requireStringArray(value.warnings, 'warnings');
  return value as unknown as PhysicalObjectDetailsDocument;
};

const errorMessage = (body: unknown, status: number): string => {
  if (isObject(body) && isObject(body.error) && typeof body.error.message === 'string') {
    return body.error.message;
  }
  return `Physical object details request failed with status ${status}.`;
};

export class ApiPhysicalObjectDetailsDataSource implements PhysicalObjectDetailsDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async loadPhysicalObjectDetails(
    physicalObjectId: string,
  ): Promise<PhysicalObjectDetailsDocument> {
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(physicalObjectId)}`);
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(errorMessage(body, response.status));
    return parsePhysicalObjectDetailsDocument(body);
  }
}
