import { parsePhysicalObjectDetailsDocument } from './apiPhysicalObjectDetailsDataSource';
import type {
  ConnectionPointWriteDataSource,
  CreateConnectionPointRequest,
} from './connectionPointWriteTypes';
import type { PhysicalObjectDetailsDocument } from './physicalObjectDetailsTypes';

const DEFAULT_ENDPOINT = '/api/v1/topology/physical-objects';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

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
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  return new Error(`HTTP ${response.status}${statusText} while creating connection point.`);
};

export class ApiConnectionPointWriteDataSource implements ConnectionPointWriteDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async createConnectionPoint(
    physicalObjectId: string,
    request: CreateConnectionPointRequest,
  ): Promise<PhysicalObjectDetailsDocument> {
    const response = await fetch(
      `${this.endpoint}/${encodeURIComponent(physicalObjectId)}/connection-points`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    );
    if (!response.ok) throw await readBackendError(response);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('Malformed physical object details response: response body must be valid JSON.');
    }
    return parsePhysicalObjectDetailsDocument(body);
  }
}
