import { parsePhysicalObjectDetailsDocument } from './apiPhysicalObjectDetailsDataSource';
import type { PhysicalObjectDetailsDocument } from './physicalObjectDetailsTypes';
import type {
  CreatePhysicalObjectRequest,
  PhysicalObjectWriteDataSource,
} from './physicalObjectWriteTypes';

const DEFAULT_ENDPOINT = '/api/v1/topology/physical-objects';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const errorMessage = (body: unknown, status: number): string => {
  if (isObject(body) && isObject(body.error) && typeof body.error.message === 'string') {
    return body.error.message;
  }
  return `Physical object creation failed with status ${status}.`;
};

export class ApiPhysicalObjectWriteDataSource implements PhysicalObjectWriteDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async createPhysicalObject(
    request: CreatePhysicalObjectRequest,
  ): Promise<PhysicalObjectDetailsDocument> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(errorMessage(body, response.status));
    return parsePhysicalObjectDetailsDocument(body);
  }
}
