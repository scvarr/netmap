import type {
  InterfacePhysicalTraceArtifact,
  InterfacePhysicalTraceDataSource,
  InterfacePhysicalTraceQuery,
} from './interfacePhysicalTraceTypes';

const DEFAULT_ENDPOINT = '/api/v1/traces/interfaces/physical';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const malformed = (message: string): never => {
  throw new Error(`Malformed interface physical trace response: ${message}`);
};

const requireObject: (value: unknown, path: string) => asserts value is Record<string, unknown> = (value, path) => {
  if (!isObject(value)) malformed(`${path} must be an object.`);
};

const requireString = (value: unknown, path: string): void => {
  if (typeof value !== 'string') malformed(`${path} must be a string.`);
};

const parseArtifact = (value: unknown): InterfacePhysicalTraceArtifact => {
  requireObject(value, 'document');
  if (value.schema_version !== 1) malformed('schema_version must be 1.');
  requireObject(value.query, 'query');
  requireString(value.query.from_interface_id, 'query.from_interface_id');
  requireString(value.query.to_interface_id, 'query.to_interface_id');
  if (value.verdict !== 'REACHABLE' && value.verdict !== 'UNKNOWN') {
    malformed('verdict must be REACHABLE or UNKNOWN.');
  }
  if (!Array.isArray(value.branches) || !value.branches.every((branch) => isObject(branch) && typeof branch.branch_id === 'string')) {
    malformed('branches must contain branch_id strings.');
  }
  if (!Array.isArray(value.gaps) || !value.gaps.every((gap) => isObject(gap) && typeof gap.code === 'string')) {
    malformed('gaps must contain public gap codes.');
  }
  if (!Array.isArray(value.warnings) || !value.warnings.every(isObject)) {
    malformed('warnings must be an array of objects.');
  }
  return value as unknown as InterfacePhysicalTraceArtifact;
};

const readBackendError = async (response: Response): Promise<Error> => {
  try {
    const body: unknown = await response.json();
    if (isObject(body) && isObject(body.error) && typeof body.error.code === 'string' && typeof body.error.message === 'string') {
      return new Error(`${body.error.code}: ${body.error.message}`);
    }
  } catch {
    // A non-JSON error response falls through to the generic HTTP message.
  }
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  return new Error(`HTTP ${response.status}${statusText} while tracing physical interfaces.`);
};

export class ApiInterfacePhysicalTraceDataSource implements InterfacePhysicalTraceDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async traceInterfacePhysical(query: InterfacePhysicalTraceQuery): Promise<InterfacePhysicalTraceArtifact> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });
    if (!response.ok) throw await readBackendError(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      malformed('response body must be valid JSON.');
    }
    return parseArtifact(body);
  }
}
