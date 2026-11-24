import type {
  BulkPhysicalConnectionItem,
  CreatePhysicalEndpointConnectionRequest,
  CreateBulkPhysicalConnectionsRequest,
  PhysicalEndpointConnectionCreationDocument,
  PhysicalEndpointConnectionWriteDataSource,
} from './physicalEndpointConnectionWriteTypes';
import { requestPhysicalCompatibility } from './physicalCompatibility';

export class BulkPhysicalConnectionError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | undefined,
    readonly members: { connection_point_id: string; member_index: number }[] = [],
  ) {
    super(reason ?? `HTTP ${status} while creating physical connections.`);
  }
}

async function readBulkError(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  const error = isObject(body) && isObject(body.error) ? body.error : null;
  const details = error?.details;
  const members = isObject(details) && Array.isArray(details.members) ? details.members.filter(member =>
    isObject(member) && typeof member.connection_point_id === 'string' &&
    Number.isInteger(member.member_index) && Number(member.member_index) > 0,
  ) : [];
  return new BulkPhysicalConnectionError(
    response.status,
    isObject(details) && typeof details.reason === 'string' ? details.reason : typeof error?.code === 'string' ? error.code : undefined,
    members,
  );
}

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
  if (!Number.isInteger(value.member_index) || Number(value.member_index) < 1) {
    malformed(`${path}.member_index must be a positive integer.`);
  }
  if (value.kind === 'NETWORK_INTERFACE') {
    if (value.member_index !== 1) malformed(`${path}.member_index must be 1 for a NetworkInterface.`);
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
  validateRef(value.cable_ref, 'cable_ref', 'Cable');
  validateRef(value.connection_ref, 'connection_ref', 'Connection');
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
      return new Error(body.error.message);
    }
  } catch {
    // Non-JSON responses use the generic HTTP message.
  }
  return new Error(`HTTP ${response.status} while creating physical connection.`);
};

export class ApiPhysicalEndpointConnectionWriteDataSource
implements PhysicalEndpointConnectionWriteDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  previewPhysicalEndpointConnection(request: CreatePhysicalEndpointConnectionRequest) {
    return requestPhysicalCompatibility(`${this.endpoint}?preview=true`, request, readBackendError);
  }

  previewBulkPhysicalConnections(request: CreateBulkPhysicalConnectionsRequest) {
    return requestPhysicalCompatibility(`${this.endpoint}/bulk?preview=true`, request, readBulkError);
  }

  async previewBulkCableLabels(templateId: string, count: number): Promise<{ labels: string[] }> {
    const response = await fetch(`${this.endpoint}/bulk-label-preview?template_id=${encodeURIComponent(templateId)}&count=${count}`);
    if (!response.ok) throw await readBackendError(response);
    const body: unknown = await response.json();
    if (!isObject(body) || !Array.isArray(body.labels) || body.labels.length !== count || body.labels.some((item: unknown) => typeof item !== 'string')) malformed('invalid bulk label preview.');
    return { labels: (body as Record<string, unknown>).labels as string[] };
  }

  async createBulkPhysicalConnections(request: CreateBulkPhysicalConnectionsRequest): Promise<{ created: BulkPhysicalConnectionItem[] }> {
    const response = await fetch(`${this.endpoint}/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    if (!response.ok) throw await readBulkError(response);
    const body: unknown = await response.json();
    if (!isObject(body) || !Array.isArray(body.created) || body.created.length !== request.pairs.length ||
      body.created.some((item: unknown, index: number) => {
        const { source, target } = request.pairs[index];
        return !isObject(item) || typeof item.connection_id !== 'string' || typeof item.cable_id !== 'string' ||
          item.source_connection_point_id !== source.connection_point_id || item.source_member_index !== source.member_index ||
          item.target_connection_point_id !== target.connection_point_id || item.target_member_index !== target.member_index;
      })) malformed('invalid bulk creation response.');
    return { created: (body as { created: BulkPhysicalConnectionItem[] }).created };
  }

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

  async deleteExternalPhysicalConnection(connectionId: string): Promise<void> {
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(connectionId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw await readBackendError(response);
  }
}
