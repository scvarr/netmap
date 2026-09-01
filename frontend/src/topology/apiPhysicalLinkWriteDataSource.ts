import type {
  CreatePhysicalLinkRequest,
  PhysicalConnectionCreationDocument,
  PhysicalLinkWriteDataSource,
} from './physicalLinkWriteTypes';
import { historicalCableLabelError } from './historicalCableLabelReuse';

const DEFAULT_ENDPOINT = '/api/v1/topology/physical-links';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const malformed = (message: string): never => {
  throw new Error(`Malformed physical connection response: ${message}`);
};

const requireObject: (
  value: unknown,
  path: string,
) => asserts value is Record<string, unknown> = (value, path) => {
  if (!isObject(value)) malformed(`${path} must be an object.`);
};

const validateRef = (value: unknown, path: string, entityType: string): void => {
  requireObject(value, path);
  if (value.ref_type !== 'CANONICAL_FACT') {
    malformed(`${path}.ref_type must be "CANONICAL_FACT".`);
  }
  if (value.entity_type !== entityType) {
    malformed(`${path}.entity_type must be "${entityType}".`);
  }
  if (typeof value.entity_id !== 'string') malformed(`${path}.entity_id must be a string.`);
};

export const parsePhysicalConnectionCreationDocument = (
  value: unknown,
): PhysicalConnectionCreationDocument => {
  requireObject(value, 'document');
  if (value.schema_version !== '1.0') malformed('schema_version must be "1.0".');
  validateRef(value.source_interface_ref, 'source_interface_ref', 'NetworkInterface');
  validateRef(value.target_interface_ref, 'target_interface_ref', 'NetworkInterface');
  validateRef(value.cable_ref, 'cable_ref', 'Cable');
  validateRef(value.source_binding_ref, 'source_binding_ref', 'InterfacePhysicalBinding');
  validateRef(value.target_binding_ref, 'target_binding_ref', 'InterfacePhysicalBinding');
  validateRef(value.connection_ref, 'connection_ref', 'Connection');
  return value as unknown as PhysicalConnectionCreationDocument;
};

const readBackendError = async (response: Response): Promise<Error> => {
  try {
    const body: unknown = await response.json();
    if (
      isObject(body)
      && isObject(body.error)
      && typeof body.error.code === 'string'
      && typeof body.error.message === 'string'
    ) {
      return historicalCableLabelError(body);
    }
  } catch {
    // Non-JSON responses use the generic HTTP message.
  }
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  return new Error(`HTTP ${response.status}${statusText} while creating physical link.`);
};

export class ApiPhysicalLinkWriteDataSource implements PhysicalLinkWriteDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async createPhysicalLink(
    request: CreatePhysicalLinkRequest,
  ): Promise<PhysicalConnectionCreationDocument> {
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
    return parsePhysicalConnectionCreationDocument(body);
  }
}
