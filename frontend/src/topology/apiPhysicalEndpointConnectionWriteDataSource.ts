import type {
  CreatePhysicalEndpointConnectionRequest,
  PhysicalEndpointConnectionCreationDocument,
  PhysicalEndpointConnectionWriteDataSource,
} from './physicalEndpointConnectionWriteTypes';

const DEFAULT_ENDPOINT = '/api/v1/topology/physical-connections';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const malformed = (message: string): never => {
  throw new Error(`Malformed physical endpoint connection response: ${message}`);
};

const requireObject: (
  value: unknown,
  path: string,
) => asserts value is Record<string, unknown> = (value, path) => {
  if (!isObject(value)) malformed(`${path} must be an object.`);
};

const requireArray: (
  value: unknown,
  path: string,
) => asserts value is unknown[] = (value, path) => {
  if (!Array.isArray(value)) malformed(`${path} must be an array.`);
};

const validateRef = (value: unknown, path: string, entityType: string): void => {
  requireObject(value, path);
  if (value.ref_type !== 'CANONICAL_FACT') malformed(`${path}.ref_type is invalid.`);
  if (value.entity_type !== entityType) malformed(`${path}.entity_type must be ${entityType}.`);
  if (typeof value.entity_id !== 'string') malformed(`${path}.entity_id must be a string.`);
};

const validateEndpoint = (value: unknown, path: string): void => {
  requireObject(value, path);
  if (value.kind !== 'NETWORK_INTERFACE' && value.kind !== 'CONNECTION_POINT') {
    malformed(`${path}.kind is invalid.`);
  }
  validateRef(
    value.endpoint_ref,
    `${path}.endpoint_ref`,
    value.kind === 'NETWORK_INTERFACE' ? 'NetworkInterface' : 'ConnectionPoint',
  );
  validateRef(value.connection_point_ref, `${path}.connection_point_ref`, 'ConnectionPoint');
  if (value.member_index !== 1) malformed(`${path}.member_index must be 1.`);
  if (value.kind === 'NETWORK_INTERFACE') {
    validateRef(value.interface_binding_ref, `${path}.interface_binding_ref`, 'InterfacePhysicalBinding');
  } else if (value.interface_binding_ref !== undefined) {
    malformed(`${path}.interface_binding_ref is not valid for a ConnectionPoint endpoint.`);
  }
};

export const parsePhysicalEndpointConnectionCreationDocument = (
  value: unknown,
): PhysicalEndpointConnectionCreationDocument => {
  requireObject(value, 'document');
  if (value.schema_version !== '1.0') malformed('schema_version must be "1.0".');
  validateEndpoint(value.source, 'source');
  validateEndpoint(value.target, 'target');
  validateRef(value.cable_ref, 'cable_ref', 'PhysicalObject');
  const connectionRefs = value.connection_refs;
  requireArray(connectionRefs, 'connection_refs');
  if (connectionRefs.length !== 3) {
    malformed('connection_refs must contain exactly three refs.');
  }
  connectionRefs.forEach((ref, index) => (
    validateRef(ref, `connection_refs[${index}]`, 'Connection')
  ));
  return value as unknown as PhysicalEndpointConnectionCreationDocument;
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
      return new Error(`${body.error.code}: ${body.error.message}`);
    }
  } catch {
    // Non-JSON responses use the generic HTTP message.
  }
  return new Error(`HTTP ${response.status} while creating physical connection.`);
};

export class ApiPhysicalEndpointConnectionWriteDataSource
implements PhysicalEndpointConnectionWriteDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async createPhysicalEndpointConnection(
    request: CreatePhysicalEndpointConnectionRequest,
  ): Promise<PhysicalEndpointConnectionCreationDocument> {
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
    return parsePhysicalEndpointConnectionCreationDocument(body);
  }
}
