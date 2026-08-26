import type { LibraryRef } from './objectBlueprintTypes';
import {
  BlueprintUpgradeApiError,
  type BlueprintUpgradeAnalysisDocument,
  type BlueprintUpgradeChange,
  type BlueprintUpgradeDataSource,
  type BlueprintUpgradeStatus,
} from './blueprintUpgradeTypes';

const endpoint = '/api/v1/topology/physical-objects';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const malformed = (message: string): never => {
  throw new Error(`Malformed Blueprint upgrade analysis response: ${message}`);
};
const requireObject = (value: unknown, path: string): Record<string, unknown> => (
  isObject(value) ? value : malformed(`${path} must be an object.`)
);
const requireString = (value: unknown, path: string): string => (
  typeof value === 'string' && value.length > 0
    ? value
    : malformed(`${path} must be a non-empty string.`)
);
const requireArray = (value: unknown, path: string): unknown[] => (
  Array.isArray(value) ? value : malformed(`${path} must be an array.`)
);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const parseStatus = (value: unknown): BlueprintUpgradeStatus => {
  switch (value) {
    case 'NOT_APPLICABLE':
    case 'UP_TO_DATE':
    case 'OUTDATED':
    case 'MODEL_INCONSISTENT': return value;
    default: return malformed('status is unsupported.');
  }
};

const parseLibraryRef = (
  value: unknown,
  path: string,
  entityType: LibraryRef['entity_type'],
): LibraryRef => {
  const ref = requireObject(value, path);
  if (ref.ref_type !== 'LIBRARY_RECORD') malformed(`${path}.ref_type must be "LIBRARY_RECORD".`);
  if (ref.entity_type !== entityType) malformed(`${path}.entity_type must be "${entityType}".`);
  const entityId = requireString(ref.entity_id, `${path}.entity_id`);
  if (!uuid.test(entityId)) malformed(`${path}.entity_id must be a UUID.`);
  return { ref_type: 'LIBRARY_RECORD', entity_type: entityType, entity_id: entityId };
};

const parseChange = (value: unknown, path: string): BlueprintUpgradeChange => {
  const change = requireObject(value, path);
  const parsed: BlueprintUpgradeChange = { code: requireString(change.code, `${path}.code`) };
  for (const field of ['slot_key', 'kind', 'current_kind', 'target_kind', 'details'] as const) {
    if (change[field] !== undefined) parsed[field] = requireString(change[field], `${path}.${field}`);
  }
  const slotKeys = change.slot_keys;
  if (slotKeys !== undefined) {
    parsed.slot_keys = requireArray(slotKeys, `${path}.slot_keys`).map((item, index) => (
      typeof item === 'string' ? item : malformed(`${path}.slot_keys[${index}] must be a string.`)
    ));
  }
  return parsed;
};

const parseVersionNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    malformed(`${path} must be a positive integer.`);
  }
  return Number(value);
};

export const parseBlueprintUpgradeAnalysisDocument = (
  value: unknown,
): BlueprintUpgradeAnalysisDocument => {
  const document = requireObject(value, 'document');
  if (document.schema_version !== '1.0') malformed('schema_version must be "1.0".');
  const documentStatus = parseStatus(document.status);
  const compatibleChanges = requireArray(document.compatible_changes, 'compatible_changes');
  const blockers = requireArray(document.blockers, 'blockers');
  const parsed: BlueprintUpgradeAnalysisDocument = {
    schema_version: '1.0',
    status: documentStatus,
    compatible_changes: compatibleChanges.map((change, index) => parseChange(change, `compatible_changes[${index}]`)),
    blockers: blockers.map((change, index) => parseChange(change, `blockers[${index}]`)),
  };
  if (document.blueprint_ref !== undefined) parsed.blueprint_ref = parseLibraryRef(document.blueprint_ref, 'blueprint_ref', 'ObjectBlueprint');
  if (document.current_version_ref !== undefined) parsed.current_version_ref = parseLibraryRef(document.current_version_ref, 'current_version_ref', 'ObjectBlueprintVersion');
  if (document.target_version_ref !== undefined) parsed.target_version_ref = parseLibraryRef(document.target_version_ref, 'target_version_ref', 'ObjectBlueprintVersion');
  if (document.current_version_number !== undefined) parsed.current_version_number = parseVersionNumber(document.current_version_number, 'current_version_number');
  if (document.target_version_number !== undefined) parsed.target_version_number = parseVersionNumber(document.target_version_number, 'target_version_number');
  return parsed;
};

const apiError = async (response: Response, operation: string): Promise<BlueprintUpgradeApiError> => {
  try {
    const body: unknown = await response.json();
    if (isObject(body) && isObject(body.error) && typeof body.error.code === 'string' && body.error.code.length > 0 && typeof body.error.message === 'string') {
      return new BlueprintUpgradeApiError(body.error.message, response.status, body.error.code, body.error.details);
    }
  } catch { /* Preserve the HTTP status with a bounded fallback below. */ }
  return new BlueprintUpgradeApiError(`Blueprint upgrade ${operation} request failed.`, response.status, null);
};

export class ApiBlueprintUpgradeDataSource implements BlueprintUpgradeDataSource {
  async analyzeBlueprintUpgrade(physicalObjectId: string): Promise<BlueprintUpgradeAnalysisDocument> {
    const response = await fetch(`${endpoint}/${encodeURIComponent(physicalObjectId)}/blueprint-upgrade-analysis`);
    if (!response.ok) throw await apiError(response, 'analysis');
    let body: unknown;
    try { body = await response.json(); } catch { return malformed('response body must be valid JSON.'); }
    return parseBlueprintUpgradeAnalysisDocument(body);
  }
  async applyBlueprintUpgrade(physicalObjectId: string, targetVersionId: string): Promise<unknown> {
    const response = await fetch(`${endpoint}/${encodeURIComponent(physicalObjectId)}/blueprint-upgrade`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target_version_id: targetVersionId }),
    });
    if (!response.ok) throw await apiError(response, 'apply');
    return response.json();
  }
}
