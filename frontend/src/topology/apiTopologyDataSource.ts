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
};

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
